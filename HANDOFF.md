# TCG Sealed Collecting Binder — Project Handoff

Everything needed to pick this up and keep building. Written for a fresh agent/dev
with no prior context.

**What it is:** a personal tool for tracking a sealed Magic: The Gathering and Disney
Lorcana collection. It produces (a) printable PDF checklists and (b) a web dashboard
with compact quantity controls that sync to GitHub Gists.

**Status:** working and in use. Static dashboard deployed to GitHub Pages; it is the
copy that matters and the only one with the current UI. The Node app runs locally and
its frontend is a version behind (see backlog #11). Its historical pricing frontend
is not the dashboard integration described below.

**Browser extension:** `browser-extension/` is the current Manifest V3 dashboard
launcher for Chrome and Edge. It opens the canonical GitHub Pages app in the browser
side panel, so the iframe and full-page dashboard share the same origin, local state,
and Gist connection. Its reload control requests the latest published build with a
cache-busting query. Version 1.1.0 bridges generated ProductRef v1 requests to TCG
Comps API v1/provider 2.34.0 without exposing its capability token to the iframe.
This is separate from the older TCGplayer-only helper in `node-app/extension/`;
never replace the current dashboard with the stale Node frontend.

Extension 1.2.1 treats the API version as the compatibility boundary, includes the
direct collection page-decoration action for TCG Comps 2.40.0. A newer compatible
TCG Comps release remains a green connected state, with an informational release
note instead of an error-styled warning. Page discovery, exact matching, and DOM
decoration remain provider-owned; the Tracker supplies only the on-demand v2
ProductRef/count snapshot described below.

Page-check errors include an error-only copy icon. The copied diagnostic report
identifies dashboard snapshot versus provider/response failure, versions, source
origin, schema/product count, error code, and timing while explicitly excluding and
redacting the capability token. A missing/stale published snapshot bridge reports
`DASHBOARD_SNAPSHOT_TIMEOUT` rather than an unclassified error.

**Workstream boundary:** dashboard development owns `generators/`, `data/`, generated
HTML, responsive collection UI, state, and GitHub Pages publishing. Extension
development owns `browser-extension/`, browser surfaces, permissions, packaging, and
the privileged TCG Comps bridge. Dashboard changes should continue to treat a narrow
side panel as a supported viewport, but extension work must not fork or patch the
generated dashboard. See `browser-extension/HANDOFF.md` for the full interface and
ownership contract.

**Collection-state parity boundary:** `node-app/lib/collection-state.js` owns the
deterministic ProductRef, stable-key, owned, ordered, and receive semantics used by
the CLI. Any dashboard feature that reads or mutates durable collection state is
incomplete until the core has the same operation, the CLI exposes matching inputs and
JSON output (or a documented browser-only exception), and regression coverage proves
parity. New HTTP APIs should reuse those operation names and fields where security
allows; do not invent a second key or quantity model. The current GitHub Pages build
is generated browser JavaScript and cannot import Node CommonJS directly. A future
dashboard refactor must bundle this pure core through `generators/build_app.py` or
call a versioned API, never copy its semantics into another browser-only path. See
`docs/COLLECTION_STATE_CLI.md`.

**Current pricing boundary:** `gen_data.py` adds 686 unique, contract-valid pricing
products outside ownership slots. `build_app.py` renders per-product refresh/value,
verified Buy Now low, confidence, observation time, explicit unavailable/error, and
static fallback states. Pricing prefers the configured read-only TCG Pricing REST
transport and falls back to the extension bridge for backward compatibility.
Standalone Safari/Chrome/Edge users enter an HTTPS base URL and the separate
least-privilege REST access key under **More → Pricing API settings**; an explicit
**Remember on this device** choice stores it only in
`localStorage["tcgDashboardPricingRest_v1"]`. The record is separate from collection
state and never enters generated source, URLs, Gists, exports, or debug reports.

TCG Comps 2.43.40 may also return an additive `lowestAuction`. The dashboard renders
that provider-qualified listing in a visually separate **Current auction bid** block
only when it is non-null, with its landed amount, current bid, known shipping, end
time, available bidder counts, safe HTTPS link, and an explicit provisional-bid
warning. The dashboard does not classify auctions or calculate a final price,
savings, value, or recommendation. `cache.mode === "stale-fallback"` suppresses the
auction block and labels the valuation stale. Auction candidates never enter Market,
verified Buy Now asks, fixed-price watches/alerts, or collection/Gist state.

Watches remain extension-only and appear only after an exact returned `productId`
matches the requested ProductRef and an extension bridge exists. The extension
capability token/ID remain exclusively in `chrome.storage.local` and are never
substituted for the REST key. TCG Comps owns all marketplace fetches, matching,
prompts, valuation math, and watch persistence. See `docs/API_CREDENTIALS.md`.

**Photo-identification boundary:** extension 1.4 adds a generator-owned
camera/upload modal and an extension-owned BYOK OpenAI bridge on
`tcg-product-identify/v1`. The generated dashboard also embeds the same validated
OpenAI client so camera/upload identification works as a standalone web app in
Safari, Chrome, and Edge. The dashboard re-encodes photos before sending them,
supplies 686 canonical ProductRef candidates plus 378 reviewed wrapper-art IDs, and
accepts only returned IDs that exist in that in-memory catalog. Identification is
suggestion-only. Collection quantities change only through the explicit −/+ controls
shown beside a result.

**AI collection-authoring boundary:** extension 1.5 adds a generator-owned **New
Collection** chat and an extension-owned BYOK OpenAI bridge on
`tcg-collection-author/v1`. The extension bridge retains the v1 built-in-catalog
contract. A standalone dashboard key enables the generator-owned v2 client in
`generators/catalog_author_client.js`: it uses the Responses API with
`store:false`, strict structured output, and the `web_search` tool when the
requested game/products are absent from the built-in catalog. External results use
`tcg.collection-author-result/v2` plus `tcg.external-catalog-import/v1`; every row
must have a validated HTTPS evidence URL and is shown with its source before the
user can click **Import catalog & create local draft**. The model cannot install a
catalog or change ownership by itself. Official publisher/product pages are the
required first choice, secondary sources must be disclosed, and the human remains
responsible for verifying completeness and equivalence rules.

**Standalone AI credential boundary:** **More → AI settings…** stores an explicitly
entered OpenAI key only under the separate browser-origin namespace
`localStorage["tcgDashboardOpenAI_v1"]` when **Remember on this device** is selected;
unchecked keys remain memory-only for the current page session. The setting is
available on the New Collection dialog as well. A configured dashboard key takes
the direct path; otherwise the existing exact-origin extension bridge remains the
fallback. Forget removes the device-local key immediately. The key is deliberately
outside `state`, so it never enters collection saves, Gists, exports, URLs,
diagnostics, bridge messages, or generated source. The UI warns that browser storage
is weaker than a server or the extension and recommends a dedicated limited-spend
OpenAI project key on trusted personal devices. This is an explicit standalone-web
tradeoff; standard OpenAI API keys should normally remain server-side.

AI-created collections use `tcg.collection-definition/v1` records inside a
`tcg.collection-library/v1` state envelope. Immutable item and slot IDs preserve
progress across title/rule edits, while unknown future definitions are retained in
recovery rather than silently dropped. Creation is two-step: the user first clicks
**Create local draft**, then tests the checklist locally. Draft definitions and all
of their owned/extras/ordered quantities are excluded from every Gist path,
including background and unload sync. Only the explicit **Publish to GitHub Gist**
button promotes a draft to `live` and creates its private Gist. Researched rows retain their evidence in a sanitized
`tcg.external-catalog-source/v1` `sourceRef`, including source URL/title, product and
variant names, release status/date, evidence summary, and research time. Immutable
dashboard-generated item and slot IDs—not model-provided IDs—own progress.
Deleting a draft is therefore local-only and states exactly how many local progress
records will be removed.

User-created collections expose **Edit collection** in their rule banner. Revision
authoring sends the current title, rule, product list, target counts, and sanitized
source provenance to the standalone v2 author, but never sends ownership, ordered
quantities, collection/slot IDs, Gist metadata, or credentials. The model must return
a complete replacement proposal rather than a patch. Applying a revision to a local
draft updates that draft only. Editing a live collection creates a second local draft
with `authoring.revisesCollectionId` and `baseRevision`; the live definition, progress,
and existing Gist remain untouched. Matching semantic products/copy slots reuse their
immutable IDs and receive separate working copies of owned/extras/ordered quantities;
new products start empty. Publishing a revision checks the base revision, names every
removed slot that still has owned or ordered data, replaces the live definition, and
patches the existing private Gist. Discarding the staged revision returns to the live
collection without touching GitHub. Staged revisions are excluded from global progress
and every Gist-sync partition so they cannot double-count or leak before publication.

**Photo-identification boundary:** extension 1.4 adds a generator-owned
camera/upload modal and an extension-owned BYOK OpenAI bridge on
`tcg-product-identify/v1`. The dashboard re-encodes photos before sending them,
supplies 686 canonical ProductRef candidates plus 378 reviewed wrapper-art IDs, and
accepts only returned IDs that exist in that in-memory catalog. The extension
remembers the user's key in private `chrome.storage.local` when **Remember on this
device** is selected; the key never enters generated HTML, iframe messages,
dashboard localStorage, Gists, exports, URLs, or diagnostics. Identification is
suggestion-only. Collection quantities change only through the explicit −/+ controls
shown beside a result.

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
The repeated quantity-adjustment focus fix was rebuilt and browser-verified on build
`2026-07-31 17:20`: after each row render, focus moves to the replacement plus or
minus button, allowing uninterrupted `0 → 1 → 2` clicks at desktop and 390x844.
Decrementing to zero focuses the count because the disabled minus button is hidden.
The TCG Comps API v1 consumer was regenerated and HTTP-browser-verified on build
`2026-07-31 23:25`: 686 ProductRefs validate and remain outside all ownership keys;
the desktop and 390x844 layouts have no horizontal overflow; the missing-extension
state shows a labeled static fallback and no watch controls. Offline generated-code
tests also prove exact-origin/frame rejection, unauthorized and no-price handling,
exact-product watch gating, and absence of the capability token from dashboard HTML.
The optional booster wrapper-art inventory was regenerated and HTTP-browser-verified
on build `2026-08-14 13:54`: all 378 stable fronts across 96 sets are reachable in
regular Packs row details, including three zero-slot wrapper-only rows; the same-code
2XM VIP row is excluded. Desktop, 390px, and 360px views have no horizontal overflow,
the 2XM missing-image fallback remains visible, toggles persist across reload, and
the collection stays at 910 required targets / 950 inventory slots.
Incoming-order tracking was regenerated and HTTP-browser-verified on build
`2026-08-20 22:32`: ordered-only copies remain outside owned completion, acquiring
an additional owned copy leaves the order intact, and Receive transfers exactly one
copy from ordered to owned. The compact package badge and package-into-hand Receive
control were exercised at desktop, 390px, and 360px with persisted reload state and
no horizontal overflow. Completed rows remain subdued at rest, but their quantity,
ordered, and Receive controls return to full opacity on hover or keyboard focus. The
360px and 390px layouts keep the ordered tray directly adjacent to the owned plus
button, avoiding a hover dead zone; its non-clickable package icon separates the
owned plus from the ordered decrement to prevent accidental clicks. The full offline
suite, including Gist and key migration coverage, passed.
AI-assisted collection creation was regenerated and HTTP-browser-verified on build
`2026-08-22 19:51`: the New Collection chat opens at desktop, 390px, and 360px with
no horizontal overflow; a missing extension/key fails clearly; structured proposals
remain inert until **Create local draft**; and an offline Gist regression proves a
draft definition plus its owned, extra, and ordered quantities makes zero GitHub
requests. Extension 1.5.0 reuses the device-remembered OpenAI key and validates the
exact origin, frame, request ID, catalog, and returned source IDs.
Standalone AI settings were added on build `2026-08-22 20:11`: New Collection and
camera/upload identification can use a device-local OpenAI key without the Tracker
extension; **Remember on this device** defaults on, session-only and Forget behavior
are covered by generated-code tests, and the key remains outside collection/Gist
state and all generated files. The HTTP-served page was verified at 1280px, 390px,
and 360px with no horizontal overflow or console errors; the camera button opens AI
setup when a standalone key is missing, and both dialogs remain fully contained.
Standalone external-catalog discovery and paste-safe diagnostics were added on build
`2026-08-22 20:29`. The v2 standalone author can web-research missing games, requires
one validated HTTPS evidence source per product, previews every sourced row, and
creates only a local draft after explicit approval. A Star Wars: Unlimited regression
covers five released Carbonite Edition pack rows at two copies each. **More → Copy
debug report** emits `tcg.dashboard-debug/v1` without credentials, identities, Gist
IDs, progress keys, chat text, catalog bodies, or pricing data. Full `npm test` passed;
the HTTP-served page retained `259 / 910` at desktop, 390px, and 360px with no
horizontal overflow or console warnings/errors.
Build `2026-08-22 20:48` fixes the first real external-catalog draft: normalized
custom rows intentionally have no built-in `tags` array, so row rendering must use
`(it.tags||[])` rather than assuming generated catalog metadata. The saved five-row
Star Wars: Unlimited draft survived unchanged and was HTTP-verified at 545px with
all source links and two-copy controls visible. Paste-safe diagnostics now retain up
to five sanitized recent runtime errors under `diagnostics.recentErrors`; OpenAI and
GitHub credential patterns are redacted before entering that memory-only buffer.
AI-assisted current-collection revision was added on build `2026-08-22 21:03`.
The saved five-product Star Wars draft exposes **Edit collection**, opens a revision
prompt with the current definition as non-ownership context, and remains local until
its existing publish control is used. Live custom collections stage a separate local
revision and patch their existing Gist only after explicit publication. Regression
coverage proves immutable-ID reuse, owned/duplicate/ordered migration, empty new
products, named loss disclosure, base-revision gating, staged-Gist exclusion, and
generated parity. Full `npm test` passed; the HTTP-served dialog and saved rows were
verified at 545px, 390px, and 360px without overflow or console warnings/errors.

---

## 1. The collecting rules (most important section)

These are the user's actual rules. They were refined over many iterations — do not
change them without asking. Everything else is implementation detail.

| Checklist (`id`) | Rule | Dashboard rows | Required targets | Inventory slots |
|---|---|---|---|---|
| **MTG Collector Boxes** (`collector`) | One of each Collector Booster display ever made, incl. premium/all-foil/VIP boxes | 54 | 54 | 54 |
| **MTG Booster Boxes** (`boxes`) | One preferred non-Collector display per set/distinct edition; other display types are bonus inventory | 202 (180 goal + 22 bonus) | 180 | 220 |
| **MTG Booster Packs** (`packs`) | **Two** of every booster pack, per pack type per set; optional wrapper-front inventory | 179 (176 ownership + 3 wrapper-only) | 488 | 488 |
| **MTG Prerelease Packs** (`prerelease`) | One of every distinct sealed prerelease pack/kit **variant** | 69 | 148 | 148 |
| **Lorcana Booster Boxes** (`lorcana`) | One booster box **per kid** (2 kids) | 15 | 30 | 30 |
| **Lorcana Prerelease Boxes** (`lorcana_pre`) | One prerelease box per kid | 4 | 8 | 8 |
| **Lorcana Collector Boxes** (`lorcana_coll`) | One collector box per kid | 1 | 2 | 2 |

**910 required targets and 950 inventory slots total.** The 40 optional slots are
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

### 1c. Prerelease variant identity

Prerelease completion is based on distinct sealed variants, never raw copy count.
Guild, clan, faction, color/path, character, college, and other differently named
packs are separate required slots. A second copy of the same named product does not
advance completion. `build_prerelease.py::VARIANT_NAMES` is authoritative and
`gen_data.py` emits both `items[].variants` and matching named `slots[].l` entries.

Multi-variant rows show the aggregate number of physical kits owned and a separate
`3/5 variants` completion tag. Their detail drawer exposes an always-visible
minus/count/plus control for every named slot. The first copy stays represented by
the existing v2 check key; duplicate copies live in `state.extras` under stable
`checklist|slot-extra|fingerprint` keys. Aggregate plus fills the least-owned named
variant (therefore every missing variant first); aggregate minus removes a copy from
the most-owned variant (therefore duplicates before required first copies).
Completion still requires at least one of every named variant, regardless of total
copy count. Single-variant rows retain the compact aggregate interaction and may
also record duplicates.

The Packs checklist uses `progressMode:"group_variants"`. Every pack type is emitted
in `items[].variants` with an explicit name, group, and target of two. Rows with more
than one pack type show those quantities again in the detail drawer and show their
sum as a `N total` tag. Pack completion remains two of every type; extra Draft packs,
for example, cannot substitute for a missing Set or Collector pack. Wrapper artwork
is intentionally outside this model.

Packs also expose a separate optional wrapper-art checklist inside each matching
row's detail drawer. Its 378 stable keys use `packs|wrapper-art|SET-N` and live only
in `state.wrapperArts`; they never create ownership slots, change the two-per-type
pack goal, affect Hide completed, or enter pricing/monitor collection snapshots.
Unhinged, Unstable, and Ultimate Masters were not in the 176-row pack ownership
model, so the dashboard adds three zero-slot `Wrapper-Art Inventory Only` rows to
expose their reviewed fronts without changing the 488 pack targets.

When a previously generic row expands, its original v2 slot remains ordinal zero.
Only that first named variant inherits the old v1 positional migration key; every
newly introduced slot has `legacy:null`. The four newly added supplemental rows live
in an appended era so all historical era/item positions remain stable. See
`PRERELEASE_VARIANT_AUDIT.md` for the verified names, additions, and exclusions.

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

**`slots[].g` is the column group and it is required.** `l` is the slot's explicit
label ("Draft Booster Pack copy 1"), `g` is the column it belongs to ("Draft"). The UI groups by `g`
to build aligned columns. This used to be inferred by regex-stripping trailing
digits off `l`, which silently merged Lorcana's "Kid 1" and "Kid 2" into one column
labelled "Kid". Never infer grouping from label text again — emit `g` in
`gen_data.py`.

For Booster Boxes, `slots[].r` marks whether the slot counts toward completion
(`false` means bonus inventory). Missing `r` means required, preserving every older
checklist. `slots[].k` is the stable key-group identity. The required box slot uses
`k:"Box"` even though its visible `g` is `Set`, `Draft`, etc.; this preserves every
existing v2 check and extra-quantity key while allowing truthful product columns.
`slots[].legacy` can pin or suppress a v1 positional mapping. Booster Boxes pin
moved required slots and set new bonus slots to `null`. Prerelease expansions keep
the old ordinal-zero slot position-derived and set every newly introduced named slot
to `null`; wholly new rows also use `null`. Other historical slots omit the field.
Keep these choices if rows move or expand again.

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

**Wrapper-front images are a separate reviewed catalog.**
`data/booster_wrapper_art_counts.csv` is the auditable count input and
`scripts/build_wrapper_art_handoff_catalog.py` deterministically builds
`data/booster_wrapper_art_catalog.json` (96 sets / 378 fronts). `build_app.py`
validates and embeds that catalog without changing `binder_data.json`. Thumbnails
receive `src` only when the nested wrapper section opens; missing sources and load
failures retain an `Image unavailable` card, and every card truthfully labels exact,
group-reference, review-only, or pending evidence.

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

The `packs` Gist payload also carries `wrapperArts`. Older packs Gists that omit the
field leave local wrapper state untouched and are upgraded on the next sync; first
connect unions wrapper keys, while later pulls replace the wrapper map so unchecking
a front syncs correctly. Export/import includes the same separate map.

Every checklist Gist also carries `ordered`, a map of stable group/slot quantity
keys to incoming counts. The Packs Gist additionally carries
`orderedWrapperArts`, keyed by the existing `packs|wrapper-art|SET-N` IDs. Older
Gists that omit either field preserve local incoming quantities and queue an
upgrade; first connect unions local and remote incoming state, while later pulls
replace only namespaces explicitly present in the remote payload. Existing
`checks`, `extras`, `wrapperArts`, `legacyChecksV1`, keyVersion, and migration
metadata are unchanged.

### A2. Dashboard UI structure (all of this is generated by `build_app.py`)

The whole page is three sticky layers plus a flowing body:

```
header.top           sticky top:0    brand · build stamp │ sync LED · ◐ · ⋯ · progress ring
.controls            sticky top:62px picker ▾ │ (spacer) │ 🔍 · ↻ · ⌄⌄ · ⌃⌃ · ⚙ View
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
sections described above. Single-group eras reserve `--onew`, so names still start
on one x. Prerelease rows use one aggregate physical-copy count regardless of
variant count; named-variant completion is shown separately in the row tag and
detail drawer.

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
displayed together as `Copies` with target 2. Quantities may exceed target,
including on the `distinct_variants` prerelease checklist. Ordinary group extras
live in `state.extras` under stable `checklist|extra|fingerprint` keys; named
prerelease duplicates use the parallel `checklist|slot-extra|fingerprint` form so
each variant retains its own quantity.
decrement removes extras before clearing the underlying v2 slot keys. Gist payloads
include both `checks` and `extras`. Preserve this split: slot checks keep existing
progress/migration semantics while extras allow an unbounded owned count. Preserve
the `.qtyctrl::before` hover bridge too: it spans the 2px visual gap to each translated
button so the control does not collapse while the pointer travels from the count.
Each quantity control also carries a stable transient `data-qty-key`. A quantity
change rebuilds the visible rows, then restores focus to the replacement same-side
button; this keeps `:focus-within` active so repeated plus/minus clicks do not make
the tray disappear. If decrement disables the minus button at zero, focus falls back
to the count. This focus state is UI-only and is never persisted.
On Booster Boxes, the required control has a gold ring and star; optional controls
use a dashed outline and fill with their product color only when owned. Optional
groups have target zero, are excluded by `clProgress`, `eraProgress`, and `overall`.
`itemComplete` requires at least one required group, so bonus-only rows never become
done; optional controls also remain fully opaque when the required part of a mixed row is complete.
With **Hide completed** enabled, `completionLinger` keeps a row visible for four
seconds after its latest quantity change once it reaches target. Each further +/-
click restarts the countdown, while dropping below target cancels it. Multi-variant
prerelease drawers list named, independently adjustable quantities and stay open across
their row re-render. This state is
deliberately transient and must not be added to localStorage or Gist payloads.

**Incoming orders.** Physical ownership and incoming quantities are deliberately
separate. The compact count remains the owned number; a small amber package badge
shows `+N` incoming without widening the row. Hover/focus reveals a floating
ordered −/count/+ tray and an icon-only Receive action depicting a package entering
a hand. Receive atomically decrements ordered and increments owned. The ordinary
owned + never consumes an order, so acquiring another copy while one is still in
transit leaves the incoming count intact. Amber means incoming copies cover the
target; green still requires physical ownership. Completion, progress, Hide
completed, and the four-second completion linger all remain owned-only.

`state.ordered` uses the already-stable `checklist|extra|fingerprint` group keys or
`checklist|slot-extra|fingerprint` exact-variant keys. Named prerelease and pack
variants expose their own incoming quantities in the detail drawer, and aggregate
ordered/receive actions choose exact slots deterministically. Wrapper-front orders
use the separate `state.orderedWrapperArts` namespace. Export/import and Gist sync
round-trip both maps. The existing `tcg.collection-snapshot/v2` pricing/monitor
contract remains physical-ownership-only; do not mislabel incoming items as owned
or add fields to that external contract without a separately coordinated version.

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

**Pricing refresh controls.** Every priced row has a compact circular-arrow button
that refreshes all of that row's `pricingProducts`; the existing per-product buttons
remain in the detail drawer. The control-bar arrow opens choices for every priced
item or unfinished goal items on the active checklist. “Unfinished” means a row has
at least one required ownership slot and is not complete, so bonus-only inventory is
not perpetually swept into that mode. “All” includes completed and bonus-only rows.
Batch work is memory-only, deduplicates `productId`, and runs at four concurrent
requests. It calls the same `refreshPrice()`/`pricingRequest()` path, preserving exact
request/product validation and all unavailable/error/watch gates. REST responses must
match API v1, `tcg.valuation/v1`, request ID, and the requested ProductRef ID. Extension
responses retain the exact origin/frame/channel/request gates. Never persist batch or
valuation state in collection state, Gists, or exports.

The read-only REST endpoint cannot prove a direct browser-tab gesture, so it never
enables 130point. A direct per-product extension refresh may retain the existing
user-initiated 130point path; row or toolbar batches never do. REST-only dashboards
hide extension-owned watch controls. Missing pricing is unavailable, never `$0`.

**Collection page-decoration snapshot.** The extension parent may send
`{channel:"tcg-collection/v1", type:"collectionSnapshot", requestId}` to the
dashboard. `buildCollectionSnapshot()` rebuilds one atomic
`tcg.collection-snapshot/v2` response from the current in-memory ownership state;
`postCollectionSnapshot()` returns it as `collectionSnapshotResult` only to
`pricingConsumerOrigin`. The listener requires the exact origin, the exact
`window.parent` source, the exact channel/type, and a bounded nonempty request ID,
and never posts to `*`.

Every one of the 686 unique `pricingProducts` becomes a catalog entry keyed by its
canonical `ProductRef.productId`. `collectionOwnership()` uses `slotOrdinal` for a
named prerelease variant (including that variant's duplicate quantity); all other
products match `slotGroup` to `groupedSlots(item).n`, which preserves pack targets,
optional box inventory, and Lorcana's displayed `Copies` target. Each entry carries
the full validated `tcg.product/v1` ProductRef plus integer `target`, `owned`,
`missing`, `requirement`, and `status`. An unmapped group, invalid/duplicate
ProductRef, invalid quantity, empty catalog, or catalog over 1,200 products fails the
whole request instead of silently omitting a product. Snapshot generation is
read-only and must never call `save()`, change state, or include v2/legacy keys,
GitHub or provider credentials, Gist IDs, pricing values, watches, or other state.

**Deal-monitor subscription.** The More menu opens a generator-owned Monitoring
dialog. Its defaults are enabled, a maximum Market ratio of `0.80`, medium
confidence, eBay/TCGplayer/Heritage/supported stores, required products only,
instant fixed-price email, and a daily `07:00 America/Chicago` digest. Only these
non-secret preferences and their conflict-resolution timestamp are stored in the
dashboard state/export and canonical `collector` Gist. Older saved states and
Gists safely receive defaults; collection keys, quantities, extras, and recovery
metadata are unchanged. Provider/bridge status is deliberately memory-only.

The Tracker extension requests the current bundle with
`{channel:"tcg-collection-monitor/v1",type:"monitorSubscription",requestId}`.
`buildMonitorSubscription()` returns an on-demand
`tcg.collection-monitor-subscription/v1` containing normalized preferences and a
fresh full `tcg.collection-snapshot/v2`. Its 16-hex FNV-1a revision hashes a
canonical key-sorted representation of preferences plus collection; `generatedAt`
is excluded, so time alone cannot change the revision. Ownership or preference
edits debounce to one `monitorStateChanged` hint containing only channel, type, and
request ID. The same exact-origin/exact-parent validation accepts the agreed
versioned `monitorSyncStatus` envelope, whitelists its non-secret fields, paints the
dialog status, and returns `monitorSyncStatusResult`; it never persists the status.
No monitor message uses `*`, and no bundle/hint/status contains GitHub/provider
credentials, checklist/extras keys, valuations, watches, listing history, or email.

**Diagnostics.** The header subtitle carries a build stamp (`const BUILD`, stamped by
`build_app.py` at build time) — the fastest way to tell whether a browser is running
the copy you just deployed. **More → Copy debug report** writes a formatted
`tcg.dashboard-debug/v1` report to the clipboard; `window.__binderDebug()` returns
the same object. It includes build, viewport, browser/storage health, collection
counts, AI/extension capability state, sync/monitor state, and in-memory pricing
status. It deliberately excludes GitHub/OpenAI/provider credentials, user identity,
Gist IDs, checklist/fingerprint/storage keys, chat text, catalog bodies, pricing
values, watches, and saved payloads, so it is safe to paste into a Codex task.

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
tools/test-gist-logic.js  offline Gist tests, mocked GitHub — 26 passing
tools/test-key-migration.js generated-dashboard key/migration/catalog/ProductRef/monitor-preference tests
tools/test-dashboard-monitor-gist.js exact generated dashboard preference pull/push/round-trip tests
tools/test-browser-extension.js MV3, credential boundary, exact vendored-artifact tests
tools/test-pricing-dashboard.js generated pricing/collection/monitor bridge, revision, leakage, status, batch, and watch-gate tests
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
- **Wrapper art is optional inventory, not the pack goal.** The reviewed catalog now
  exposes one checkbox per distinct front while the collecting rule remains two per
  pack type. Do not turn wrapper fronts into required ownership slots. UNH and BBD
  still use group-reference images, UST uses review-only retailer candidates, and
  2XM intentionally has no image URLs pending a trustworthy regular Draft source.
  IMA state IDs remain `IMA-N` although Forge filenames use `ICO_N.png`; Portal stays
  at four fronts even though Forge exposes a fifth file.
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
- **More → Copy debug report** is the normal support path; `window.__binderDebug()`
  returns the same sanitized report in the console. Neither path returns tokens,
  identities, Gist IDs, progress keys, chat contents, or catalog payloads.

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

For a newly released multi-art regular booster, follow the fail-closed wrapper-art
intake in `docs/BOOSTER_WRAPPER_ART_DASHBOARD_HANDOFF.md`: start with official
loose-wrapper packaging, validate the exact product lane (never Collector, Set,
Theme, VIP, sleeved, promo, or foreign-language packaging), assign permanent
`SET-N` IDs, and keep ambiguous imagery in the review queue. A count or candidate
image is not promoted to `exact_individual` without reviewed physical evidence.

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

### Wrapper-art opportunity model

TCG Comps 2.43.0 owns the risk-adjusted fat-pack/bundle calculation in
`services/price-monitor/wrapper-opportunity.js`. It compares the landed bundle route with buying
the exact missing wrapper art, keeps one newly found missing art, treats duplicates as opened,
uses net realizable pull outcomes, and applies a bounded fun premium rather than a hard pack-price
ceiling. Fixed-price `STRONG_FAT_PACK_BUY` and `FUN_FAT_PACK_BUY` results may email instantly;
open-then-fill and auctions are digest-only.

The Tracker now records distinct wrapper fronts in `state.wrapperArts` and the Packs Gist, while
the main checklist still tracks two generic copies per pack type. The current provider snapshot
contract intentionally does not transmit wrapper-art state, so the provider must still fail closed
to `INVENTORY_FIRST` unless a separately reviewed authority supplies the total and owned-art count
along with bundle composition, direct-art landed costs, and pull-value distribution. Never infer
distinct art from the existing generic owned quantity.

Local monitor bootstrap helpers live in `scripts/`. `run_local_price_monitor.command` validates
the protected configuration, renews eBay Browse authorization, and runs the canonical TCG Comps
service on loopback with durable state outside this repository. See `scripts/README.md`; never add
the protected environment file or service data directory to Git.

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
data/binder_data.json         unified data model — 7 checklists, 910 required / 950 inventory slots
data/product_images.json      reviewed image metadata (33 exact products initially)
data/booster_wrapper_art_counts.csv  audited multi-art regular-booster counts
data/booster_wrapper_art_catalog.json  96 sets / 378 optional wrapper fronts
scripts/build_wrapper_art_handoff_catalog.py  deterministic wrapper catalog builder
docs/BOOSTER_WRAPPER_ART_DASHBOARD_HANDOFF.md  scope, exceptions, and intake workflow
pdfs/*.pdf                    5 printable checklists
lists/mtg_booster_box_names.txt   180 box names for label printing
index.html                    generated GitHub Pages entry point
apps/static/index.html        identical static-app staging copy
serve_binder.command          double-click: serves the folder on localhost:8765
node-app/                     Express app + Chrome extension + tools (UI is stale)
  tools/test-wrapper-art-dashboard.js  catalog/UI/optional-state regression
browser-extension/            current Chrome/Edge side-panel dashboard launcher
  README.md                    user install and update workflow
  HANDOFF.md                   extension ownership and dashboard/pricing contracts
  vendor/tcg-comps-2.42.0/     active unmodified API v1 + collection/monitor consumer artifacts
  vendor/tcg-comps-2.34.0/     retained historical API v1 consumer artifacts
```

**Where the UI actually lives:** `build_app.py` holds the entire dashboard — HTML,
CSS and JS — in one Python template string, and stamps `__BUILD__` at build time.
`index.html`, `mtg_binder_app.html`, and `apps/static/index.html` are *generated*;
editing them directly will be overwritten on the next build.
