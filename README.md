# TCG Sealed Collection Tracker

A compact, browser-based checklist for tracking sealed Magic: The Gathering and
Disney Lorcana products. It supports quantities, required-versus-bonus products,
search and completion filters, optional product images, and cross-device progress
sync through private GitHub Gists.

**Live dashboard:** <https://d-k-b.github.io/tcg_binder/>

## What it tracks

- MTG Collector Booster displays
- MTG non-Collector booster displays, including bonus display types
- MTG booster packs and prerelease-kit variants
- Lorcana booster, prerelease, and collector boxes

The dashboard currently contains 888 required collection targets and 928 total
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
pdfs/             printable checklist PDFs
lists/            label-printing and reference lists
```

## License and trademarks

This is an unofficial personal collection tool. Magic: The Gathering, Disney
Lorcana, and related product names and artwork belong to their respective owners.
