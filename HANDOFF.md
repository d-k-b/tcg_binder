# TCG Sealed Collecting Binder — Project Handoff

Everything needed to pick this up and keep building. Written for a fresh agent/dev
with no prior context.

**What it is:** a personal tool for tracking a sealed Magic: The Gathering and Disney
Lorcana collection. It produces (a) printable PDF checklists and (b) a web dashboard
with compact quantity controls that sync to GitHub Gists.

**Status:** working and in use. Static dashboard deployed to GitHub Pages; it is the
copy that matters and the only one with the current UI. The Node app runs locally and
its frontend is a version behind (see backlog #11). Live pricing is built but only
partially verified (see Caveats).

**Read first:** §1 (the collecting rules — they are the product), §2's data-model note
on `slots[].g` and checkbox keys, then §4. §4 is not boilerplate; almost every entry
in it is a bug that actually shipped, with the reason it was not obvious.

**Verified in-browser:** the full responsive/layout sweep was completed on build
`2026-07-19 00:08`. The content-key migration was verified on build
`2026-07-19 00:36`: three imported v1 checks became three active v2 checks, all
three legacy keys remained in recovery storage, and the state survived reload with
no browser errors. Quantity controls were verified on build `2026-07-19 11:55` at
desktop and 390x844: target-one and target-two completion colors, quantities above
target, persistence across reload, hover/focus expansion, and no horizontal overflow.
The specialty-display audit was rebuilt and test-verified on build
`2026-07-20 23:10`: 180 booster-display rows, four distinct Mystery Booster
editions, CLB/CMM Set displays, an Aftermath Epilogue display, and 888 total targets.
The all-display inventory audit was rebuilt and test-verified on build
`2026-07-20 23:36`: 180 required box targets remain unchanged, 40 bonus
non-Collector display slots were added, and all existing required keys were preserved.
The sparse-column reorganization was rebuilt and test-verified on build
`2026-07-20 23:49`: the Booster Boxes checklist now renders 180 goal rows plus
22 bonus-only rows, every section has at most two quantity columns, and both v2
content keys and original v1 positional migration targets remain stable.
The first product-image integration and root Pages output were rebuilt and
browser-verified on build `2026-07-27 23:26`: 33 exact sealed-product images imported
from the older Cursor project appear only inside opened row drawers. Card-art and
set-icon fallbacks are excluded, images load only when the drawer opens, desktop and
390x844 layouts have no horizontal overflow, and all 888 required targets plus all
saved key formats remain unchanged.

---

## 1. The collecting rules (most important section)

These are the user's actual rules. They were refined over many iterations — do not
change them without asking. Everything else is implementation detail.

| Checklist (`id`) | Rule | Dashboard rows | Required targets | Inventory slots |
|---|---|---|---|---|
| **MTG Collector Boxes** (`collector`) | One of each Collector Booster display ever made, incl. premium/all-foil/VIP boxes | 54 | 54 | 54 |
| **MTG Booster Boxes** (`boxes`) | One preferred non-Collector display per set/distinct edition; other display types are bonus inventory | 202 (180 goal + 22 bonus) | 180 | 220 |
| **MTG Booster Packs** (`packs`) | **Two** of every booster pack, per pack type per set | 176 | 488 | 488 |
| **MTG Prerelease Packs** (`prerelease`) | One of every prerelease pack **variant** | 65 | 126 | 126 |
| **Lorcana Booster Boxes** (`lorcana`) | One booster box **per kid** (2 kids) | 15 | 30 | 30 |
| **Lorcana Prerelease Boxes** (`lorcana_pre`) | One prerelease box per kid | 4 | 8 | 8 |
| **Lorcana Collector Boxes** (`lorcana_coll`) | One collector box per kid | 1 | 2 | 2 |

**888 required targets and 928 inventory slots total.** The 40 optional slots are
non-Collector Theme, Draft, set-attached Jumpstart, and LTR Jumpstart Vol. 2
displays. They persist quantities but never affect progress or Hide completed.
Sparse specialties no longer make the chronological eras excessively wide:
Theme, set-attached Jumpstart, and LTR Jumpstart Vol. 2 are separate bonus-only
sections, while required Epilogue, Beyond, and Ravnica Remastered's Draft holdover
each have a focused one-column section. The common 2019–2023 rows use only Draft
and Set columns. A bonus-only era shows `BONUS` rather than `0/0`, and its rows never
become complete or disappear under Hide completed.
Titles are `<Game> <Product>` and nothing more — the rule
text lives in `sub` and renders as the rule box at the top of each list. Do not put
rules back into titles; the picker button has limited width.

**Seven tabs, not five.** Lorcana used to be one combined checklist (matching the
printed PDF, which still has all three columns side by side). In the dashboard the
three product types were indistinguishable — no column headers, just six identical
checkboxes — so `gen_data.py` splits it into three checklists via
`lorcana_eras(kind)` where `kind` is `box` | `pre` | `coll`. Sets that lack a given
product are dropped, and empty eras are dropped with them.

### 1a. Booster-box type selection (the subtle one)
For each set, pick the most premium non-Collector randomized display that existed,
plus materially distinct specialty editions:

1. **Play Booster Box** — Feb 2024 onward (Murders at Karlov Manor →)
2. **Set Booster Box** — Sept 2020 – Nov 2023, *where a Set Booster existed*
3. **Draft Booster Box** — pre-ZNR 2019–2020 sets, and reprint/Commander sets that
   never got a Set Booster
4. **Booster Box** — everything pre-2020 (classic 36-pack)
5. **Beyond Booster Box** — Assassin's Creed only
6. **Jumpstart** — its own category (separate card pool, 5 products)
7. **Epilogue / Mystery displays** — distinct randomized products or editions

The 18 sets that flip Draft→Set: ZNR, KHM, STX, MH2, AFR, MID, VOW, NEO, SNC, CLB,
DMU, BRO, ONE, MOM, LTR, CMM, WOE, LCI.

### 1b. Inclusion/exclusion decisions already made
- **Innistrad: Double Feature** → standard box list, NOT collector (all-foil but *draftable*)
- **Doctor Who, Fallout, Warhammer 40K** → Collector list only; they never had a standard box
- **Jumpstart** (5 physical products) → own category; separate exclusive card pool
- **Mystery Booster** → four rows: 2019 Convention, 2020 Retail, 2021 Convention
  reprint, and Mystery Booster 2. Their collation/distribution differs materially.
- **March of the Machine: Aftermath** → Epilogue Booster display, not Draft
- **Excluded entirely:** Commander precons, box sets (Game Night, Battle Royale,
  Beatdown, Anthologies, Unsanctioned), Duel Decks, Planechase/Archenemy,
  Starter 1999/2000, Secret Lair, From the Vault, digital-only (MTGO/Arena) sets
- **Alpha/Beta/Unlimited** are listed but valued `—`: they were sticker-sealed, so
  genuinely sealed boxes essentially don't exist
- **Lorcana prerelease boxes** exist only from **Wilds Unknown (Set 12, Q2 2026)**;
  Sets 1–11 had prerelease *events* but no retail box
- **Lorcana Collector Boosters** debut with **Into the Inkdark (Set 15, Q1 2027)** —
  column exists, dashed for all earlier sets

---

## 2. Architecture

```
Python generators (reportlab)          ── single source of truth for DATA
  build_pdf2.py        collector displays   → mtg_collector_checklist.pdf
  build_box.py         booster boxes        → mtg_booster_box_checklist.pdf
  build_packs2.py      2-of-every-pack      → mtg_booster_pack_checklist.pdf
  build_prerelease.py  prerelease variants  → mtg_prerelease_checklist.pdf
  build_lorcana.py     Lorcana              → lorcana_booster_box_checklist.pdf
        │
        │  gen_data.py IMPORTS all five modules and reads their ERAS lists
        ▼
  binder_data.json      unified model: checklists → eras → items → slots
        │
        ├─► build_app.py       → mtg_binder_app.html   (standalone, data embedded)
        └─► node-app/data/     → served at /api/data
```

**Critical invariant:** every `build_*.py` exposes a module-level `ERAS` list, and
`gen_data.py` imports them. Edit data in ONE place (the build script) and both the
PDF and the dashboards update. This was added specifically because the Lorcana data
had drifted between a duplicate copy and the PDF.

### Regenerate everything
```bash
cd generators
python3 gen_data.py     # imports all 5 builders → ../data/binder_data.json
python3 build_app.py    # → ../mtg_binder_app.html AND ../apps/static/index.html

# PDFs (each writes its .pdf into the current directory)
python3 build_pdf2.py && python3 build_box.py && python3 build_packs2.py \
  && python3 build_prerelease.py && python3 build_lorcana.py
```

**Paths are resolved from each script's own location** (`HERE` / `ROOT` /
`DATA_DIR` at the top of `gen_data.py` and `build_app.py`), so the project runs from
any directory and in either layout — flat, or this `generators/ + data/ +
apps/static/` one. They previously hardcoded an absolute path, which broke the moment
the folder moved. Do not reintroduce one.

