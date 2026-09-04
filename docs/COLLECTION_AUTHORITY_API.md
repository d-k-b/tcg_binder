# Tracker Collection Authority API

The local Collection Authority is the only normal monitor path allowed to read the seven private checklist Gists. It binds to `127.0.0.1:3102`, owns `TCG_TRACKER_GIST_TOKEN`, and accepts a separate `TCG_COLLECTION_AUTHORITY_TOKEN`. The monitor/provider child environments do not receive the Gist credential.

The machine-readable request and response definitions are in [`contracts/collection-authority-api.schema.json`](contracts/collection-authority-api.schema.json).

## Endpoints

- `GET /healthz` is unauthenticated liveness. It returns only `tcg.collection-authority-health/v1`, `ok`, and service `version`.
- `GET /v1/readiness` requires the authority bearer. It returns `tcg.collection-authority-readiness/v1`, credential presence as a boolean, seven safe lane states, last successful snapshot time/revision, degraded reason codes, and persisted safe retry state. This safe projection is cached for 30 seconds and includes `cache` age/mode metadata. It never returns tokens, Gist IDs/URLs, raw collection keys/content, or upstream error text.
- `GET /v1/collection/snapshot` requires the authority bearer. It returns `tcg.collection-snapshot-response/v1` containing one complete `tcg.collection-snapshot/v2`. The snapshot has exactly 688 ProductRefs and all seven lanes or the service returns a typed error with `consumerStatus: CONDITIONAL`; there is no partial/all-missing fallback. A transient source outage may reuse the most recent fully validated snapshot for up to seven days, but only as `CONDITIONAL` with `COLLECTION_SNAPSHOT_CACHE_FALLBACK`, exact cache age/revision, and `eligibleForMutation: false`. Missing, invalid, legacy, or otherwise non-retryable source failures never use this fallback.
- `GET /v1/pricing/readiness` and `POST /v1/pricing/price` require the authority bearer. Price requests accept one exact catalog ProductRef and are delegated through the Pricing Analyzer project's official `PricingRestClient`; provider credentials never enter the dashboard or wrapper. The Authority does not duplicate Pricing Analyzer valuation storage: provider cache modes and evidence-cache provenance are returned unchanged, so the Analyzer remains the single owner of its persistent sales ledger, Market recomputation, and live-ask policy.
- `POST /v1/monitor/sync` requires the authority bearer. The wrapper sends only monitor preferences. Authority rebuilds the complete collection snapshot, validates it with Pricing Analyzer's official contracts, and submits it through that project's `PriceMonitorClient`. The exact snapshot-revision/preferences/policy-derived subscription is cached in a four-entry LRU; even a cache hit is resubmitted to the monitor so the cache never substitutes for synchronization. Every subscription carries bounded `tcg.collection-ownership-policy/v1` provenance. A complete `CONDITIONAL` snapshot is retained as all 688 ProductRefs but the effective subscription is disabled, notifications are disabled, and Authority requires the monitor to acknowledge zero active targets. This is also safe with an older monitor that ignores the additive policy field.
- The supervisor's startup helper uses this same endpoint with bounded retries. It reads only the Authority URL/token from the protected environment; it does not read the monitor bearer and has no direct monitor-write path.
- `POST /v1/collection/receipt-operations` requires the authority bearer. It accepts only `tcg.collection-receipt-operation/v1`: one exact full ProductRef, an idempotency key, expected snapshot revision, quantity 1–100, delivered timestamp, and a bounded evidence reference. A successful write is read back from the affected Gist and followed by a complete seven-lane snapshot read.
- `POST /v1/admin/gist-repair` is disabled unless a separate `TCG_COLLECTION_AUTHORITY_ADMIN_TOKEN` is configured. Its default call is diagnostic; `apply: true` is explicit.

Snapshot `authority.consumerStatus` is `AUTHORITATIVE` only while every lane is complete and the oldest authenticated, validated source-read timestamp is within `TCG_COLLECTION_AUTHORITY_MAX_AGE_MS` (24 hours by default). Each source lane exposes `verifiedAt` with `verificationMethod: authenticated-github-gist-read`; the payload's older `updatedAt` is retained separately as `contentUpdatedAt`. Re-reading unchanged valid content refreshes verification provenance without changing the content-derived snapshot revision or writing the Gist. A stale complete snapshot is returned as `CONDITIONAL`; an invalid/incomplete read returns a typed failure. Consumers must retain existing inventory rows, mark ownership review-only, and must not infer that any ProductRef is missing. The regression fixture is `scripts/test_collection_authority_monitor_consumer.mjs`.

