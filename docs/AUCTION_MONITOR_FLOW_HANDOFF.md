# Collection Deal and Auction Monitor — Cross-Task Flow Handoff

Last updated: 2026-08-09 (America/Chicago)

## Mission

Implement a conservative, exact-product monitor for sealed MTG and Lorcana products that the Collection Tracker says are still missing. The completed flow must:

- continuously discover matching eBay, TCGplayer, Heritage, and supported storefront/auction listings;
- send an immediate email for a verified fixed-price listing whose landed price is at least 20% below verified Market (`landedPrice / market.value <= 0.80`);
- send one daily digest at 07:00 America/Chicago containing new matches and the current state of watched auctions;
- remain fail-closed on ambiguous identity, mixed lots, stale market-only fallback, missing shipping/premium data, or insufficient confidence;
- never bid, buy, or place an offer automatically;
- keep working when the user's Mac or browser is asleep by using an always-on monitor service;
- preserve the existing ownership boundary: the Tracker owns collection need, TCG Comps owns listing identity/pricing/watch authority, and the monitor service owns scheduling/deduplication/email delivery.

## Coordinating tasks

| Lane | Thread | Canonical scope |
|---|---|---|
| Monitor / coordinator | `019fe7d2-ce14-7c22-83f9-375a014d5e3a` | This file, cross-task contracts, integration verification, status, blocker resolution |
| Dashboard | `019f78d2-e682-70b1-932b-d46e1809598f` | `generators/`, generated dashboard/data, dashboard state/Gist behavior, dashboard tests/docs |
| Tracker Extension | `019fba5b-db67-7b30-ae5c-66b09898341f` | `browser-extension/`, privileged iframe/provider bridge, extension settings/status/diagnostics, extension tests/docs |
| Price Analysis Extension / TCG Comps | `019fbb41-8f43-7e70-a66b-83593653065d` | `/Users/dkb/Apps/Extensions/TcgPriceComparisons`, provider API/contracts, exact source adapters, always-on monitor service, valuation/watch/delivery tests/docs |

Only the Monitor task edits the status and decision-log sections in this file. Other tasks report progress and evidence by messaging the Monitor task and any direct consumer/provider task named below.

## Non-negotiable ownership boundaries

### Dashboard owns

- Current `target`, `owned`, `missing`, required/optional status, and user-visible monitoring preferences.
- The generated dashboard UI and Gist/local-state persistence for non-secret preferences.
- The canonical `tcg.collection-snapshot/v2` derived from current in-memory ownership.
- Exact-origin/exact-frame postMessage behavior to its owning Tracker extension.

The Dashboard must not fetch marketplaces, store marketplace credentials, calculate Market, create provider IDs, send email, or persist listing/watch results.

### Tracker Extension owns

- The trusted cross-origin bridge between the dashboard iframe and TCG Comps.
- TCG Comps capability credentials in `chrome.storage.local` only.
- User-triggered and debounced monitor synchronization, provider monitor status, and sanitized diagnostics.
- No marketplace parsing or matching.

The Tracker Extension must not copy TCG Comps pricing/matching logic, scrape marketplace DOM, store GitHub credentials, or send provider secrets to the dashboard.

### TCG Comps owns

- ProductRef validation, exact marketplace identity matching, source adapters, AI verification, market calculation, landed-price calculation, confidence, watch state, listing fingerprints, and alert eligibility.
- Provider API methods and packaged consumer client/bridge artifacts.
- The always-on monitor service, durable source cursors/listing state/deduplication, Resend delivery, and digest assembly.
- Active asks are live-only. `stale-fallback` may provide labeled historical Market but can never create an alert.

### Monitor task owns

- This shared contract and status record.
- Cross-repository/system verification and conflict resolution.
- Final implementation evidence and external deployment prerequisites.

## Existing contracts that remain authoritative

- Product identity: `tcg.product/v1`.
- Collection snapshot: `tcg.collection-snapshot/v2`, namespace `collection-tracker`, maximum 1,200 products.
- Valuation: `tcg.valuation/v1`.
- Watch rule: `tcg.watch-rule/v1`.
- Alert event: `tcg.alert/v1`.
- Dashboard pricing channel: `tcg-pricing/v1`.
- Dashboard collection channel: `tcg-collection/v1`.

All 686 Tracker pricing products must remain one atomic collection snapshot. Snapshot keys must equal the included canonical `ProductRef.productId`. Provider-specific identifiers are provenance only.