`build_app.py` writes the root `index.html`, `mtg_binder_app.html`, and
`apps/static/index.html` in one go, so the GitHub Pages entry point and local/staging
copies cannot silently drift from one another.

### Data model
```jsonc
{ "checklists": [ {
    "id": "boxes",
    "title": "MTG Booster Boxes",              // short: "<Game> <Product>"
    "sub":   "One box per set, every set …",   // the RULE — renders as .rulebox
    "eras": [ { "name": "Play Booster Era — 2024–2026", "items": [ {
        "name": "Bloomburrow", "code": "BLB",
        "note": "…",            // reference detail → collapsed row drawer
        "est": true,            // amber value + "estimate" line in the drawer
        "value": "~$130",       // or "$144 / $1,200" (MSRP / market)
        "tags":  [ {"t":"Set","c":"#b5852a"} ],
        "images": [
          {"url":"https://…", "caption":"Set booster display", "source":"TCGplayer"}
        ],                      // optional decoration; never part of state identity
        "slots": [
          {"l":"Set Box", "g":"Set", "k":"Box", "r":true,
           "legacy":"boxes|7|5|0", "c":"#b5852a"},
          {"l":"Draft Box", "g":"Draft", "k":"Draft", "r":false,
           "legacy":null, "c":"#6a4fb0"}
        ]
} ] } ] } ] }
```

