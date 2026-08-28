# API credential flow

The Collection Tracker can use several independent APIs. Each credential has one
purpose, one local storage namespace, and one rotation path. Never reuse one token
for another API or place several secrets in collection/Gist state.

## Credentials a person may paste into a dashboard or app

| Credential | Purpose | Tracker location | Local namespace | Synced? |
| --- | --- | --- | --- | --- |
| GitHub Gist personal access token | Read/write the user's private checklist Gists | Sync settings | `mtgBinder_gh` | Never; the token stays local, while checklist payloads sync |
| OpenAI API key | Photo identification and AI-assisted collection authoring | More → AI settings | `tcgDashboardOpenAI_v1` | Never |
| TCG Pricing REST access key | Read-only exact-product valuations | More → Pricing API settings | `tcgDashboardPricingRest_v1` | Never |

Each settings surface supports an explicit local-device persistence choice. The
Pricing and OpenAI records are separate from the exported collection object. The
debug report exposes only configured/remembered booleans and transport state—not
keys, endpoints, request bodies, chat contents, prices, or account identity.

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

The Pricing REST server translates one limited consumer request into provider work
without returning any upstream credential. Its separate access key authorizes only
`POST /v1/price`; it cannot create watches, run monitoring, decorate pages, buy,
bid, offer, or modify collection data.

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
