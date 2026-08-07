# Browser extension handoff

This document is the working contract for the **extension workstream**. Use the
root [`HANDOFF.md`](../HANDOFF.md) for collecting rules, dashboard internals, data
generation, and GitHub Pages deployment.

## Scope and ownership

The two active workstreams share one repository but have different owners:

| Workstream | Owns | Does not own |
|---|---|---|
| **Browser extension** | `browser-extension/`, Chrome/Edge side-panel behavior, extension controls, permissions, packaging, TCG Comps credentials, and the privileged half of the pricing bridge | Dashboard rows, collecting rules, generated HTML, dashboard responsive layout, or Gist progress logic |
| **Dashboard** | `generators/`, `data/`, the three generated HTML copies, dashboard UI/state/sync, and GitHub Pages publishing | Extension manifest, side-panel chrome, browser permissions, or extension-only pricing orchestration |

The extension workstream should not edit `index.html`, `mtg_binder_app.html`, or
`apps/static/index.html`. Dashboard work remains generator-first through
`generators/build_app.py` and should be handled in the dashboard workstream.

Changes to the interface between the two layers must be coordinated and documented
in both handoffs. Examples include changing the published URL, preventing framing,
adding a pricing-message API, or changing which origin owns progress storage.

## Current state

- Extension version: **1.2.1**.
- Manifest: Chrome/Edge Manifest V3.
- Primary surface: persistent browser side panel/sidebar.
- Toolbar action and default shortcut: open the panel.
- Dashboard source: `https://d-k-b.github.io/tcg_binder/`.
- Local development source: an optional `http://127.0.0.1:<port>/` or
  `http://localhost:<port>/` URL selected from the extension gear.
- Extension permissions: `sidePanel` and `storage` only.
- Regression coverage: `node-app/tools/test-browser-extension.js`, run by
  `npm test` from `node-app/`.
- Pricing provider contract: TCG Comps API v1. Provider release numbers are
  diagnostic metadata, not the compatibility boundary.
- Vendored, unmodified provider artifacts:
  `vendor/tcg-comps-2.40.0/{pricing-contracts,pricing-client,pricing-bridge}.js`.

Version 1.0.1 fixed the first real extension-layout defect: when Settings was
hidden, CSS Grid auto-placement moved the iframe into the 150px intrinsic-height
settings row and left the flexible row empty. The toolbar, optional Settings panel,
and dashboard now explicitly occupy grid rows 1, 2, and 3.

Version 1.1.0 implements the TCG Comps bridge. The tracker extension stores only the
provider extension ID and capability token in `chrome.storage.local`; the generated
dashboard receives only the tracker's non-secret extension origin. The iframe sends
ProductRef/watch messages to its exact parent origin, and the extension accepts them
only from the exact configured dashboard origin and `dashboard.contentWindow`.

Version 1.1.1 stops presenting a newer provider release as an error when its status
response still negotiates API v1. The connection stays green and explains that the
release difference is informational. The unmodified vendored scripts retain their
2.34.0 provenance because they are byte-identical to the provider's later API v1
artifacts.

Version 1.2.0 adds a direct **Mark collection needs on this page** action. The
dashboard builds one ephemeral `tcg.collection-snapshot/v2` containing all 686 full
canonical ProductRefs and their current target/owned/missing counts. The extension
validates the exact iframe response and calls TCG Comps 2.40.0
`pricing.page.decorateCollection` with `userInitiated:true`. TCG Comps owns page
discovery, exact matching, and the namespaced marketplace overlay; the Tracker adds
no marketplace host, scripting, tab, or `externally_connectable` permission.

Version 1.2.1 adds an error-only copy icon to the page-check status surface. Its
sanitized report identifies the failure stage, dashboard URL/origin/load time,
snapshot schema/product count, Tracker/provider versions and IDs, elapsed time,
error code/message, and stack. `diagnosticText()` redacts the current capability
token if an upstream error ever echoes it; the report never serializes the token.
Snapshot timeouts now carry `DASHBOARD_SNAPSHOT_TIMEOUT`, making a stale public
dashboard distinguishable from TCG Comps authorization or content-script failures.

## How the extension uses the dashboard

