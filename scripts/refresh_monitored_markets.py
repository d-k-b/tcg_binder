#!/usr/bin/env python3
"""Slow, resumable refresh of every ProductRef currently monitored locally.

This worker defaults to the Pricing Analyzer's *headless* Python client:
``PricingRestClient.price_product``.  That is the provider-supported way to
refresh exact TCGplayer identity, recent sales, and live asks in bulk. Browser
comps are a direct-user-action-only flow: ``price_via_browser`` is available
only through an explicit single-ProductRef ``--mode browser --user-initiated``
invocation and is
excluded from timers, batches, and monitor work.

The monitor owns ``state.json``.  This tool only reads that state and writes a
separate atomic checkpoint/evidence file.  A successful call refreshes the
provider's pricing authority; no result is converted into a bid, a purchase, a
collection mutation, or an alert by this script.

By default the plan includes active collection targets plus ProductRefs on
currently active listings and outstanding review rows, deduplicated by canonical
``productId``.  It runs sequentially and sleeps between requests so a full pass
can be left running without overloading the provider or source adapters.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping


DEFAULT_MONITOR_STATE = Path.home() / ".config/tcg-price-monitor/data/state.json"
DEFAULT_CHECKPOINT = Path.home() / ".config/tcg-price-monitor/data/market-refresh-checkpoint.json"
DEFAULT_PRICING_CONFIG = Path.home() / ".config/tcg-pricing-rest/pricing-rest.json"
DEFAULT_CLIENT_ROOT = Path("/Users/dkb/Apps/Extensions/TcgPriceComparisons/clients/python")
DEFAULT_BASE_URL = "https://gogo.tail903ec0.ts.net"
CHECKPOINT_SCHEMA = "tcg.market-refresh-checkpoint/v1"
DEFAULT_MARKET_TTL_HOURS = 24 * 6
DEFAULT_RETRY_BASE_SECONDS = 15 * 60
DEFAULT_RETRY_MAX_SECONDS = 4 * 60 * 60
NON_MARKET_RETRY_SECONDS = 24 * 60 * 60
STABILITY_KEYS = (
    "compSetHash", "consensus", "trendProjection", "trendUsed", "suppressionReasons",
    "venueMedians", "jackknife", "sourceSpreadPct", "trendDeltaPct",
)
SALE_DERIVED_METHODS = frozenset({
    "median-recent-sales",
    "theil-sen-recent-sales",
    # Provider v2.43.46+: stable cross-venue consensus built only from its
    # verified recent-sales ledger.  It is Market, unlike catalog fallbacks.
    "venue-balanced-median",
})


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_utc(value: Any) -> datetime | None:
    """Parse the bounded UTC timestamps persisted by this worker."""
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def add_seconds(timestamp: str, seconds: float) -> str:
    base = parse_utc(timestamp) or datetime.now(timezone.utc)
    return (base + timedelta(seconds=max(0, seconds))).isoformat(timespec="seconds").replace("+00:00", "Z")


def retry_delay_seconds(attempts: int, base_seconds: float, max_seconds: float) -> float:
    """Bound transient retries; the scheduler supplies the actual wake-up cadence."""
    exponent = max(0, min(max(0, attempts) - 1, 8))
    return min(max_seconds, base_seconds * (2 ** exponent))


def record_is_due(record: Any, execution_mode: str, market_ttl_hours: float, now: datetime) -> tuple[bool, str | None]:
    """Return whether a checkpoint row needs a new request, never trusting old Markets forever."""
    if not isinstance(record, Mapping) or record.get("executionMode") != execution_mode:
        return True, None
    retry_at = parse_utc(record.get("nextRetryAt"))
    if retry_at and retry_at > now:
        return False, "retry-not-due"
    if record.get("status") != "market":
        return True, None
    refreshed_at = parse_utc(record.get("refreshedAt"))
    if not refreshed_at:
        return True, None
    if now - refreshed_at < timedelta(hours=max(0, market_ttl_hours)):
        return False, "market-fresh"
    return True, None


def browser_agent_ready(readiness: Mapping[str, Any]) -> tuple[bool, str | None]:
    """Fail before enqueuing when REST cannot prove an interactive browser worker is available."""
    if readiness.get("ready") is not True:
        return False, "Pricing REST readiness is false"
    if readiness.get("browserAgentAvailable") is not True:
        return False, "BROWSER_AGENT_UNAVAILABLE"
    # Newer providers expose an additive explicit failure code.  Honor it while
    # remaining compatible with older readiness responses.
    browser = readiness.get("browserAgent")
    if isinstance(browser, Mapping) and isinstance(browser.get("errorCode"), str):
        return False, browser["errorCode"]
    return True, None


def read_json(path: Path) -> Mapping[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        result = json.load(handle)
    if not isinstance(result, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return result


def canonical_product(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    if value.get("schema") != "tcg.product/v1" or not isinstance(value.get("productId"), str):
        return None
    product_id = value["productId"].strip()
    if not product_id:
        return None
    return dict(value)


def collect_monitored_products(state: Mapping[str, Any]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Return unique active monitor ProductRefs and transparent source counts."""
    sources: dict[str, int] = {"targets": 0, "activeListings": 0, "review": 0, "invalid": 0}
    products: dict[str, dict[str, Any]] = {}

    def add(value: Any, source: str) -> None:
        product = canonical_product(value)
        if product is None:
            sources["invalid"] += 1
            return
        sources[source] += 1
        products.setdefault(product["productId"], product)

    targets = state.get("targets", {})
    if isinstance(targets, Mapping):
        for record in targets.values():
            if isinstance(record, Mapping) and record.get("active") is True:
                add(record.get("product"), "targets")

    listings = state.get("listings", {})
    if isinstance(listings, Mapping):
        for record in listings.values():
            if isinstance(record, Mapping) and record.get("active") is True:
                add(record.get("product"), "activeListings")

    reviews = state.get("review", {})
    if isinstance(reviews, Mapping):
        for record in reviews.values():
            if isinstance(record, Mapping):
                add(record.get("product"), "review")

    return [products[key] for key in sorted(products)], sources