**`slots[].g` is the column group and it is required.** `l` is the checkbox's own
label ("Draft #1"), `g` is the column it belongs to ("Draft"). The UI groups by `g`
to build aligned columns. This used to be inferred by regex-stripping trailing
digits off `l`, which silently merged Lorcana's "Kid 1" and "Kid 2" into one column
labelled "Kid". Never infer grouping from label text again — emit `g` in
`gen_data.py`.

For Booster Boxes, `slots[].r` marks whether the slot counts toward completion
(`false` means bonus inventory). Missing `r` means required, preserving every older
checklist. `slots[].k` is the stable key-group identity. The required box slot uses
`k:"Box"` even though its visible `g` is `Set`, `Draft`, etc.; this preserves every
existing v2 check and extra-quantity key while allowing truthful product columns.
`slots[].legacy` is used only by Booster Boxes: required slots pin their original
v1 positional key, while bonus slots use `null` because no corresponding v1 slot
ever existed. Other checklists omit the field and retain position-derived migration.
Keep this pinning if rows move between display sections again.

Checkbox state keys are content-based v2 keys:
`` `${checklistId}|v2|${contentFingerprint}` ``. The deterministic fingerprint covers
the checklist, normalized item name and code, slot group, and the slot's ordinal
within that group. Era/item reordering therefore does not move saved progress.

Older index keys (`` `${checklistId}|${eraIndex}|${itemIndex}|${slotIndex}` ``) are
migrated on local load, Gist pull, server pull, and JSON import. The original keys
remain in `legacyChecksV1` as a recovery copy; only v2 keys are actively rendered
and synced. Do not remove that backup until real user data has completed at least
one verified migration and sync cycle.

**Product images are optional row decoration.** `data/product_images.json` is the
reviewable source list; `gen_data.py` attaches matching records to `items[].images`.
The current import contains only exact sealed-product images cached by the older
Cursor project from MTG Wiki or TCGplayer. `scryfall_card_art` and `set_icon`
fallbacks are deliberately rejected because they could imply that unrelated card
art is a picture of the sealed product. The browser assigns `src` only after the
row drawer opens, so closed rows remain just as compact and the page does not fetch
dozens of invisible images at startup. Adding or replacing an image must never
change `slots`, `k`, or any progress key.

---

## 3. The two apps

