"""Fail-closed Python client for the local Tracker Collection Authority API."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from typing import Any, Callable, Dict, Optional


EXPECTED_PRODUCT_COUNT = 688
EXPECTED_LANES = ("collector", "boxes", "packs", "prerelease", "lorcana", "lorcana_pre", "lorcana_coll")


@dataclass
class CollectionAuthorityClientError(RuntimeError):
    code: str
    message: str
    status: Optional[int] = None
    retryable: bool = False

    def __str__(self) -> str:
        return self.message


def _retryable(status: int) -> bool:
    return status in (408, 425, 429) or status >= 500


def _validate_snapshot(response: Dict[str, Any]) -> Dict[str, Any]:
    if response.get("schema") != "tcg.collection-snapshot-response/v1":
        raise CollectionAuthorityClientError("SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID", "Unsupported snapshot response schema")
    snapshot = response.get("snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("schema") != "tcg.collection-snapshot/v2":
        raise CollectionAuthorityClientError("SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID", "Unsupported collection snapshot schema")
    products = snapshot.get("products")
    lanes = snapshot.get("lanes")
    if not isinstance(products, dict) or len(products) != EXPECTED_PRODUCT_COUNT:
        raise CollectionAuthorityClientError("SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID", "Incomplete collection ProductRef catalog")
    if not isinstance(lanes, dict) or any(lane not in lanes for lane in EXPECTED_LANES):
        raise CollectionAuthorityClientError("SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID", "Incomplete collection lane catalog")
    if snapshot.get("revision") != response.get("revision"):
        raise CollectionAuthorityClientError("SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID", "Collection snapshot revision mismatch")
    return response


class CollectionAuthorityClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:3102",
        token: str = "",
        attempts: int = 3,
        base_delay_seconds: float = 0.25,
        opener: Optional[Callable[[urllib.request.Request], Any]] = None,
        sleeper: Callable[[float], None] = time.sleep,
    ) -> None:
        if not token:
            raise CollectionAuthorityClientError("AUTH_TOKEN_MISSING", "Collection authority bearer token is required")
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.attempts = attempts
        self.base_delay_seconds = base_delay_seconds
        self.opener = opener or urllib.request.urlopen
        self.sleeper = sleeper

    def _retry_after(self, headers: Any, fallback: float) -> float:
        raw = headers.get("Retry-After") if headers else None
        if not raw:
            return fallback
        try:
            return min(max(float(raw), 0.0), 30.0)
        except (TypeError, ValueError):
            try:
                return min(max(parsedate_to_datetime(raw).timestamp() - time.time(), 0.0), 30.0)
            except (TypeError, ValueError, OverflowError):
                return fallback

    def _request(self, path: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Authorization": "Bearer " + self.token, "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(1, self.attempts + 1):
            request = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
            try:
                with self.opener(request) as response:
                    return json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                try:
                    payload = json.loads(error.read().decode("utf-8"))
                except (ValueError, UnicodeDecodeError):
                    payload = {}
                code = payload.get("error", {}).get("code", "COLLECTION_AUTHORITY_HTTP_ERROR")
                message = payload.get("error", {}).get("message", "Collection authority request failed")
                retryable = _retryable(error.code) and payload.get("error", {}).get("retryable", True) is not False
                if not retryable or attempt == self.attempts:
                    raise CollectionAuthorityClientError(code, message, error.code, retryable) from None
                self.sleeper(self._retry_after(error.headers, min(self.base_delay_seconds * (2 ** (attempt - 1)), 5.0)))
            except (urllib.error.URLError, TimeoutError, OSError):
                if attempt == self.attempts:
                    raise CollectionAuthorityClientError(
                        "COLLECTION_AUTHORITY_TRANSPORT_RETRY_EXHAUSTED",
                        "Collection authority transport failed after bounded retries",
                        retryable=True,
                    ) from None
                self.sleeper(min(self.base_delay_seconds * (2 ** (attempt - 1)), 5.0))
        raise AssertionError("unreachable")

    def readiness(self) -> Dict[str, Any]:
        response = self._request("/v1/readiness")
        if response.get("schema") != "tcg.collection-authority-readiness/v1":
            raise CollectionAuthorityClientError("READINESS_VERSION_UNSUPPORTED", "Unsupported collection readiness schema")
        return response

    def snapshot(self) -> Dict[str, Any]:
        return _validate_snapshot(self._request("/v1/collection/snapshot"))

    def receipt_operation(self, operation: Dict[str, Any]) -> Dict[str, Any]:
        response = self._request("/v1/collection/receipt-operations", method="POST", body=operation)
        if response.get("schema") != "tcg.collection-receipt-operation-response/v1":
            raise CollectionAuthorityClientError("RECEIPT_RESPONSE_VERSION_UNSUPPORTED", "Unsupported receipt response schema")
        _validate_snapshot(response.get("snapshot", {}))
        return response


__all__ = ["CollectionAuthorityClient", "CollectionAuthorityClientError"]