The extension does **not** contain or regenerate the collection UI. It embeds the
canonical GitHub Pages dashboard in `sidepanel.html`:

```text
Chrome / Edge side panel
  extension toolbar (local extension HTML/CSS/JS)
    mark page | refresh latest | open full tab | choose dashboard source | pair TCG Comps
    chrome.storage.local: provider extension ID + capability token
  iframe
    https://d-k-b.github.io/tcg_binder/
      generated dashboard UI
      collection data
      local progress
      GitHub Gist sync
      ProductRef requests only (no capability token)
        ↕ exact-origin + exact-frame postMessage
      extension bridge → TCG Comps API v1
      on-demand collection snapshot (ProductRefs + counts only)
        ↕ exact-origin + exact-frame postMessage
      extension → TCG Comps-owned marketplace overlay
```

This separation is intentional:

- A published dashboard update appears in the extension without repackaging it.
- The iframe retains the `d-k-b.github.io` origin, so the side-panel dashboard and
  full-page dashboard share the same `localStorage` and Gist connection.
- The extension does not receive or store the dashboard's GitHub token.
- The extension toolbar remains available even if the remote dashboard fails; the
  user can reload it, open it in a full tab, or switch to a local preview.
- The remote iframe is cross-origin from the extension page. Extension code must
  not depend on reading or modifying the dashboard DOM directly.

The circular-arrow control requests the current URL with a temporary
`extensionRefresh` query parameter. This bypasses a stale page response without
changing the origin or progress store.

## Dashboard compatibility contract

Dashboard work should preserve these extension-facing behaviors:

1. The published app remains available at the canonical URL, or both workstreams
   deliberately update the URL together.
2. The page remains frameable by the extension. Do not introduce an
   `X-Frame-Options` header or a restrictive `frame-ancestors` policy without an
   alternate integration design.
3. The dashboard remains usable in a narrow side-panel viewport, with one-column
   rows and no horizontal overflow. Treat roughly 360–500 CSS pixels as an active
   dashboard breakpoint, not an incidental mobile fallback.
4. Progress and GitHub credentials continue to belong to the dashboard origin.
   Moving state into extension storage would require an explicit migration plan.
5. Dashboard releases keep a visible build stamp and remain verifiable over HTTP.
6. Dashboard-generated output is still changed only through
   `generators/build_app.py`; the extension never patches generated HTML.

Pricing communication uses channel `tcg-pricing/v1`; on-demand collection snapshots
use `tcg-collection/v1`. Preserve exact origin, exact iframe, response type, and
request ID validation for both. Never use `*`, scrape the dashboard DOM, or put the
capability token in an iframe URL or page state.

## Update workflows

### Dashboard-only change

The dashboard workstream updates generator/data sources, regenerates all three HTML
copies, tests them, and publishes GitHub Pages. The extension code does not change.
Users select the extension's circular-arrow control to request the newest published
dashboard immediately.

### Extension-only change

Change files under `browser-extension/`, increment `manifest.json`'s version, run
the extension and repository tests, then reload the unpacked extension from
`chrome://extensions` or `edge://extensions`. No dashboard regeneration is needed.

### Shared integration change

Define the versioned boundary first, then implement and verify both sides. Examples
include the planned live-pricing bridge, extension-to-dashboard status messages, or
a different hosting origin. Record the contract here and in the root handoff.

## Pricing integration contract

TCG Comps remains the sole authority for marketplace fetching, AI prompts, product
matching, verification, valuation math, observation timestamps, and watch storage.
The tracker generates ProductRef v1 identities in `generators/gen_data.py`, stores
no valuation cache, and never treats missing pricing as zero.

- Each actual product/group has an explicit ProductRef; pack, display, kit, product
  type, and named prerelease variant are distinct identities.
- ProductRef/pricing metadata is decorative and must never enter `keyFor()`, legacy
  migration keys, or content fingerprints.
- Market value, lowest verified ask, confidence, timestamp, unavailable/error, and
  static fallback states render per pricing product in the row drawer.
- A valuation is accepted only when API version/schema and returned `productId`
  exactly match the requested ProductRef.
- Watch upsert, remove, and manual run controls exist only after that exact-product
  success. TCG Comps persists watches in its own `chrome.storage.local`.