### A. Static dashboard (what's deployed) — root `index.html`
Single self-contained file. No server, no build, no dependencies.
- Data embedded at build time
- Progress in `localStorage`
- **Sync:** browser → GitHub Gist API directly (token in `localStorage`)
- **One gist per checklist**, named `MTG Binder · <Title>` / `mtg-binder-<id>.json`
- Deployed from the repository root via GitHub Pages. `apps/static/index.html` is
  an identical staging copy. **`.nojekyll` at repo root is required** — without it
  Jekyll hijacks the site and serves a themed README page instead.

**Connection persistence.** `localStorage["mtgBinder_gh"]` holds the whole
connection as JSON — `{token, user, ids, snap, last}` — not just the token. On load
`ghBoot()` restores it and reconnects automatically; there is no need to open
Settings and click Connect after a refresh. A bare-string value (the old format) is
migrated on read. Persisting `ids`/`snap` also stops the first push after every
refresh from rewriting gists that had not changed. Boot failures set
`ghBootState='error'` and surface on the sync pill + in Settings — do not go back to
swallowing them, that was the original bug.

**Sync policy** (deliberate — user did not want a write per click):
- Ticking a box only marks `ghDirty`
- Uploads on: 2-min timer (if dirty), checklist switch, tab hidden/closed
  (`keepalive`), manual Sync
- Only checklists whose content hash changed are written
- **First connect on a device unions local+remote** (local wins) so connecting can
  never wipe existing local checks; later pulls are remote-wins

### A2. Dashboard UI structure (all of this is generated by `build_app.py`)

The whole page is three sticky layers plus a flowing body:

```
header.top           sticky top:0    brand · build stamp │ sync LED · ◐ · ⋯ · progress ring
.controls            sticky top:62px picker ▾ │ (spacer) │ 🔍 · ⌄⌄ · ⌃⌃ · ⚙ View
.era-cols            sticky --stickytop        column headings + era name (per era)
#content             CSS multi-column, 1–3 columns via the View menu
```

**Checklist picker** (`#clBtn` / `#clMenu`, built by `renderTabs()`). Replaced a
horizontal tab strip that scrolled out of view — the active list name must stay on
screen. The menu still lists all seven with progress bars and counts. The function
is still called `renderTabs()`; it no longer renders tabs.

**Frozen column headings** (`.era-cols`). One per era, holding the column labels and
the era name. Sticks under the control bar and releases when its era ends, so the
next era's headings take over — spreadsheet panes. Only built when an era has more
than one column group or more than one box per group (`wantHead`); when present, the
per-row labels are suppressed rather than duplicated.

**Aligned quantity columns.** Per era, the UI computes the ordered union of every
`slots[].g` in that era, sorted by `COLRANK` (Booster → Draft → Set → Play →
Beyond → Epilogue → Theme → Jumpstart → …), and gives every row those exact columns at a fixed px width
(`--gcol`), leaving a hidden blank cell where a set lacks that product. Ordering by
rank rather than first-appearance still matters in mixed eras. Booster Boxes are
deliberately capped at two columns per era; sparse product types live in the focused
sections described above. Single-group
eras with a varying box count (prerelease, 1–10 variants) instead reserve `--onew`
and wrap past 5 per line, so names still start on one x.

**Rows are `.item` wrappers**, each containing a `.row` (checkboxes · name+code+tags
on one line · value · chevron) and a collapsed `.rowdet` drawer holding the note and,
when available, a product image with its source. For `est` items the drawer also
holds an "estimate — verify before buying" line. Striping, borders and the
done state live on `.item`, not `.row`, so an open drawer stays attached to its row.
Rows without a drawer get a `.ghosttog` spacer to keep the chevrons in a column.
Rows are 34px; long names wrap to ~49px in narrow columns by design (truncating set
names on a checklist is worse).

**Compact quantity controls.** Each old checkbox group renders as one 30x24 count
button. Hovering the control, or focusing it on touch/keyboard, slides minus and plus
buttons out to the sides without widening the row at rest. The count receives the
group color when `owned >= target`; target is the number of underlying slots, so a
standard box needs 1, MTG pack types need 2, and Lorcana's `Kid 1`/`Kid 2` slots are
displayed together as `Copies` with target 2. Quantities may exceed target. Those
extra copies live in `state.extras` under stable `checklist|extra|fingerprint` keys;
decrement removes extras before clearing the underlying v2 slot keys. Gist payloads
include both `checks` and `extras`. Preserve this split: slot checks keep existing
progress/migration semantics while extras allow an unbounded owned count. Preserve
the `.qtyctrl::before` hover bridge too: it spans the 2px visual gap to each translated
button so the control does not collapse while the pointer travels from the count.
On Booster Boxes, the required control has a gold ring and star; optional controls
use a dashed outline and fill with their product color only when owned. Optional
groups have target zero, are excluded by `clProgress`, `eraProgress`, and `overall`.
`itemComplete` requires at least one required group, so bonus-only rows never become
done; optional controls also remain fully opaque when the required part of a mixed row is complete.
With **Hide completed** enabled, `completionLinger` keeps a row visible for four
seconds after its latest quantity change once it reaches target. Each further +/-
click restarts the countdown, while dropping below target cancels it. This state is
deliberately transient and must not be added to localStorage or Gist payloads.