## New monitor subscription contract

The cross-task integration uses this versioned bundle. Dashboard produces it, Tracker Extension validates/forwards it, and TCG Comps validates/persists only the monitor-safe fields.

```json
{
  "schema": "tcg.collection-monitor-subscription/v1",
  "namespace": "collection-tracker",
  "revision": "stable-content-hash",
  "generatedAt": "2026-08-09T12:00:00.000Z",
  "preferences": {
    "enabled": true,
    "maxMarketRatio": 0.8,
    "minimumConfidence": "medium",
    "sources": ["ebay", "tcgplayer", "heritage", "store"],
    "includeOptional": false,
    "instantFixedPriceEmail": true,
    "dailyDigest": {
      "enabled": true,
      "time": "07:00",
      "timezone": "America/Chicago"
    }
  },
  "collection": {
    "schema": "tcg.collection-snapshot/v2",
    "namespace": "collection-tracker",
    "products": {}
  }
}
```

Rules:

- `revision` is deterministic for the normalized collection and preferences; timestamps alone must not create a new revision.
- The bundle contains no checklist keys, extras keys, Gist metadata, GitHub credentials, provider credentials, prices, watches, listing history, email address, or tokens.
- Required products with `missing > 0` are automatically active monitor targets when monitoring is enabled.
- Optional products are inactive unless `includeOptional` is true or a future per-product override explicitly enables one.
- A product whose required target becomes satisfied is deactivated on the next accepted revision without deleting historical listing/email evidence.
- Default threshold means "at least 20% below Market": `maxMarketRatio = 0.80`.

## Dashboard-to-Tracker monitor channel

New channel: `tcg-collection-monitor/v1`.

Request:

```json
{
  "channel": "tcg-collection-monitor/v1",
  "type": "monitorSubscription",
  "requestId": "tracker-generated-request-id"
}
```

Success response:

```json
{
  "channel": "tcg-collection-monitor/v1",
  "type": "monitorSubscriptionResult",
  "requestId": "tracker-generated-request-id",
  "result": { "schema": "tcg.collection-monitor-subscription/v1" }
}
```

The dashboard may also emit a non-secret `monitorStateChanged` hint after ownership or preferences change. The hint contains no snapshot or credentials. The Tracker Extension debounces the hint, requests a fresh full bundle, and forwards only that validated bundle.

Additive Tracker-to-Dashboard status request on the same channel:

```json
{
  "channel": "tcg-collection-monitor/v1",
  "type": "monitorSyncStatus",
  "requestId": "tracker-generated-request-id",
  "status": {
    "schema": "tcg.collection-monitor-sync-status/v1",
    "state": "idle|syncing|synced|error|unavailable",
    "revision": "stable-content-hash-or-null",
    "productCount": 686,
    "activeTargetCount": 123,
    "monitorConfigured": true,
    "syncedAt": "2026-08-09T12:00:01.000Z",
    "message": "credential-free status text",
    "errorCode": null
  }
}
```

Dashboard acknowledgement:

```json
{
  "channel": "tcg-collection-monitor/v1",
  "type": "monitorSyncStatusResult",
  "requestId": "tracker-generated-request-id",
  "result": {
    "schema": "tcg.collection-monitor-sync-status-ack/v1",
    "accepted": true
  }
}
```

The dashboard exact-validates every bounded field and keeps this status in memory only. The status must never contain URLs with credentials, capability/bearer tokens, email addresses, raw provider responses, stack traces, or collection products.

Every message must require exact `event.origin`, exact iframe/window source, exact channel/type/request ID, and exact response schema. Never use `*`.

## Tracker-to-TCG-Comps provider methods

Additive API v1 methods; final names may change only by explicit cross-task agreement recorded here:

- `pricing.monitor.syncCollection` with `{ subscription }`.
- `pricing.monitor.status` with no collection/credential echo.
- `pricing.monitor.run` only for an explicit user action; scheduled server scans do not route through this browser method.

`syncCollection` returns at minimum:

```json
{
  "accepted": true,
  "revision": "stable-content-hash",
  "productCount": 686,
  "activeTargetCount": 123,
  "monitorConfigured": true,
  "syncedAt": "2026-08-09T12:00:01.000Z"
}
```

The Provider extension may retain the last accepted non-secret revision/status, but the always-on service is the durable authority for scheduled monitoring.

## Always-on monitor HTTP surface

