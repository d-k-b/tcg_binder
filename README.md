# TCG Sealed Collection Tracker

A compact, browser-based checklist for tracking sealed Magic: The Gathering and
Disney Lorcana products. It supports quantities, required-versus-bonus products,
search and completion filters, optional product images, and cross-device progress
sync through private GitHub Gists.

**Live dashboard:** <https://d-k-b.github.io/tcg_binder/>

## What it tracks

- MTG Collector Booster displays
- MTG non-Collector booster displays, including bonus display types
- MTG booster packs and one-of-each named sealed prerelease-pack/kit variant
- Lorcana booster, prerelease, and collector boxes

The dashboard currently contains 910 required collection targets and 950 total
inventory slots. Bonus slots can hold any quantity without changing completion.

## Using the dashboard

Open the live dashboard and use the numbered controls beside a product:

- Select the number or hover/focus it to reveal the minus and plus controls.
- A completed required target changes color.
- Open the row chevron for notes and, where verified, a sealed-product image.
- Use **View** to hide completed rows or adjust display preferences.

Progress saves in that browser automatically. Select the sync indicator in the
header to connect a GitHub token with only the `gist` scope; the dashboard creates
one private progress Gist per checklist. Tokens and collection progress are never
committed to this repository.

## Local preview

Do not open the generated HTML using a `file://` URL because browser storage will
not behave reliably. Instead:

```bash
./serve_binder.command
```

Or serve the repository root yourself:

```bash
python3 -m http.server 8765
```

Then open <http://127.0.0.1:8765/>.

On **MTG Prerelease Packs**, multi-variant rows show the total number of kits owned
plus progress such as `3/5 variants`; open **Show details** to adjust the quantity
of each named guild, clan, faction, character, college, or other sealed variant.
Duplicate copies are recorded but do not increase completion. Multi-type **MTG
Booster Packs** rows use the same drawer for their explicitly named Draft, Set,
Play, Collector, or other pack types. The product audit and sources are in
[PRERELEASE_VARIANT_AUDIT.md](PRERELEASE_VARIANT_AUDIT.md).

## Chrome and Edge extension

The `browser-extension/` folder contains a Manifest V3 side-panel extension for
keeping the dashboard available beside any browser tab. It loads the canonical
GitHub Pages dashboard, so checklist updates arrive without repackaging the
extension and progress continues to use the dashboard's existing local/Gist state.
Version 1.2.1 provides the credential-safe bridge to TCG Comps API v1. Open a
row's detail drawer to request its exact product's live market value, lowest verified
ask, confidence, timestamp, or a clearly labeled unavailable/error state. Watch
thresholds appear only after TCG Comps confirms the exact product identity. Each row
also has a compact refresh icon for all of that item's pricing products. The toolbar
refresh menu can update every item or only unfinished goal items on the active
checklist; its queue is bounded so a large checklist does not flood the extension.
Its **Mark collection needs on this page** action requests an ephemeral
`tcg.collection-snapshot/v2` catalog from the dashboard. That snapshot contains all
686 exact ProductRefs with current target, owned, missing, required/optional, and
status values so TCG Comps 2.40.0 can mark marketplace listings NEED, OWNED, TARGET,
or CHECK. TCG Comps owns page discovery, exact matching, and the overlay. The
snapshot is rebuilt on demand and never includes checklist keys, GitHub/Gist data,
credentials, prices, or watches.
Page-check errors expose a copy icon that produces a sanitized support report with
the failing dashboard/provider stage, versions, source URL, schema, and timing. The
capability token is explicitly excluded.

See [browser-extension/README.md](browser-extension/README.md) for Chrome and Edge
installation, the keyboard shortcut, local-preview mode, and the update workflow.
See [browser-extension/HANDOFF.md](browser-extension/HANDOFF.md) for the extension's
architecture, ownership boundary, and pricing bridge contract.

## Active development workstreams

This repository has two coordinated but separate workstreams:

| Workstream | Primary paths | Responsibility |
|---|---|---|
| Dashboard | `generators/`, `data/`, generated HTML | Collection rules, dashboard UI/state/sync, responsive extension view, and GitHub Pages releases |
| Browser extension | `browser-extension/` | Chrome/Edge shell, side-panel behavior, permissions, packaging, and the TCG Comps credential/iframe bridge |

Dashboard work remains generator-first and should consider the narrow extension
viewport. Extension work embeds the published dashboard and must not fork its UI or
progress state. Shared interface changes are documented in both handoff files before
the two implementations diverge.

## Development

The dashboard is generator-first. Edit the Python sources in `generators/`, never
the generated HTML files directly.

```bash
cd generators
python3 gen_data.py
python3 build_app.py

cd ../node-app
npm test
```

`build_app.py` writes the same generated dashboard to:

- `index.html` — GitHub Pages entry point
- `mtg_binder_app.html` — standalone local copy
- `apps/static/index.html` — static-app staging copy

The build stamp displayed in the header should change after every rebuild. Before
publishing, serve the root over HTTP and verify that stamp in a real browser.

For the data model, collecting rules, state-key migration, deployment cautions,
and maintenance backlog, read [HANDOFF.md](HANDOFF.md).

## Product image policy

Only images matched to the exact sealed product are shown. Card art and generic
set icons are deliberately excluded rather than presented as product photos.
Images load only when a row’s detail drawer is opened.

## Repository layout

```text
generators/       checklist data and dashboard/PDF generators
data/             generated dashboard data and reviewed image metadata
apps/static/      static dashboard staging output
node-app/         optional Express app, sync helpers, and regression tests
browser-extension/ Chrome/Edge side-panel launcher for the live dashboard
pdfs/             printable checklist PDFs
lists/            label-printing and reference lists
```

## License and trademarks

This is an unofficial personal collection tool. Magic: The Gathering, Disney
Lorcana, and related product names and artwork belong to their respective owners.
