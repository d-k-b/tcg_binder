import io
import json
import pathlib
import sys
import unittest
import urllib.error

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from collection_authority import CollectionAuthorityClient, CollectionAuthorityClientError


def snapshot_fixture():
    lanes = {lane: {"required": 1, "owned": 0, "missing": 1, "productCount": 1} for lane in (
        "collector", "boxes", "packs", "prerelease", "lorcana", "lorcana_pre", "lorcana_coll"
    )}
    products = {f"fixture:{index}": {"product": {"productId": f"fixture:{index}"}, "target": 1, "owned": 0, "missing": 1}
                for index in range(688)}
    revision = "a" * 64
    return {
        "schema": "tcg.collection-snapshot-response/v1",
        "generatedAt": "2026-08-31T12:00:00.000Z",
        "revision": revision,
        "authority": {"consumerStatus": "AUTHORITATIVE", "degradedReasonCodes": []},
        "snapshot": {"schema": "tcg.collection-snapshot/v2", "revision": revision, "lanes": lanes, "products": products},
    }


class Response:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class CollectionAuthorityClientTests(unittest.TestCase):
    def test_method_and_schema_parity(self):
        fixture = snapshot_fixture()
        seen = []

        def opener(request):
            seen.append((request.method, request.full_url, request.headers.get("Authorization")))
            if request.full_url.endswith("/v1/readiness"):
                return Response({"schema": "tcg.collection-authority-readiness/v1", "ready": True})
            if request.full_url.endswith("/receipt-operations"):
                return Response({"schema": "tcg.collection-receipt-operation-response/v1", "snapshot": fixture})
            return Response(fixture)

        client = CollectionAuthorityClient(token="python-token", opener=opener)
        self.assertTrue(client.readiness()["ready"])
        self.assertEqual(client.snapshot()["revision"], fixture["revision"])
        self.assertEqual(client.receipt_operation({"schema": "tcg.collection-receipt-operation/v1"})["schema"],
                         "tcg.collection-receipt-operation-response/v1")
        self.assertEqual([row[0] for row in seen], ["GET", "GET", "POST"])
        self.assertTrue(all(row[2] == "Bearer python-token" for row in seen))

    def test_retry_after_and_fail_closed(self):
        fixture = snapshot_fixture()
        calls = 0
        sleeps = []

        def opener(request):
            nonlocal calls
            calls += 1
            if calls == 1:
                payload = io.BytesIO(json.dumps({"error": {"code": "TEMPORARY", "message": "temporary"}}).encode())
                raise urllib.error.HTTPError(request.full_url, 503, "temporary", {"Retry-After": "0"}, payload)
            return Response(fixture)

        client = CollectionAuthorityClient(token="python-token", attempts=2, opener=opener, sleeper=sleeps.append)
        self.assertEqual(client.snapshot()["revision"], fixture["revision"])
        self.assertEqual(calls, 2)
        self.assertEqual(sleeps, [0.0])

        fixture["snapshot"]["products"] = {}
        with self.assertRaises(CollectionAuthorityClientError) as caught:
            CollectionAuthorityClient(token="python-token", opener=lambda _request: Response(fixture)).snapshot()
        self.assertEqual(caught.exception.code, "SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID")

        no_retry_calls = 0
        def incomplete_opener(request):
            nonlocal no_retry_calls
            no_retry_calls += 1
            payload = io.BytesIO(json.dumps({"error": {
                "code": "COLLECTION_SNAPSHOT_INCOMPLETE", "message": "incomplete", "retryable": False
            }}).encode())
            raise urllib.error.HTTPError(request.full_url, 503, "incomplete", {}, payload)

        with self.assertRaises(CollectionAuthorityClientError) as incomplete:
            CollectionAuthorityClient(token="python-token", attempts=3, opener=incomplete_opener).snapshot()
        self.assertEqual(incomplete.exception.code, "COLLECTION_SNAPSHOT_INCOMPLETE")
        self.assertEqual(no_retry_calls, 1)


if __name__ == "__main__":
    unittest.main()