All state-changing endpoints require a bearer token. Remote endpoints require HTTPS; loopback HTTP remains allowed for local testing.

- `GET /healthz` — liveness and schema/service version only.
- `GET /v1/status` — authenticated counts, last accepted revision, source run times, next digest time, delivery configuration; no secrets.
- `PUT /v1/collection-subscription` — idempotent subscription upsert.
- `POST /v1/run` — authenticated explicit/manual run for system testing and operations.
- Existing `POST /v1/alerts` remains supported for verified alert ingestion/backward compatibility.

Durable state must use atomic writes or a transactional store and include:

- accepted subscription revision and normalized preferences;
- source cursor/run state;
- normalized listing identity and lifecycle;
- listing fingerprints and email event IDs;
- last instant notification and price-change information;
- daily digest watermark and delivery result.

The service must recover safely after restart without resending already delivered events.

## Source behavior

### eBay

- Use official Browse API active listings with separate fixed-price and auction discovery.
- Capture item/listing ID, creation/end timestamps, buying options, bid count, price, shipping, URL, seller/location evidence, and availability.
- Suggested scan cadence: five minutes.
- Every candidate must pass the existing exact ProductRef/AI verification before valuation or alerting.

### TCGplayer

- Reuse the hardened exact product matcher and live listing data.
- Suggested scan cadence: fifteen minutes.
- Do not treat a product-wide Market value as an active ask.

### Heritage

- Add a narrowly scoped active-auction adapter with known buyer premium and end time included in all-in calculations.
- Where authenticated discovery is required, support Heritage MyWantlist email/link ingestion or a documented user-session adapter; do not pretend an undocumented public API exists.
- Ambiguous, mixed, or incomplete lots remain review-only.

### Store and additional auction adapters

- Reuse exact host/path adapters and the shared listing-surface contract.
- OpenBoosters remains exact-host/path and preserves the random/mixed-box exclusion.
- New adapters require live-DOM evidence plus fixtures/regressions. Generic matcher weakening is prohibited.

## Alert eligibility

### Instant fixed-price email

All conditions are required:

1. The accepted collection revision says the exact product is active and missing.
2. The listing is currently purchasable as fixed price / Buy It Now.
3. Exact-product verification succeeds with confidence at or above the subscription minimum.
4. Market exists, is verified, and is not `stale-fallback`.
5. Landed price includes item price plus known shipping and buyer premium where applicable.
6. `landedPrice <= market.value * maxMarketRatio`.
7. The listing fingerprint/event has not already been delivered, unless a material price reduction creates a new deterministic event.

Tax may be labeled unknown and excluded when the source cannot determine it. Unknown shipping or buyer premium prevents an instant alert unless the price is conservatively bounded and the reason is explicit and tested.

### Daily digest

One digest at 07:00 America/Chicago, idempotent by local date and subscription namespace. Include:

- best new opportunities;
- new fixed-price listings;
- auctions ending within 24 hours;
- every actively watched auction with current all-in bid, Market, discount, bids, and time remaining;
- price reductions and material bid changes;
- listings closed/sold/removed since the prior digest;
- review-only ambiguous/thin/stale matches, clearly separated from actionable deals;
- source health and stale-source warnings.

Auctions do not produce the fixed-price instant email. A future optional ending-soon alert requires separate user approval and contract work.

## Work packages and acceptance gates

### Dashboard task

1. Add generator-owned Monitoring preferences UI with the contract defaults.
2. Persist only non-secret preferences through existing state/Gist flows with safe migration/default behavior.
3. Generate the exact subscription bundle on demand from current in-memory state.
4. Add exact-origin/frame monitor channel plus debounced state-change hint.
5. Show last bridge/provider sync status supplied by the Tracker Extension without persisting secrets.
6. Preserve all current ownership keys, extras, quantities, Gist behavior, and the 686-product snapshot.
7. Regenerate all canonical outputs.

Required tests: preference migration/defaults, deterministic revision, 686 full ProductRefs, ownership update changes revision, no key/credential leakage, exact message validation, no state mutation during snapshot creation, Gist round trip, desktop and 360–390 px system/UI verification, generated-copy parity, full `node-app` suite.

### Tracker Extension task