**Expanding controls.** Two elements collapse to an icon and expand *leftward* by
being absolutely positioned against the right edge of a fixed-width slot, so they
overlay empty space instead of displacing their neighbours: the sync LED
(`.ledwrap` / `.drivepill`, 29px → ~120px on hover, and auto-opens via `.alert` when
dirty or errored) and the search box (`.searchwrap` / `.search`, 33px → 330px on
hover/focus, held open by `.has` while a query is active; `/` focuses it, Escape
clears it).

**Menus** all run through one `wireMenu(btnId, menuId, closeOnItem)` — opening one
closes the others, plus outside-click and Escape. `closeOnItem` is true for one-shot
action menus (⋯, picker) and false for the View menu, which holds a toggle and a
select you may want to change together.

**Diagnostics.** The header subtitle carries a build stamp (`const BUILD`, stamped by
`build_app.py` at build time) — the fastest way to tell whether a browser is running
the copy you just deployed. `window.__binderDebug()` returns build, storage health,
connection shape, boot state and check counts, and never returns the token itself.

### B. Node app — `node-app/`
Adds server-side features the browser can't do safely.
```
server.js              Express: static + auth gate + progress + prices + config
lib/gist.js            Gist backend (server-side variant, one gist per checklist)
lib/ebay.js            eBay Buy API (Browse=active, Marketplace Insights=sold)
lib/prices.js          price cache, per-item query builders, extension job queue
lib/ai.js              provider-agnostic listing filter (Anthropic OR OpenAI)
public/                dashboard (same UI; talks to server instead of GitHub)
extension/             MV3 Chrome extension — TCGplayer price scraper
tools/check-gist.js    live round-trip diagnostic (never prints the token)
tools/test-gist-logic.js  offline Gist tests, mocked GitHub — 17 passing
tools/test-key-migration.js generated-dashboard key/migration and catalog tests — 30 passing
```
- Storage backend: `GITHUB_TOKEN` → gist, else Google Drive OAuth (`drive.file` scope)
- `APP_PASSWORD` puts basic auth in front of everything (**required if deployed**)
- `/api/config` is **local-only**; refuses on deployed instances

### Live pricing flow
1. User clicks **↻ Refresh prices**
2. Server queries **eBay Browse API** for candidate listings
3. Candidates → **AI filter** (`lib/ai.js`) which keeps only genuine single sealed
   boxes, and normalizes lots (`"$420 for 3"` → `$140/box`)
4. **TCGplayer** has no usable API → the extension opens the page in a background
   tab, scrapes candidates, POSTs them to `/api/ext/ingest`, server AI-filters those too
5. UI shows a green **LIVE** value; hover shows the breakdown + how many were filtered

---

## 4. Caveats & known weak points (read before trusting anything)

**Prices are the weakest part of this project.**
- Most values are **best-effort estimates**, flagged `est:true` (amber in UI/PDF).
- **PriceCharting goes stale badly.** It reported Lorcana *Fabled* at **$151** while
  the real eBay floor was **$1,200** — its last logged sale was 5 months old. Never
  trust a single price source.
- **Lorcana market runs far above MSRP** (~$144 MSRP vs $200–270 typical on eBay).
  Values are stored as `"MSRP / market"`; market is the number that matters.
- Three Lorcana sets are explicitly marked **UNVERIFIED** (Shimmering Skies,
  Azurite Sea, Reign of Jafar) — never confirmed with a real comp.
- Vintage MTG boxes are thin/volatile markets; the anchored ones came from
  PriceCharting via TheGamer (Feb 2025) and are already aging.

