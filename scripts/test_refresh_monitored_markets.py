#!/usr/bin/env python3
"""Unit tests for the throttled Pricing REST market refresh worker."""

import importlib.util
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCRIPT = Path(__file__).with_name("refresh_monitored_markets.py")
SPEC = importlib.util.spec_from_file_location("refresh_monitored_markets", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

INSTALLER_SPEC = importlib.util.spec_from_file_location("install_weekly_browser_market_refresh", Path(__file__).with_name("install_weekly_browser_market_refresh.py"))
INSTALLER = importlib.util.module_from_spec(INSTALLER_SPEC)
assert INSTALLER_SPEC and INSTALLER_SPEC.loader
INSTALLER_SPEC.loader.exec_module(INSTALLER)


PRODUCT = {
    "schema": "tcg.product/v1", "productId": "mtg:dis:dissension:booster:display:en", "game": "mtg",
    "setCode": "DIS", "setName": "Dissension", "productName": "Dissension Booster Display",
    "productType": "booster", "unit": "display", "language": "en", "variant": None,
}
SECOND = {**PRODUCT, "productId": "lorcana:s3:into-the-inklands:booster:display:en", "game": "lorcana", "setCode": "S3", "setName": "Into the Inklands", "productName": "Into the Inklands Booster Box"}


class FakeClient:
    def __init__(self): self.calls = []
    def price_product(self, product, **kwargs):
        self.calls.append((product["productId"], kwargs))
        return {"schema": "tcg.valuation/v1", "product": product, "observedAt": "2026-08-29T15:00:00Z",
                "market": {"value": 723.95, "method": "median-recent-sales", "sampleSize": 1, "confidence": "low"},
                "lowestAsk": {"source": "tcgplayer", "price": 723, "shipping": 0, "landedPrice": 723, "url": "https://example.test/1", "verified": True}}
    def price_via_browser(self, product, **kwargs):
        result = self.price_product(product, **kwargs)
        result["browserExecution"] = {"schema": "tcg.browser-comp-evidence/v1", "mode": "interactive-extension"}
        return result


class RefreshMonitoredMarketsTests(unittest.TestCase):
    def test_collects_active_targets_listings_and_reviews_once(self):
        state = {"targets": {"a": {"active": True, "product": PRODUCT}, "b": {"active": False, "product": SECOND}},
                 "listings": {"l": {"active": True, "product": PRODUCT}},
                 "review": {"r": {"product": SECOND}, "bad": {"product": {"productId": "not-canonical"}}}}
        products, sources = MODULE.collect_monitored_products(state)
        self.assertEqual([product["productId"] for product in products], sorted([PRODUCT["productId"], SECOND["productId"]]))
        self.assertEqual(sources, {"targets": 1, "activeListings": 1, "review": 1, "invalid": 1})

    def test_refresh_is_sequential_checkpointed_and_uses_headless_client_only(self):
        client, writes, sleeps = FakeClient(), [], []
        checkpoint = {"schema": MODULE.CHECKPOINT_SCHEMA, "planFingerprint": "x", "records": {}}
        counts = MODULE.refresh([PRODUCT, SECOND], checkpoint, client, max_items=2, sleep_seconds=0.5, force=False, execution_mode="headless",
                                write_checkpoint=lambda value: writes.append(dict(value)), sleep=sleeps.append)
        self.assertEqual(counts, {"attempted": 2, "market": 2, "catalog_reference": 0, "stale": 0, "pending": 0, "unavailable": 0, "error": 0, "skipped": 0, "deferred": 0})
        self.assertEqual([call[0] for call in client.calls], [PRODUCT["productId"], SECOND["productId"]])
        self.assertTrue(all(call[1]["include_recent_sales"] for call in client.calls))
        self.assertTrue(all(call[1]["request_id"].startswith("tracker-headless-market-") for call in client.calls))
        self.assertEqual(sleeps, [0.5])
        self.assertEqual(checkpoint["records"][PRODUCT["productId"]]["market"]["value"], 723.95)
        self.assertGreaterEqual(len(writes), 3)

    def test_single_product_browser_mode_requires_interactive_provenance_and_reprices_headless_rows(self):
        client, writes = FakeClient(), []
        checkpoint = {"schema": MODULE.CHECKPOINT_SCHEMA, "planFingerprint": "x", "records": {PRODUCT["productId"]: {"status": "market", "executionMode": "headless"}}}
        counts = MODULE.refresh([PRODUCT], checkpoint, client, max_items=1, sleep_seconds=0, force=False, execution_mode="browser",
                                write_checkpoint=lambda value: writes.append(dict(value)))
        self.assertEqual(counts["market"], 1)
        self.assertTrue(client.calls[0][1]["user_initiated"])
        self.assertTrue(client.calls[0][1]["request_id"].startswith("tracker-browser-market-"))
        self.assertEqual(checkpoint["records"][PRODUCT["productId"]]["executionMode"], "browser")
        result = client.price_via_browser(PRODUCT)
        result["browserExecution"] = {"mode": "headless"}
        self.assertEqual(MODULE.latest_market_record(result, "browser")["status"], "unavailable")

    def test_browser_refresh_rejects_bulk_products_before_any_provider_call(self):
        client = FakeClient()
        checkpoint = {"schema": MODULE.CHECKPOINT_SCHEMA, "planFingerprint": "x", "records": {}}
        with self.assertRaisesRegex(ValueError, "exactly one ProductRef"):
            MODULE.refresh([PRODUCT, SECOND], checkpoint, client, max_items=2, sleep_seconds=0,
                           force=False, execution_mode="browser", write_checkpoint=lambda _: None)
        self.assertFalse(client.calls)

    def test_browser_cli_requires_explicit_user_initiation(self):
        with self.assertRaisesRegex(SystemExit, "--user-initiated"):
            MODULE.main(["--mode", "browser"])

    def test_browser_cli_requires_one_explicit_product_id(self):
        with self.assertRaisesRegex(SystemExit, "--product-id"):
            MODULE.main(["--mode", "browser", "--user-initiated"])

    def test_catalog_fallback_never_becomes_a_market_or_skip_eligible_row(self):
        fallback = {"schema": "tcg.valuation/v1", "product": PRODUCT, "observedAt": "2026-08-29T15:00:00Z",
                    "market": {"value": 884.39, "method": "source-market-fallback", "sampleSize": 0, "confidence": "medium"}}
        record = MODULE.latest_market_record(fallback, "headless")
        self.assertEqual(record["status"], "catalog_reference")
        self.assertIsNone(record["market"])
        self.assertEqual(record["catalogReference"]["value"], 884.39)
        checkpoint = {"records": {PRODUCT["productId"]: {"status": "market", "market": {"value": 884.39, "method": "source-market-fallback"}}}}
        MODULE.normalize_checkpoint_records(checkpoint["records"])
        self.assertEqual(checkpoint["records"][PRODUCT["productId"]]["status"], "catalog_reference")

    def test_verified_venue_balanced_consensus_is_not_misclassified_as_catalog(self):
        result = FakeClient().price_product(PRODUCT)
        result["market"]["method"] = "venue-balanced-median"
        record = MODULE.latest_market_record(result, "browser")
        self.assertEqual(record["status"], "unavailable")  # browser provenance is still mandatory
        result["browserExecution"] = {"mode": "interactive-extension"}
        record = MODULE.latest_market_record(result, "browser")
        self.assertEqual(record["status"], "market")
        self.assertEqual(record["market"]["method"], "venue-balanced-median")

    def test_browser_no_verified_market_is_pending_not_a_generic_error(self):
        class BrowserMarketMissing(Exception):
            job_id = "browser-job-no-market"
            body = {"error": {"code": "NO_VERIFIED_BROWSER_MARKET", "message": "no market"}}
        record = MODULE.safe_error(BrowserMarketMissing("no market"))
        self.assertEqual(record["status"], "pending")
        self.assertEqual(record["errorCode"], "NO_VERIFIED_BROWSER_MARKET")
        self.assertEqual(record["jobId"], "browser-job-no-market")
        self.assertNotIn("market", record)

    def test_stability_metadata_is_retained_without_promoting_trend_projection(self):
        result = FakeClient().price_product(PRODUCT)
        result["market"]["stability"] = {"consensus": 720, "trendProjection": 705, "trendUsed": False,
                                             "sourceSpreadPct": 4.2, "unexpected": "not persisted"}
        record = MODULE.latest_market_record(result, "headless")
        self.assertEqual(record["market"]["value"], 723.95)
        self.assertEqual(record["market"]["stability"]["consensus"], 720)
        self.assertEqual(record["market"]["stability"]["trendProjection"], 705)
        self.assertNotIn("unexpected", record["market"]["stability"])

    def test_timing_advisory_is_labeled_and_never_replaces_current_market(self):
        result = FakeClient().price_product(PRODUCT)
        result["market"]["monthlyTrendPct"] = -7.25
        result["market"]["stability"] = {"trendProjection": 705}
        record = MODULE.latest_market_record(result, "headless")
        self.assertEqual(record["market"]["value"], 723.95)
        self.assertEqual(record["timingAdvisory"]["basis"], "recent-sales monthly trend — advisory only")
        self.assertEqual(record["timingAdvisory"]["direction"], "down")
        self.assertEqual(record["timingAdvisory"]["percent"], -7.25)
        self.assertNotIn("trendProjection", record["timingAdvisory"])

    def test_atomic_checkpoint_is_private_and_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            MODULE.atomic_write_json(path, {"schema": MODULE.CHECKPOINT_SCHEMA, "records": {}})
            self.assertEqual(MODULE.read_json(path)["schema"], MODULE.CHECKPOINT_SCHEMA)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_verified_market_is_refreshed_after_ttl_but_not_before(self):
        now = datetime.now(timezone.utc)
        fresh = {"status": "market", "executionMode": "browser", "refreshedAt": now.isoformat().replace("+00:00", "Z")}
        old = {"status": "market", "executionMode": "browser", "refreshedAt": (now - timedelta(hours=145)).isoformat().replace("+00:00", "Z")}
        self.assertEqual(MODULE.record_is_due(fresh, "browser", 144, now), (False, "market-fresh"))
        self.assertEqual(MODULE.record_is_due(old, "browser", 144, now), (True, None))

    def test_transient_error_has_persisted_backoff_and_nontransient_does_not(self):
        class RateLimited(Exception):
            status = 429
        class BadRequest(Exception):
            status = 400
        first = MODULE.safe_error(RateLimited("slow down"), retry_base_seconds=60, retry_max_seconds=600)
        second = MODULE.safe_error(RateLimited("slow down"), first, retry_base_seconds=60, retry_max_seconds=600)
        bad = MODULE.safe_error(BadRequest("bad input"), retry_base_seconds=60, retry_max_seconds=600)
        self.assertTrue(first["retryable"])
        self.assertEqual(second["attempts"], 2)
        self.assertIn("nextRetryAt", second)
        self.assertFalse(bad["retryable"])
        self.assertNotIn("nextRetryAt", bad)

    def test_future_retry_is_deferred_without_provider_call(self):
        client = FakeClient()
        checkpoint = {"schema": MODULE.CHECKPOINT_SCHEMA, "planFingerprint": "x", "records": {
            PRODUCT["productId"]: {"status": "error", "executionMode": "browser", "nextRetryAt": "2999-01-01T00:00:00Z"}
        }}
        counts = MODULE.refresh([PRODUCT], checkpoint, client, max_items=1, sleep_seconds=0, force=False, execution_mode="browser",
                                write_checkpoint=lambda _: None)
        self.assertEqual(counts["deferred"], 1)
        self.assertFalse(client.calls)

    def test_refresh_persists_error_mode_so_backoff_survives_restart(self):
        class FailingClient(FakeClient):
            def price_via_browser(self, product, **kwargs):
                error = TimeoutError("temporary browser timeout")
                raise error
        client = FailingClient()
        checkpoint = {"schema": MODULE.CHECKPOINT_SCHEMA, "planFingerprint": "x", "records": {}}
        MODULE.refresh([PRODUCT], checkpoint, client, max_items=1, sleep_seconds=0, force=False, execution_mode="browser",
                       write_checkpoint=lambda _: None, retry_base_seconds=60, retry_max_seconds=600)
        record = checkpoint["records"][PRODUCT["productId"]]
        self.assertEqual(record["executionMode"], "browser")
        self.assertEqual(record["productId"], PRODUCT["productId"])
        self.assertEqual(MODULE.record_is_due(record, "browser", 144, datetime.now(timezone.utc))[0], False)

    def test_browser_readiness_requires_proven_interactive_agent(self):
        self.assertEqual(MODULE.browser_agent_ready({"ready": True, "browserAgentAvailable": True}), (True, None))
        self.assertEqual(MODULE.browser_agent_ready({"ready": True, "browserAgentAvailable": False}), (False, "BROWSER_AGENT_UNAVAILABLE"))
        self.assertEqual(MODULE.browser_agent_ready({"ready": True, "browserAgentAvailable": True, "browserAgent": {"errorCode": "BROWSER_AGENT_CLAIM_STALLED"}}),
                         (False, "BROWSER_AGENT_CLAIM_STALLED"))

    def test_weekly_browser_agent_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, "scheduled browser pricing is disabled"):
            INSTALLER.launch_agent(Path("/private/runtime.py"), Path("/private/worker.log"), 0, 3, 15)
        with self.assertRaisesRegex(SystemExit, "scheduled browser pricing is disabled"):
            INSTALLER.main(["--install"])

    def test_rest_error_code_and_job_id_are_preserved_safely(self):
        class RestError(Exception):
            code = "BROWSER_AGENT_OFFLINE"
            job_id = "browser-job-123"
            status = 503
        record = MODULE.safe_error(RestError("offline"), retry_base_seconds=60, retry_max_seconds=600)
        self.assertEqual(record["errorCode"], "BROWSER_AGENT_OFFLINE")
        self.assertEqual(record["jobId"], "browser-job-123")
        self.assertTrue(record["retryable"])


if __name__ == "__main__":
    unittest.main()