1. Consume the new dashboard monitor channel and validate the full subscription.
2. Add explicit Sync monitor control, monitor status, last accepted revision/time, and credential-safe diagnostics.
3. Debounce `monitorStateChanged` and resync while the side panel is active.
4. Add packaged provider client methods after Provider finalizes them.
5. Preserve minimal permissions and existing pricing/page-decoration behavior.
6. Bump `manifest.json` for every delivered code change and remind the user to Reload.

Required tests: wrong origin/frame/schema/request ignored, duplicate revision idempotence, changed revision forwarded, 686-product atomic forwarding, missing/unauthorized/offline monitor states, capability token redaction, no dashboard/Gist credential access, existing extension and repository suite, real side-panel system check after reload.

### Price Analysis Extension / TCG Comps task

1. Read `HANDOFF.md` and preserve the required version-bump/full-test workflow.
2. Add and document the provider monitor methods/contracts and packaged client/bridge support.
3. Extend the monitor receiver into an always-on subscription/scanning/digest service without duplicating pricing authority.
4. Refactor environment-neutral exact matching/valuation components for headless use where needed; do not create a weaker second matcher.
5. Implement eBay, TCGplayer, Heritage, and exact store adapter paths with fail-closed evidence.
6. Implement durable source/listing/event/digest state and restart-safe idempotence.
7. Implement Resend instant and daily digest content with HTML escaping and provider idempotency keys.
8. Keep Chrome alarms/notifications as best-effort supplemental delivery.

Required tests: contract validation, 686-product subscription, revision idempotence, active-target derivation, source adapter fixtures, exact/ambiguous/mixed/stale cases, landed-price and premium math, 0.80 boundary, fixed-vs-auction routing, cooldown/dedup, restart recovery, instant Resend idempotence, daily timezone/idempotence, authenticated HTTP surface, injected end-to-end subscription -> source scan -> instant + digest system test, full extension suite. Bump provider version and instruct Reload.

## Cross-task messaging protocol

Every task must message the Monitor thread at each of these points:

- contract question or blocker;
- contract implemented with exact schema and file locations;
- unit tests green with counts;
- system test green with scenario/evidence;
- final lane completion with version/build stamp and external prerequisites.

Direct messages also required:

- Dashboard -> Tracker Extension when the dashboard channel/bundle is ready.
- Tracker Extension -> Dashboard if UI/status contract needs correction.
- TCG Comps -> Tracker Extension when provider methods and packaged client artifacts are ready.
- Tracker Extension -> TCG Comps for any API/authorization/schema failure.

No task should silently change another task's owned files. Contract changes require a message to both the direct consumer/provider and Monitor before implementation proceeds.

## Integrated system acceptance

The implementation is complete only when all of the following are proven:

1. A dashboard ownership/preference change creates a new deterministic subscription revision without exposing keys or credentials.
2. Tracker Extension forwards all 686 canonical ProductRefs atomically through the authenticated provider method.
3. The always-on service accepts the revision idempotently and derives only currently missing targets by default.
4. A fixture or controlled exact eBay fixed-price listing at exactly 80% of verified Market produces one instant email event; 80.01% does not.
5. Replaying or restarting does not resend the same event.
6. An auction is tracked into the daily digest with end time, bid count, all-in price, Market, and discount, but does not produce the fixed-price instant alert.
7. A Heritage buyer premium is included before discount/bid guidance.
8. Stale fallback, ambiguous identity, mixed lots, missing required cost components, and insufficient confidence are review-only.
9. A satisfied collection target is deactivated after the next sync.
10. The daily digest sends once for the America/Chicago local date and includes source-health warnings.
11. Existing pricing, page-decoration, collection, Gist, migration, and responsive UI tests remain green.
12. The actual generated dashboard and unpacked extension surfaces are verified after regeneration/reload, not only unit tested.

## External configuration and deployment prerequisites

Implementation and deterministic system tests must not wait on these, but live production delivery will require:

- an always-on Docker/NAS/hosted Node runtime;
- an HTTPS monitor URL or loopback URL for local operation;
- a strong monitor bearer token;
- Resend API key, verified sender/domain, and destination email;
- eBay production application credentials;
- any required TCGplayer/OpenAI credentials in server environment only;
- a Heritage account/session or MyWantlist email route if active public discovery is insufficient.

No secret belongs in this repository, generated HTML, dashboard state, Gist, debug report, or thread message.

## Status