**Other known issues**
- **eBay *sold* prices need Marketplace Insights API approval.** Without it only
  lowest-active works (code degrades gracefully).
- **TCGplayer scraper selectors are fragile** — `scrapeTcgPage()` in
  `extension/background.js` has 3 fallback strategies but will need updating when
  TCGplayer changes markup.
- **Pack-type labels are derived from the era name**, not stored per set —
  `main_pack_label()` in `gen_data.py` maps era → `Booster` (pre-2019) / `Draft`
  (2019–2023) / `Play` (2024+). Before this, every set back to 1993 was tagged
  "Draft/Play", which is anachronistic. If you add an era, check that mapping.
- **Pack art-variant counts were abandoned.** An earlier version tried "2 of every
  wrapper art"; exact per-set art counts aren't catalogued anywhere reliable, so it
  was simplified to "2 per pack type." Don't reintroduce without a real data source.
- **Open the app over http, never as a `file://` document.** Chrome gives `file://`
  pages no persistent storage, so the token AND all checkmarks vanish on refresh —
  and it looks like a sync bug, because reconnecting pulls the checks back from the
  gist. `serve_binder.command` serves the folder on localhost; GitHub Pages works
  too. The app now detects dead storage and shows a red banner explaining it.
- **Syntax checking is not enough — load the page.** Three bugs shipped because the
  original author had no browser: `timeAgo`, `renderAll`, and worst, a top-level
  `document.getElementById('closeModal').onclick=...` where `#closeModal` is built
  at runtime by `openSync()`. It threw on load, which killed every statement after
  it — the entire init block, including `ghBoot()`. The page rendered nothing until
  some other code path called `updateAll()`. Bind through the `on(id,ev,fn)` helper,
  which warns and continues instead of throwing. Startup is now also wrapped so a
  render failure cannot stop sync, or vice versa.
- **Checklist titles are `<Game> <Product>` and nothing else** — "MTG Booster
  Packs", not "Booster Packs (2 of every pack)". The collecting rule belongs in
  `sub`, which renders as the `.rulebox` at the top of the list. Keep new titles
  short; the picker button ellipsises.
- **`.controls` is `flex-wrap:nowrap` on purpose.** A wrapping flex container
  assigns items to lines at their natural widths and only shrinks what already
  shares a line — so with `wrap` the picker never shrank, it just pushed the
  buttons to a second row. `nowrap` forces the shrink the ellipsis exists for.
  Both `.clbtn` and `.clname` need `min-width:0` or the nowrap title sets the
  min-content width and nothing shrinks at all.
- **Two CSS rules are load-bearing and look deletable.** `.era` must NOT have
  `overflow:hidden` — any ancestor with it silently kills `position:sticky` on the
  frozen column headers inside. And `--stickytop` is computed at runtime
  (`syncStickyTop()`, = 62px + control-bar height) rather than hardcoded, because
  the control bar changes height when it wraps.
- Sticky-in-multicol was measured, not assumed: 8 scroll jumps with forced layout
  cost **1ms with sticky vs 0ms without** on the 482-checkbox Packs tab. It is not
  a bottleneck. (Chrome's devtools/extension script injection does time out while
  driving that tab hard — that is tooling, not the app.)
- `window.__binderDebug()` in the console reports build, storage health, connection
  shape, boot state and check counts. It never returns the token, only its length
  and first four characters, so its output is safe to paste anywhere.

---

## 5. Setup

```bash
# Static app — must be served over http, NOT opened as a file:// document:
./serve_binder.command                  # → http://localhost:8765/mtg_binder_app.html
#   or: python3 -m http.server 8765     # from the folder containing the html
#   or: just use the GitHub Pages URL
# then: click the sync LED → paste a GitHub token (classic, `gist` scope only)

# Node app:
cd node-app && npm install && npm start        # → http://localhost:3000
npm test                                        # offline gist logic tests
npm run check:gist                              # live round trip (needs token)
```

**Editing loop:** change `build_app.py` (the HTML/CSS/JS all live in one template
string) → `python3 build_app.py` → hard-reload. Confirm the build stamp in the header
changed; if it didn't, you're looking at a cached or stale copy. The generator writes
the root Pages `index.html`, `mtg_binder_app.html`, and `apps/static/index.html`
together; do not copy or edit those files by hand.
To refresh trustworthy images from the older project before `gen_data.py`, run:
```bash
cd generators
python3 import_cursor_product_images.py \
  --cursor-root /path/to/mtg-set-collector \
  --binder-data ../data/binder_data.json \
  --output ../data/product_images.json
```
The importer is conservative by design: a product kind and visible slot type must
match the current curated row, and fallback card art/set icons are not imported.