The per-lane payload `updatedAt` values are last-change evidence, not source-read freshness and not permission to manufacture no-op Gist writes. Authority now records the successful authenticated read separately. Cached fallback remains conditional because it cannot prove a current source read; a current seven-lane validated read may be authoritative even when content has not changed.

## Cache ownership and safety

Pricing results use Pricing Analyzer's provider-owned cache automatically through the official REST client. Authority-owned caching is limited to computed, validated artifacts: readiness projections, complete seven-lane snapshots, and exact monitor subscriptions. It never stores API/Gist credentials, Gist IDs or URLs, raw Gist payloads, request bodies, prompts, browser sessions, or ambiguous/partial collection state.

Authority cache schema is `tcg.collection-derived-cache/v1`; response provenance uses `tcg.collection-derived-cache-status/v1`. The file is atomically replaced with mode `0600` beneath `TCG_COLLECTION_AUTHORITY_DATA_DIR` (default `/Users/dkb/.config/tcg-price-monitor/collection-authority`), the directory is mode `0700`, monitor entries are capped at four, and the complete cache is capped at 16 MiB. A corrupt, oversized, expired, or version-mismatched cache is ignored and never prevents a live operation.

Cached collection snapshots are an availability aid, not collection authority. Receipt operations, repair verification, and monitor sync all force a live complete source read and cannot consume cached fallback state.

Marketplace source health and listing-review caches remain Pricing Analyzer-owned. Collection Authority does not copy them into its derived cache, infer source freshness from candidate counts, or turn cache telemetry into collection/alert authority. The paired extension may forward only the provider's versioned, sanitized monitor-status projection to the dashboard. Each source must carry an explicit `fresh`, `verified-empty`, `stale`, or `unavailable` state plus its checked/observed timestamp, candidate count, and bounded cache-hit/new/changed/AI-skipped counters. `verified-empty` is healthy coverage with zero candidates; `stale` or `unavailable` candidates remain excluded from normal active recommendations. An unchanged stable listing ID and evidence fingerprint is a cache hit: it must not be labeled new and must not trigger repeat detail, pricing, or AI work. The dashboard treats missing or unknown fields as unavailable, renders the projection in memory only, and never persists it to Gists or collection state.

Product identity stays catalog-exact. Prerelease variants use their exact slot ordinal; loose booster packs are `unit: pack` products in the `packs` lane; sealed displays are separate ProductRefs and lanes. Optional wrapper-art state is summarized separately with `affectsRequiredProgress: false`, so neither a sealed box nor wrapper artwork satisfies a loose-pack requirement.

## Clients

Node:

```js
const { CollectionAuthorityClient } = require('./node-app/lib/collection-authority-client');
const client = new CollectionAuthorityClient({
  baseUrl: 'http://127.0.0.1:3102',
  token: process.env.TCG_COLLECTION_AUTHORITY_TOKEN,
});
await client.readiness();
await client.snapshot();
await client.syncMonitor(preferences);
await client.receiptOperation(operation);
```

Python:

```python
from clients.collection_authority import CollectionAuthorityClient
client = CollectionAuthorityClient(token=authority_token)
client.readiness()
client.snapshot()
client.receipt_operation(operation)
```

Both clients retry only transport failures and HTTP 408/425/429/5xx, honor `Retry-After`, check contract versions, and reject a snapshot that is not exactly seven lanes/688 ProductRefs. Authentication, schema, identity, quantity, and revision errors are not retried.

## Deliberate Gist repair

Non-mutating diagnostic:

```bash
node scripts/repair_collection_authority_gists.mjs
```

The read-only diagnostic on 2026-08-31 found:

- `packs`: schema-valid.
- `collector`, `boxes`, and `prerelease`: missing default `wrapperArts` and `orderedWrapperArts` objects.
- `lorcana`: missing default `ordered`, `wrapperArts`, and `orderedWrapperArts` objects.
- `lorcana_pre`: missing default `extras`, `ordered`, `wrapperArts`, and `orderedWrapperArts` objects. It is eligible for explicit default-field repair while preserving `checks`, legacy recovery fields, and every unknown/future field.
- `lorcana_coll`: missing Gist ID. The dashboard already contained this built-in lane with a verified current state of zero owned and zero ordered; that authenticated dashboard state was used as the required source rather than inventing ownership.

