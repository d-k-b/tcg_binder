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

## Pricing transports

| Transport | Path and credential | Supported surface | Credential boundary |
| --- | --- | --- | --- |
| Tracker extension | Dashboard iframe → exact-origin `postMessage` → Tracker extension → TCG Comps extension. Provider extension ID and capability token stay in the Tracker extension's `chrome.storage.local`. | Exact-product pricing plus privileged extension-owned watches, monitor controls, and page decoration where applicable. | Never place the capability token in page `localStorage` or Pricing REST settings. |
| Standalone Pricing REST | Dashboard page → `https://gogo.tail903ec0.ts.net`. Uses the separate least-privilege read-only Pricing REST token, held in memory or `localStorage["tcgDashboardPricingRest_v1"]` only after **Remember on this device**. | Authenticated readiness, headless exact-product `priceProduct`, explicit bounded source diagnostics, and direct-click-only `priceViaBrowser`. No watches, monitor mutation, page decoration, buying, or bidding. Browser-session sources are available only through the separately labeled manual Analyzer action. | Never place the REST token in source, URLs, Gists, exports, browser-job state, diagnostic results, or extension-pairing fields. |

The standalone settings prefill the non-secret production base URL. **Save & test**
calls authenticated `GET /v1/readiness` before describing the canonical authority as
available. Pricing requests then use `POST /v1/price`; an explicit source-health
button may use `POST /v1/diagnostics`; **Run full browser comps** may use the separate
`POST /v1/browser-price` job route only after a direct click. All protected routes remain fail-closed behind
the dedicated bearer token and strict `https://d-k-b.github.io` CORS policy.
Each `POST /v1/price` actively refreshes exact product identity, current public
recent sales, and requested live asks. Retained verified history is merge-only; the
dashboard never substitutes a catalog reference or stale cache entry for current
verified Market evidence. The manual browser action requires the installed TCG Comps
agent, validates exact interactive provenance, and preserves the previous valuation
on offline, timeout, queue, expiry, analysis, or contract failure. It is never used
by normal refreshes, batches, watches, monitoring, timers, or automatic retries.

An application that uses more than one API must request each required credential
in a separately labeled password field, explain its scope, and store it in a
separate local namespace. It must never silently copy a credential from another
application, put it in a URL, or bundle it into a generic settings/Gist payload.

## Extension-only consumer credential

The TCG Comps Chrome capability token and provider extension ID remain in the
Tracker extension's `chrome.storage.local`. They authorize extension messaging,
watches, page decoration, and monitor operations. They are not interchangeable
with the Pricing REST key and must never be pasted into the dashboard webpage.

## Server-only credentials

These belong in private server/extension runtime configuration and must never be
accepted by the static dashboard:

- eBay application/OAuth credentials
- the provider's OpenAI key
- provider-authority and monitor bearer tokens
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