**Release checklist:**
```bash
cd generators
python3 gen_data.py
python3 build_app.py

cd ../node-app
npm test

cd ..
cmp index.html mtg_binder_app.html
cmp index.html apps/static/index.html
python3 -m http.server 8765
```
Open `http://127.0.0.1:8765/`, confirm the new build stamp and exercise an opened
detail drawer at desktop and phone width. Commit the generator sources, data,
documentation, and all three identical generated HTML outputs together. Never
commit `.env`, `node-app/.data/`, browser tokens, or progress snapshots.

`.env` keys: `GITHUB_TOKEN` (gist sync) · `GOOGLE_CLIENT_ID/SECRET` (Drive alt) ·
`EBAY_CLIENT_ID/SECRET` + `EBAY_ENV` · `OPENAI_API_KEY` **or** `ANTHROPIC_API_KEY` ·
`APP_PASSWORD` (deployment) · `SESSION_SECRET`

Python side needs `reportlab` and `pypdf`/`pypdfium2` for verification renders.

---

## 6. Suggested backlog

Roughly in the order the user seemed to want them:

1. **Verify the unverified prices** — the 3 Lorcana sets, and re-check vintage MTG.
2. **Scheduled price refresh** — cron/GitHub Action to keep values current without
   manual clicks. (Was offered repeatedly, never built.)
3. **Purchase tracking** — record what was actually *paid* vs current market, so the
   dashboard can show gain/loss. Natural next step; data model already has values.
4. **Combined print bundle** — merge all 5 PDFs into one file.
5. **PDFs still use the old naming/era text** — the dashboard names were standardised
   ("MTG Booster Packs") and several era headings were corrected, but the printed
   PDFs were not regenerated with the same wording. Worth a consistency pass.
6. **eBay sold via extension** — fallback for the Marketplace Insights gap, same
   pattern as the TCGplayer scraper.
7. **Name-tag output** — `mtg_booster_box_names.txt` (180 lines, `{Set} {Type}
   Booster Box`) feeds a label-printing script. Consider generating for the other
   checklists too.
8. **Conflict handling** — sync is last-write-wins per checklist. Two devices editing
   the same checklist offline will have one lose. A per-item merge would fix it.
9. **Rename** — "MTG Sealed Collecting Binder" is now inaccurate (Lorcana is in it).
    Repo is already `tcg_binder`.
10. **Node app UI has drifted.** All of the Section A2 work (picker, frozen headings,
    aligned columns, row drawers, collapsing controls) went into `build_app.py` only.
    `node-app/public/` still has the older tab-strip UI. Either port it or retire the
    Node frontend and keep the Node app purely as a price API.

---

## 7. File inventory

```
HANDOFF.md                    this file
generators/build_pdf2.py      MTG Collector Boxes      → PDF
generators/build_box.py       MTG Booster Boxes        → PDF
generators/build_packs2.py    MTG Booster Packs        → PDF
generators/build_prerelease.py MTG Prerelease Packs    → PDF
generators/build_lorcana.py   Lorcana (all 3, combined) → PDF
generators/gen_data.py        imports all 5 → binder_data.json (7 checklists)
generators/import_cursor_product_images.py  trusted image-cache adapter
generators/build_app.py       binder_data.json → all 3 dashboard HTML copies (UI lives here)
data/binder_data.json         unified data model — 7 checklists, 888 required / 928 inventory slots
data/product_images.json      reviewed image metadata (33 exact products initially)
pdfs/*.pdf                    5 printable checklists
lists/mtg_booster_box_names.txt   180 box names for label printing
index.html                    generated GitHub Pages entry point
apps/static/index.html        identical static-app staging copy
serve_binder.command          double-click: serves the folder on localhost:8765
node-app/                     Express app + Chrome extension + tools (UI is stale)
```

**Where the UI actually lives:** `build_app.py` holds the entire dashboard — HTML,
CSS and JS — in one Python template string, and stamps `__BUILD__` at build time.
`index.html`, `mtg_binder_app.html`, and `apps/static/index.html` are *generated*;
editing them directly will be overwritten on the next build.