| Lane | State | Last evidence | Next action |
|---|---|---|---|
| Monitor | implementation and system handoff complete | Dashboard complete; Provider `2.42.0` complete; Tracker `1.3.2` complete; authenticated real-Edge loopback proof and cleanup complete | Supply production credentials/destination, deploy the always-on service, publish the dashboard, and perform a production smoke test under separate authorization |
| Dashboard | complete | Build `2026-08-09 14:03`; full suite, SHA-256 HTML/data parity, diff check, desktop 1280 and narrow 390/360 HTTP QA green; stale vendor references updated to `2.42.0` and full suite rerun green | Publish/deploy only with separate user authorization |
| Tracker Extension | complete | `1.3.2`; exact Provider `2.42.0` contracts/client/bridge vendored and hash-verified; full shared suite green; real Edge startup-readiness and run-status-retention regressions fixed; permissions remain `sidePanel` + `storage`; authenticated and sanitized failure paths verified; dashboard source restored to `https://d-k-b.github.io/tcg_binder/` with live iframe and no extension Errors entry | Reload after any future checkout/update; configure the production monitor endpoint/token only when deployed |
| TCG Comps | complete; vendor-ready | `2.42.0`; exact monitor methods/schemas, durable service, source adapters, delivery/idempotence engine, safe response projection, all required/full suites green; packaged hashes delivered | Deploy/configure the always-on service and production credentials outside this repository; reload extension |
| Integrated system | implementation and local system QA complete | Real Edge authenticated revision `5c6bafe8cef707ac` ACK matched 686 products and 646 active targets; status and deterministic no-source Run succeeded; Run retained revision/count/time; 80.00%/80.01%, auction digest, Heritage landed-cost, restart/idempotence and target-deactivation scenarios green; failure diagnostics verified | Production activation requires service hosting, Resend/source credentials, destination email, exact remote host permission, dashboard publish, and a production smoke test |

## Decision log

- 2026-08-09: Treat "20% or below market" as at least 20% below verified Market (`ratio <= 0.80`).
- 2026-08-09: Always-on service is required; Chrome alarms remain supplemental only.
- 2026-08-09: Required missing products are auto-monitored; optional products default off.
- 2026-08-09: Auctions appear in the daily digest; the immediate email is fixed-price only.
- 2026-08-09: TCG Comps remains the sole pricing/matching/watch authority; consumers use versioned contracts.
- 2026-08-09: Dashboard and Tracker Extension added a credential-free, memory-only `monitorSyncStatus` / `monitorSyncStatusResult` exchange on `tcg-collection-monitor/v1`; subscription and state-change contracts are unchanged.
- 2026-08-09: User explicitly approved sending the authenticated 686-ProductRef subscription, target/owned/missing counts, and non-secret monitor preferences to the user-configured HTTPS monitor endpoint. The approval excludes provider capability credentials, GitHub/Gist data or tokens, checklist/extras/legacy keys, pricing credentials, cookies, page HTML, email addresses, prices, watches, and session data; those remain outside the transmitted catalog payload.
- 2026-08-09: User explicitly approved transmitting the authenticated `tcg.collection-monitor-subscription/v1` payload to the user-configured HTTPS or loopback monitor endpoint. Approval covers canonical ProductRefs, target/owned/missing counts, and non-secret monitor preferences only; all previously excluded credentials/secrets remain prohibited.
- 2026-08-09: User explicitly approved a temporary live-profile loopback success-path test. Tracker `1.3.2` and TCG Comps `2.42.0` completed authenticated sync/status/run in real Edge with exact revision `5c6bafe8cef707ac`, 686 products, and 646 active targets. The test used the deterministic no-source service configuration and sent no email or marketplace action.
- 2026-08-09: Real Edge QA found and fixed an initial `about:blank` iframe postMessage race by requiring verified cross-origin frame readiness, and fixed successful Run responses clearing prior sync counts/time by retaining that state in memory. Both regressions have automated coverage.
- 2026-08-09: Temporary loopback cleanup was proven: provider reported `monitorWebhookTokenSet:false`; `pricingMonitorWebhookUrl` and `pricingMonitorWebhookToken` were absent from extension-owned storage without exposing the token; ports 3099 and 8766 were stopped; the temporary directory was deleted. No deploy, publish, commit, bid, buy, offer, or email send occurred.
- 2026-08-09: Tracker's dashboard source was restored after QA from the stopped localhost URL to `https://d-k-b.github.io/tcg_binder/`; the live iframe loaded. Edge then showed Tracker `1.3.2` and TCG Comps `2.42.0` with no Errors entry.