def plan_fingerprint(products: Iterable[Mapping[str, Any]]) -> str:
    material = "\n".join(sorted(str(product["productId"]) for product in products)).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def atomic_write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    encoded = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    fd, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


def load_checkpoint(path: Path, fingerprint: str, execution_mode: str) -> dict[str, Any]:
    if not path.exists():
        return {"schema": CHECKPOINT_SCHEMA, "planFingerprint": fingerprint, "executionMode": execution_mode, "records": {}}
    checkpoint = dict(read_json(path))
    if checkpoint.get("schema") != CHECKPOINT_SCHEMA or checkpoint.get("planFingerprint") != fingerprint:
        return {"schema": CHECKPOINT_SCHEMA, "planFingerprint": fingerprint, "executionMode": execution_mode, "records": {}}
    records = checkpoint.get("records")
    checkpoint["records"] = dict(records) if isinstance(records, Mapping) else {}
    checkpoint["executionMode"] = execution_mode
    normalize_checkpoint_records(checkpoint["records"])
    return checkpoint


def is_sale_derived_method(value: Any) -> bool:
    """Only recent-sale Market methods are usable by this refresh worker."""
    return isinstance(value, str) and value.strip().lower() in SALE_DERIVED_METHODS


def timing_advisory(market: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Create a display-only timing hint from the provider's recent-sale trend.

    The returned text is deliberately separate from current Market.  It cannot
    affect ceiling, deal-ratio, alert, or recommendation logic, and it never
    reads or presents ``trendProjection`` as a dollar amount.
    """
    if not isinstance(market, Mapping):
        return None
    trend = market.get("monthlyTrendPct")
    if not isinstance(trend, (int, float)) or isinstance(trend, bool) or not math.isfinite(trend):
        return None
    percent = round(float(trend), 2)
    if percent <= -5:
        direction = "down"
        guidance = "Recent sales are trending down; waiting may be reasonable if the item is not scarce."
    elif percent >= 5:
        direction = "up"
        guidance = "Recent sales are trending up; buying sooner may be reasonable if the item is needed."
    else:
        direction = "steady"
        guidance = "Recent sales are broadly steady; use current Market and availability."
    return {
        "basis": "recent-sales monthly trend — advisory only",
        "direction": direction,
        "percent": percent,
        "guidance": guidance,
    }


def normalize_checkpoint_records(records: dict[str, Any]) -> None:
    """Downgrade legacy/fallback checkpoint rows so they are retried safely."""
    for product_id, record in list(records.items()):
        if not isinstance(record, Mapping) or record.get("status") != "market":
            continue
        market = record.get("market")
        method = market.get("method") if isinstance(market, Mapping) else None
        if not is_sale_derived_method(method):
            records[product_id] = {
                "status": "catalog_reference" if isinstance(market, Mapping) and market.get("value") is not None else "unavailable",
                "reason": "legacy checkpoint did not contain a verified recent-sales Market",
                "refreshedAt": record.get("refreshedAt") or utc_now(),
            }


def latest_market_record(result: Mapping[str, Any], execution_mode: str, *, non_market_retry_seconds: float = NON_MARKET_RETRY_SECONDS) -> dict[str, Any]:
    """Persist only current, sale-derived, non-secret valuation fields.

    Catalog/stale fallbacks are intentionally represented as non-actionable
    evidence and never under the ``market`` key.  This ensures a consumer cannot
    mistake a provider reference value for a refreshed Market or ceiling.
    """
    product = result.get("product") if isinstance(result.get("product"), Mapping) else {}
    market = result.get("market") if isinstance(result.get("market"), Mapping) else None
    ask = result.get("lowestAsk") if isinstance(result.get("lowestAsk"), Mapping) else None
    method = market.get("method") if market else None
    observed_at = result.get("observedAt")
    cache = result.get("cache") if isinstance(result.get("cache"), Mapping) else {}
    browser_execution = result.get("browserExecution") if isinstance(result.get("browserExecution"), Mapping) else {}
    if execution_mode == "browser" and browser_execution.get("mode") != "interactive-extension":
        status, reason = "unavailable", "browser request did not return interactive-extension provenance"
    elif cache.get("mode") == "stale-fallback":
        status, reason = "stale", "provider marked the valuation as stale fallback"
    elif market and not is_sale_derived_method(method):
        status, reason = "catalog_reference", "Market method is not verified recent sales"
    elif market and not observed_at:
        status, reason = "unavailable", "provider response omitted its observation timestamp"
    elif market:
        status, reason = "market", None
    elif result.get("marketPending"):
        status, reason = "pending", "provider has no verified recent-sale Market yet"
    else:
        status, reason = "unavailable", "provider returned no verified recent-sale Market"
    refreshed_at = utc_now()
    record = {
        "status": status,
        "executionMode": execution_mode,
        "productId": product.get("productId"),
        "observedAt": observed_at,
        "market": None if status != "market" else {
            **{key: market.get(key) for key in ("value", "low", "high", "method", "sampleSize", "confidence", "monthlyTrendPct")},
            "stability": {key: market["stability"].get(key) for key in STABILITY_KEYS}
            if isinstance(market.get("stability"), Mapping) else None,
        },
        "timingAdvisory": timing_advisory(market) if status == "market" else None,
        "catalogReference": None if status != "catalog_reference" else {
            key: market.get(key) for key in ("value", "method", "sampleSize", "confidence")
        },
        "reason": reason,
        "marketPending": bool(result.get("marketPending")),
        "lowestAsk": None if ask is None else {
            key: ask.get(key) for key in ("source", "listingId", "title", "price", "shipping", "landedPrice", "url", "verified")
        },
        "engineVersion": result.get("engineVersion"),
        "refreshedAt": refreshed_at,
    }
    if status != "market":
        record["nextRetryAt"] = add_seconds(refreshed_at, non_market_retry_seconds)
    return record


def transient_error(error: Exception) -> bool:
    """Classify only bounded transport/service failures as retryable."""
    status = getattr(error, "status", None) or getattr(error, "status_code", None)
    if isinstance(status, int):
        return status in (408, 425, 429) or 500 <= status <= 599
    code = getattr(error, "code", None)
    if isinstance(code, str) and code in {"BROWSER_AGENT_CLAIM_STALLED", "BROWSER_AGENT_OFFLINE", "BROWSER_AGENT_RECOVERY_REQUIRED"}:
        return True
    return isinstance(error, (ConnectionError, TimeoutError, OSError))


def safe_error(
    error: Exception,
    previous: Mapping[str, Any] | None = None,
    *,
    retry_base_seconds: float = DEFAULT_RETRY_BASE_SECONDS,
    retry_max_seconds: float = DEFAULT_RETRY_MAX_SECONDS,
) -> dict[str, Any]:
    """Avoid storing raw response bodies, headers, or credentials in evidence."""
    body = getattr(error, "body", None)
    job_error = body.get("error") if isinstance(body, Mapping) and isinstance(body.get("error"), Mapping) else {}
    if isinstance(body, Mapping):
        if job_error.get("code") == "NO_VERIFIED_BROWSER_MARKET":
            refreshed_at = utc_now()
            pending = {
                "status": "pending",
                "errorCode": "NO_VERIFIED_BROWSER_MARKET",
                "reason": "interactive browser analysis found no verified recent-sale Market",
                "refreshedAt": refreshed_at,
                "nextRetryAt": add_seconds(refreshed_at, NON_MARKET_RETRY_SECONDS),
            }
            job_id = getattr(error, "job_id", None) or job_error.get("jobId") or body.get("jobId")
            if isinstance(job_id, str) and 0 < len(job_id) <= 160:
                pending["jobId"] = job_id
            return pending
    attempts = 1
    if isinstance(previous, Mapping) and isinstance(previous.get("attempts"), int):
        attempts = max(1, previous["attempts"] + 1)
    refreshed_at = utc_now()
    retryable = transient_error(error)
    record = {
        "status": "error",
        "errorType": type(error).__name__,
        "message": str(error)[:500],
        "refreshedAt": refreshed_at,
        "attempts": attempts,
        "retryable": retryable,
    }
    error_code = getattr(error, "code", None) or job_error.get("code")
    job_id = getattr(error, "job_id", None) or job_error.get("jobId") or (body.get("jobId") if isinstance(body, Mapping) else None)
    if isinstance(error_code, str) and 0 < len(error_code) <= 100:
        record["errorCode"] = error_code
    if isinstance(job_id, str) and 0 < len(job_id) <= 160:
        record["jobId"] = job_id
    if retryable:
        record["nextRetryAt"] = add_seconds(refreshed_at, retry_delay_seconds(attempts, retry_base_seconds, retry_max_seconds))
    return record


def import_pricing_client(client_root: Path):
    module_path = client_root / "tcg_price_api.py"
    spec = importlib.util.spec_from_file_location("tcg_price_api", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not import PricingRestClient from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.PricingRestClient


def access_token(config: Mapping[str, Any]) -> str:
    for key in ("accessToken", "token", "TCG_PRICING_REST_TOKEN"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise ValueError("dedicated Pricing REST token is missing from the private pricing config")


def refresh(
    products: list[dict[str, Any]],
    checkpoint: dict[str, Any],
    client: Any,
    *,
    max_items: int | None,
    sleep_seconds: float,
    force: bool,
    execution_mode: str,
    write_checkpoint: Callable[[Mapping[str, Any]], None],
    market_ttl_hours: float = DEFAULT_MARKET_TTL_HOURS,
    retry_base_seconds: float = DEFAULT_RETRY_BASE_SECONDS,
    retry_max_seconds: float = DEFAULT_RETRY_MAX_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
) -> dict[str, int]:
    # Keep this guard here—not only in argparse—so no caller can accidentally
    # turn browser analysis into a scheduled or bulk refresh.
    if execution_mode == "browser" and len(products) != 1:
        raise ValueError("browser pricing accepts exactly one ProductRef per explicit invocation")
    records: dict[str, Any] = checkpoint["records"]
    completed = 0
    counts = {"attempted": 0, "market": 0, "catalog_reference": 0, "stale": 0, "pending": 0, "unavailable": 0, "error": 0, "skipped": 0, "deferred": 0}
    for product in products:
        product_id = product["productId"]
        if not force:
            due, reason = record_is_due(records.get(product_id), execution_mode, market_ttl_hours, datetime.now(timezone.utc))
            if not due:
                counts["deferred" if reason == "retry-not-due" else "skipped"] += 1
                continue
        if max_items is not None and completed >= max_items:
            break
        counts["attempted"] += 1
        completed += 1
        try:
            product_digest = hashlib.sha256(product_id.encode("utf-8")).hexdigest()[:24]
            request_id = f"tracker-{execution_mode}-market-{product_digest}"
            if execution_mode == "browser":
                result = client.price_via_browser(product, include_active=True, include_pack_out=False,
                                                  user_initiated=True, request_id=request_id,
                                                  browser_timeout=360.0, poll_interval=2.0)
            else:
                result = client.price_product(product, include_active=True, include_recent_sales=True,
                                              include_pack_out=False, request_id=request_id)
            record = latest_market_record(result, execution_mode)
        except Exception as error:  # provider failures are evidence, never a reason to abandon the pass
            record = safe_error(error, records.get(product_id), retry_base_seconds=retry_base_seconds, retry_max_seconds=retry_max_seconds)
        # Error and pending records must remain mode-scoped too; otherwise a
        # future invocation would bypass their persisted retry deadline.
        record["executionMode"] = execution_mode
        # Preserve the exact target on every terminal and retryable outcome.
        # Without it, a pending browser result cannot be safely reconciled with
        # a ProductRef by the monitor/email consumer.
        record["productId"] = product_id
        records[product_id] = record
        counts[record["status"]] += 1
        checkpoint["updatedAt"] = utc_now()
        checkpoint["lastProductId"] = product_id
        checkpoint["counts"] = counts
        write_checkpoint(checkpoint)
        if sleep_seconds > 0 and (max_items is None or completed < max_items):
            sleep(sleep_seconds)
    now = datetime.now(timezone.utc)
    checkpoint["completed"] = not any(
        record_is_due(records.get(product["productId"]), execution_mode, market_ttl_hours, now)[0]
        for product in products
    )
    checkpoint["updatedAt"] = utc_now()
    checkpoint["counts"] = counts
    write_checkpoint(checkpoint)
    return counts


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=DEFAULT_MONITOR_STATE, help="read-only monitor state.json")
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT, help="atomic sidecar checkpoint path")
    parser.add_argument("--pricing-config", type=Path, default=DEFAULT_PRICING_CONFIG, help="private Pricing REST config")
    parser.add_argument("--client-root", type=Path, default=DEFAULT_CLIENT_ROOT, help="provider clients/python directory")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="HTTPS Pricing REST base URL")
    parser.add_argument("--sleep-seconds", type=float, default=12.0, help="sequential pause between API calls (default: 12)")
    parser.add_argument("--market-ttl-hours", type=float, default=DEFAULT_MARKET_TTL_HOURS,
                        help="reprice verified Market rows after this age (default: 144 hours)")
    parser.add_argument("--retry-base-seconds", type=float, default=DEFAULT_RETRY_BASE_SECONDS,
                        help="initial retry delay for transient provider failures (default: 900)")
    parser.add_argument("--retry-max-seconds", type=float, default=DEFAULT_RETRY_MAX_SECONDS,
                        help="maximum retry delay for transient provider failures (default: 14400)")
    parser.add_argument("--mode", choices=("headless", "browser"), default="headless", help="headless Pricing REST or explicitly authorized interactive browser Analyzer")
    parser.add_argument("--user-initiated", action="store_true",
                        help="required with --mode browser; confirms this invocation is a direct user action")
    parser.add_argument("--product-id",
                        help="required with --mode browser; one exact canonical ProductRef for a foreground inspection")
    parser.add_argument("--max-items", type=int, help="bounded number of product refreshes for one invocation")
    parser.add_argument("--force", action="store_true", help="refresh even a checkpointed verified Market")
    parser.add_argument("--dry-run", action="store_true", help="show the plan without calling Pricing REST or writing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    if (args.sleep_seconds < 0 or args.market_ttl_hours < 0 or args.retry_base_seconds <= 0 or args.retry_max_seconds < args.retry_base_seconds
            or (args.max_items is not None and args.max_items <= 0)):
        raise SystemExit("invalid retry/freshness settings; --max-items must be positive")
    if args.mode == "browser" and not args.user_initiated:
        raise SystemExit("browser pricing requires an explicit direct-user invocation with --user-initiated")
    state = read_json(args.state)
    products, sources = collect_monitored_products(state)
    if args.mode == "browser":
        if not isinstance(args.product_id, str) or not args.product_id.strip():
            raise SystemExit("browser pricing requires one explicit --product-id")
        requested_product_id = args.product_id.strip()
        products = [product for product in products if product["productId"] == requested_product_id]
        if len(products) != 1:
            raise SystemExit("--product-id is not an active canonical ProductRef in the current monitor scope")
        if args.max_items not in (None, 1):
            raise SystemExit("browser pricing accepts exactly one ProductRef; omit --max-items or set it to 1")
    fingerprint = plan_fingerprint(products)
    summary = {"products": len(products), "sources": sources, "planFingerprint": fingerprint, "executionMode": args.mode, "stateLastRunAt": state.get("lastRunAt")}
    if args.dry_run:
        print(json.dumps(summary, sort_keys=True))
        return 0
    checkpoint = load_checkpoint(args.checkpoint, fingerprint, args.mode)
    checkpoint.update({"schema": CHECKPOINT_SCHEMA, "planFingerprint": fingerprint, "executionMode": args.mode, "startedAt": utc_now(), "scope": summary})
    PricingRestClient = import_pricing_client(args.client_root)
    client = PricingRestClient(args.base_url, access_token(read_json(args.pricing_config)), timeout=75.0)
    readiness = client.readiness()
    browser_ok, browser_reason = browser_agent_ready(readiness)
    if not readiness.get("ready") or (args.mode == "browser" and not browser_ok):
        checkpoint.update({
            "updatedAt": utc_now(),
            "lastRunHealth": {
                "status": "degraded",
                "reason": browser_reason if args.mode == "browser" else "Pricing REST readiness is false",
                "nextRetryAt": add_seconds(utc_now(), args.retry_base_seconds),
            },
        })
        atomic_write_json(args.checkpoint, checkpoint)
        print(json.dumps({**summary, "status": "degraded", "reason": checkpoint["lastRunHealth"]["reason"], "checkpoint": str(args.checkpoint)}, sort_keys=True))
        return 75
    counts = refresh(products, checkpoint, client, max_items=args.max_items, sleep_seconds=args.sleep_seconds,
                     force=args.force, execution_mode=args.mode, write_checkpoint=lambda payload: atomic_write_json(args.checkpoint, payload),
                     market_ttl_hours=args.market_ttl_hours, retry_base_seconds=args.retry_base_seconds, retry_max_seconds=args.retry_max_seconds)
    checkpoint["lastRunHealth"] = {
        "status": "degraded" if counts["error"] else "ready",
        "reason": "transient product refresh failures" if counts["error"] else None,
        "nextRetryAt": add_seconds(utc_now(), args.retry_base_seconds) if counts["error"] else None,
        "observedAt": utc_now(),
    }
    atomic_write_json(args.checkpoint, checkpoint)
    print(json.dumps({**summary, "counts": counts, "checkpoint": str(args.checkpoint)}, sort_keys=True))
    # Let launchd perform a bounded catch-up wake-up after a transient pass.
    return 75 if args.mode == "browser" and counts["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