- The dashboard keeps pricing state in memory only. The capability token remains
  only in the tracker extension's `chrome.storage.local`.

Pairing order is documented in `README.md`: trust the tracker's displayed extension
ID in TCG Comps, copy TCG Comps' connection JSON, save/test its ID and token in the
tracker, then reload both unpacked extensions after either changes.

## Marketplace collection-decoration contract

The side-panel button requests `tcg.collection-snapshot/v2` from the exact embedded
dashboard frame. Each product map key equals its included full
`tcg.product/v1.productId`; every entry contains only `product`, `status`, `target`,
`owned`, `missing`, and `requirement`. The snapshot is recomputed from current
in-memory ownership and includes all 686 products atomically under the provider's
1,200-product ceiling. It must never contain checkbox/legacy keys, extras keys, Gist
metadata, GitHub credentials, pricing credentials, values, watches, or cached
provider identities.

The extension calls `pricingClient.decorateCollectionPage(snapshot,
{observe:true,userInitiated:true})` only inside the direct button handler and omits
`targetTabId`, allowing TCG Comps to select the active tab. TCG Comps returns
`tcg.collection-decoration-result/v2`, and exact matches carry the supplied Tracker
canonical `productId`. An optional provider-specific ID is provenance only and must
never become collection state. NEED, OWNED, and TARGET are exact dispositions;
ambiguous, tied, accessory, mixed-lot, and out-of-catalog results stay CHECK.

TCG Comps stores the submitted snapshot in memory only, scopes decorations to the
authenticated caller namespace, and owns all page adapters, matching, mutation
observation, and DOM rendering. The Tracker must not vendor `listing-surface.js`,
scrape marketplace DOM, duplicate matching, persist a provider-ID map, bulk-price
the collection, create watches, or enable 130point through this route.

## Verification checklist

For an extension change:

```bash
node --check browser-extension/background.js
node --check browser-extension/sidepanel.js
python3 -m json.tool browser-extension/manifest.json >/dev/null
cd node-app && npm test
```

Then load or reload `browser-extension/` as an unpacked extension and verify:

- A cold toolbar click opens a full-height dashboard without first opening Settings.
- Settings opens and closes without covering or collapsing the iframe.
- Refresh adds `extensionRefresh` and returns to a usable dashboard.
- Full-tab opening uses the configured dashboard source.
- The live URL and a localhost preview are accepted; unrelated origins are rejected.
- Narrow viewport controls, checklist rows, scrolling, and Gist UI remain usable.
- No new permission appears unless the feature genuinely requires it.
- Wrong-origin and wrong-frame pricing messages are ignored.
- Missing provider, unauthorized pairing, and no-price responses remain recoverable
  and do not expose watch controls.
- A successful exact-product response shows value, verified ask, confidence,
  timestamp, and provider engine version in test/debug evidence.
- The page-check button sends all 686 full canonical ProductRefs in one v2 snapshot,
  only with `userInitiated:true`, and retains the existing minimal permissions.
- Wrong-origin/wrong-frame collection responses are ignored; a stale dashboard,
  unauthorized provider, unavailable content script, and incompatible result schema
  show recoverable status text.
- A supported marketplace page receives namespaced NEED/OWNED/TARGET/CHECK badges;
  ambiguous and mixed listings remain CHECK, and rescanning updates only the
  Tracker namespace.
- Every page-check error exposes the copy icon; its pasted report names the failure
  stage and error code, copies successfully in the side panel, and contains no
  capability token.

## File map

```text
browser-extension/
  manifest.json          MV3 permissions, side-panel declaration, version
  background.js          install/startup initialization and action behavior
  sidepanel.html         extension toolbar, settings, iframe, error surface
  sidepanel.css          side-panel layout and responsive shell
  sidepanel.js           source selection, refresh, validation, full-tab action
  vendor/tcg-comps-2.40.0/ unmodified API v1/v2-snapshot consumer scripts and provenance
  icons/                 generated PNG extension icons
  tools/build_icons.py   deterministic icon generator
  README.md              user installation and update instructions
  HANDOFF.md             extension architecture, ownership, and integration contract
```
