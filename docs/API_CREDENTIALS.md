# API credential flow

The Collection Tracker can use several independent APIs. Each credential has one
purpose, one local storage namespace, and one rotation path. Never reuse one token
for another API or place several secrets in collection/Gist state.

## Credentials a person may paste into a dashboard or app

| Credential | Purpose | Tracker location | Local namespace | Synced? |
| --- | --- | --- | --- | --- |
| GitHub Gist personal access token | Read/write the user's private checklist Gists | Sync settings | `mtgBinder_gh` | Never; the token stays local, while checklist payloads sync |
| OpenAI API key | Photo identification and AI-assisted collection authoring | More → AI settings | `tcgDashboardOpenAI_v1` | Never |
| TCG Pricing REST access key | Read-only exact-product valuations, source diagnostics, and explicit manual browser comps | More → Pricing API settings | `tcgDashboardPricingRest_v1` | Never |

Each settings surface supports an explicit local-device persistence choice. The
Pricing and OpenAI records are separate from the exported collection object. The
debug report exposes only configured/remembered booleans and transport state—not
keys, endpoints, request bodies, chat contents, prices, or account identity.

Verified price summaries use a fourth, non-credential namespace:
`localStorage["tcgDashboardPricingCache_v1"]`. This cache lets refreshed Market and
Buy Now values survive a page reload, but it never contains an API key. It retains
only an allowlisted exact-product display summary and the original observation time,
so the dashboard's adaptive freshness colors continue aging normally. Raw provider
evidence, request IDs, recent-sale rows, diagnostics, watches, collection/Gist state,
catalog-reference amounts, and held-out trend projections are excluded. Cached
entries are never exported or synced and cannot enable privileged extension watches
until the page receives a new exact live response.

## Pricing transports

| Transport | Path and credential | Supported surface | Credential boundary |
| --- | --- | --- | --- |
| Tracker extension + Collection Authority | Dashboard iframe → exact-origin `postMessage` → Tracker extension → authenticated Collection Authority at `https://gogo.tail903ec0.ts.net/collection` (or loopback `http://127.0.0.1:3102`). The Authority bearer stays in the Tracker extension's `chrome.storage.local`. | Complete seven-lane snapshots, exact-product pricing with Pricing Analyzer cache provenance intact, and Authority-routed monitor synchronization. A complete stale snapshot remains all 688 products but is review-only with zero active targets. | Never place the Authority bearer in page `localStorage`, Pricing REST settings, bridge payloads, Gists, exports, diagnostics, or URLs. The static dashboard must not request this server/extension credential. |
| TCG Comps extension pairing | Dashboard iframe → exact-origin `postMessage` → Tracker extension → TCG Comps extension. Provider extension ID and capability token stay in the Tracker extension's `chrome.storage.local`. | Privileged extension-owned watches, explicit monitor controls/runs, and page decoration where applicable. | Never place the capability token in page `localStorage`, Authority fields, or Pricing REST settings. |
| Standalone Pricing REST | Dashboard page → `https://gogo.tail903ec0.ts.net`. Uses the separate least-privilege read-only Pricing REST token, held in memory or `localStorage["tcgDashboardPricingRest_v1"]` only after **Remember on this device**. | Authenticated readiness, headless exact-product `priceProduct`, explicit bounded source diagnostics, and direct-click-only `priceViaBrowser`. No watches, monitor mutation, page decoration, buying, or bidding. Browser-session sources are available only through the separately labeled manual Analyzer action. | Never place the REST token in source, URLs, Gists, exports, browser-job state, diagnostic results, or extension-pairing fields. |

The standalone settings prefill the non-secret production base URL. **Save & test**
calls authenticated `GET /v1/readiness` before describing the canonical authority as
available. Pricing requests then use `POST /v1/price`; an explicit source-health
button may use `POST /v1/diagnostics`; **Run full browser comps** may use the separate
`POST /v1/browser-price` job route only after a direct click. All protected routes remain fail-closed behind
the dedicated bearer token and strict `https://d-k-b.github.io` CORS policy.
Each `POST /v1/price` rechecks exact product identity and requested live asks. The
provider discovers new public recent-sale rows once per UTC day, stores stable sale
identities in its ProductRef ledger, and reuses Market until the adaptive
trend/dispersion forecast reaches its change band. The dashboard never substitutes
a catalog reference for verified Market evidence. Its separate sanitized device
cache preserves the allowlisted provider mode (`cold`, `incremental-analysis`,
`market-cache`, or `stale-fallback`) and sale-derived Market timestamp so page reloads
do not erase provenance or make a reused Market appear newly analyzed. No provider
cache key, raw sale row, credential, or request body is retained. A browser run requires the
installed agent **and** an explicit `userInitiated:true` direct click; it preserves
the extension evidence cache and is rejected before queueing when called by a
scheduled/background path.

An application that uses more than one API must request each required credential
in a separately labeled password field, explain its scope, and store it in a
separate local namespace. It must never silently copy a credential from another
application, put it in a URL, or bundle it into a generic settings/Gist payload.

## Extension-only consumer credential

The TCG Comps Chrome capability token and provider extension ID remain in the
Tracker extension's `chrome.storage.local`. They authorize extension messaging,
watches, page decoration, and monitor operations. They are not interchangeable
with the Pricing REST key and must never be pasted into the dashboard webpage.

The Collection Authority bearer is a second extension-private credential. It
authorizes the wrapper's `/v1/collection/snapshot`, `/v1/pricing/*`, and
`/v1/monitor/sync` calls and is not interchangeable with either the TCG Comps
capability token or the standalone Pricing REST key. Static dashboard pages must
never accept or store it.

## Server-only credentials

These belong in private server/extension runtime configuration and must never be
accepted by the static dashboard:

- eBay application/OAuth credentials
- the provider's OpenAI key
- Collection Authority, provider-authority, and monitor bearer tokens
- Resend and Discord delivery credentials
- marketplace cookies or browser sessions

The Pricing REST server at `https://gogo.tail903ec0.ts.net` translates one limited
consumer request into provider work without returning any upstream credential. Its
separate access key authorizes only authenticated readiness, `POST /v1/price`,
credential-safe `POST /v1/diagnostics`, and direct-click browser-Analyzer jobs;
it cannot create watches, run monitoring, decorate pages, buy, bid, offer, or modify
collection data.

## Creating and rotating the Pricing REST key

In the TCG Comps repository:

```bash
npm run credentials:pricing-rest
```

This creates a git-ignored, owner-readable `.local/api-credential-inventory.json`.
Use its `TCG_PRICING_REST_TOKEN` value in the hosted server configuration and paste
the matching consumer value into each trusted dashboard device. The inventory also
lists placeholders for the user's existing GitHub and OpenAI credentials; it never
extracts them from browser storage.

To rotate the key, generate a new inventory, update the hosted server secret, and
replace the saved Pricing REST key on every device. Rotation does not affect
collection quantities, stable keys, migrations, Gists, or pricing ProductRefs.

Keep the inventory in a password manager or encrypted notes. Never commit it or
paste it into a debug report.