For a missing lane, calculate the source file SHA-256 independently and pass both the exact file and expected digest. Apply is preflighted and idempotent; it repairs legacy defaults, creates only source-backed missing lanes, reads every changed lane back, then proves one complete seven-lane/688-ProductRef snapshot:

```bash
shasum -a 256 /path/to/verified-lorcana-coll.json
node scripts/repair_collection_authority_gists.mjs --apply \
  --source lorcana_coll=/path/to/verified-lorcana-coll.json \
  --sha256 lorcana_coll=<64-hex-digest>
```

The authorized repair was applied on 2026-09-03 from the independently hashed dashboard state. It created the private `mtg-binder-lorcana_coll.json` Gist, added only missing default objects to the five eligible legacy lanes, preserved collection quantities/recovery fields/unknown fields, and passed authenticated read-back. A subsequent sync from the older deployed dashboard removed two empty defaults from `boxes`; those fields were re-added without changing ownership. Final authenticated read-back at revision `0e6296657e552f05f6da5ed0c7e0bfce406e70cda66e7df88a9e4c9008073185` proves seven valid lanes and 688 ProductRefs.

The dashboard publisher now always includes every built-in checklist in its Gist lane set, even when a lane has zero owned, extra, or ordered entries. Custom local drafts retain the previous non-publication rule. This closes the omission that allowed `lorcana_coll` to exist in local dashboard state without ever receiving a Gist.

The earlier snapshot was complete but `CONDITIONAL` because Authority incorrectly treated the oldest content-edit timestamp (`2026-07-19T16:47:29.183Z`) as source-read freshness. That distinction is now explicit: content edit time remains metadata while a fresh authenticated seven-lane read establishes current verification provenance. Cached or failed reads still fail closed. Live read-back at `2026-09-04T15:05:14Z` returned `AUTHORITATIVE`, 688 ProductRefs, and snapshot revision `8c363b3196f54613ab79823e25fbef98021d44facc856fcfa93e852f83afc61f`; the official monitor sync accepted revision `sha256:109c3d978adfb389b555e7372a2805b927b57e96f7358fe0bb2c14d128c9b9b3` with 648 active targets. Pricing Analyzer v2.43.70 prevents an older in-progress scan from overwriting a newer policy/subscription and supports action-free evidence refresh while ownership is conditional.

## Local operation and proof

`node scripts/configure_local_price_monitor.mjs` generates the access bearer only when blank and preserves existing values. It does not generate or change the Gist token. The supervised monitor runner starts Collection Authority and the path-routing gateway on loopback. Manual starts:

```bash
cd node-app
npm run authority
npm run gateway
```

Authenticated, non-mutating proof (responses are safe projections):

```bash
curl -sS http://127.0.0.1:3102/healthz
curl -sS -H "Authorization: Bearer $TCG_COLLECTION_AUTHORITY_TOKEN" http://127.0.0.1:3102/v1/readiness
node scripts/repair_collection_authority_gists.mjs
```

## Tailscale gateway

The loopback gateway listens on `127.0.0.1:3180`. Tailscale owns the external listener; none of the application services binds to a LAN or tailnet address directly.

- Existing root `/healthz` and `/v1/*` paths continue to proxy Pricing REST on `3101`.
- `/pricing/*` proxies Pricing REST and strips the prefix.
- `/collection/*` proxies Collection Authority on `3102` and strips the prefix.
- `/monitor/*` proxies the always-on monitor on `3099` and strips the prefix.
- `/gateway/healthz` reports only gateway liveness and route names.
- Provider Authority on `3100` is intentionally not exposed.

The wrapper's production Collection Authority base URL is `https://gogo.tail903ec0.ts.net/collection`. The current Tailscale configuration uses tailnet-only Serve, not Funnel. A device must be authenticated to the tailnet, and every non-health Collection Authority route still requires its bearer. Never put the bearer in dashboard storage, query strings, logs, diagnostics, or page messages.

After reloading the unpacked Tracker extension, open its settings and configure that URL plus `TCG_COLLECTION_AUTHORITY_TOKEN`. The token is stored only in extension-private `chrome.storage.local`. With it configured, dashboard pricing, page-decoration snapshots, and collection-monitor sync use Collection Authority. The TCG Comps extension pairing remains available for browser page decoration, watch operations, monitor status, and explicit monitor runs.

Tests:

```bash
cd node-app
npm run test:authority
npm test
git diff --check
```
