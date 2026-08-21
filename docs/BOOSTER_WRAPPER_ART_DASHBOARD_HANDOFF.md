# Booster Wrapper-Art Checklist: Dashboard Implementation Handoff

## Outcome

Add an optional, image-backed checklist for the individual wrapper-art fronts of regular English booster packs. A collector should be able to open a booster-pack row, see every known wrapper front, and check off the exact artwork owned.

This feature supplements the existing booster-pack checklist. It must not change the current required-target count, inventory-slot count, pack-type ownership, completion percentage, or Hide completed behavior.

## Delivered data

- `data/booster_wrapper_art_catalog.json` — generated dashboard catalog with one stable record per wrapper front.
- `data/booster_wrapper_art_counts.csv` — auditable 96-set count source used by the generator.
- `scripts/build_wrapper_art_handoff_catalog.py` — deterministic catalog builder with hard assertions for 96 sets and 378 fronts.
- `outputs/019fe7d2-ce14-7c22-83f9-375a014d5e3a/MTG_Booster_Wrapper_Art_Budget_2026-08-14.xlsx` — current-market planning workbook and store-quote sheet.

Run the catalog generator with:

```sh
python3 scripts/build_wrapper_art_handoff_catalog.py
```

Current catalog totals:

- 96 multi-art sets.
- 378 distinct regular-booster wrapper fronts.
- 366 exact individual Forge images.
- 6 fronts represented by group-reference images pending reviewed individual crops.
- 3 Unstable fronts with review-only retailer-hosted candidates.
- 3 Double Masters fronts still needing a trustworthy image source.

## Scope and identity rules

The catalog covers English regular retail booster packs from Revised onward through Double Masters (2020), but only sets with more than one distinct wrapper-art front. Revised is intentionally absent because it does not have a multi-art card-wrapper run.

Exclude Collector, Set, Theme, VIP, faction, promo, sample, six-card, and outer sleeved packaging. The wrapper front is the collectible identity; image URLs are presentation metadata and must never be used as state keys.

Use `artworks[].id` as the durable identity, namespaced under the packs checklist. Recommended persisted key:

```text
packs|wrapper-art|<artworks[].id>
```

Examples: `packs|wrapper-art|4ED-1`, `packs|wrapper-art|IMA-3`.

## Generator-first integration boundary

Follow the repository `HANDOFF.md`. Implement in canonical generator/source files, primarily `generators/build_app.py` and, only if the catalog needs to be embedded into generated data, `generators/gen_data.py`. Do not hand-edit generated dashboard HTML. The browser extension is a launcher/shell, not the dashboard source.

Regenerate using the repository's normal generator sequence:

```sh
cd generators
python3 gen_data.py
python3 build_app.py
```

Do not change unrelated dirty files or the existing untracked workbook outputs.

## State and sync contract

Add a separate `state.wrapperArts` boolean map. Do not insert these checks into the canonical `state.checks` map and do not alter existing `slots`, extras, or completion math.

Requirements:

1. Existing saved state and old Gist payloads load unchanged when `wrapperArts` is absent.
2. Export/import includes `wrapperArts` without changing existing fields.
3. Packs Gist sync includes `wrapperArts` in the packs-owned payload and merges keys without deleting locally known keys solely because an older remote payload lacks the field.
4. Clicking a wrapper checkbox persists immediately and survives reload, export/import, and sync round trips.
5. Wrapper-art ownership never marks the parent pack-type target complete and never adds inventory quantity.

If the app's existing sync format has a schema version, extend it compatibly; do not silently reinterpret old `checks` entries.

## UI contract

Place a collapsed `Wrapper artwork (optional)` section in the detail area of each matching regular-booster row. Do not add 378 always-visible cards to the main list.

For each matching set:

- Show summary text such as `2 / 5 artwork fronts owned`.
- Render a compact card for every catalog artwork with thumbnail, `Art 1` through `Art N`, and a checkbox.
- Use a generous single tap target so clicking the card toggles the checkbox.
- Lazy-load thumbnails (`loading="lazy"` and/or assigning `src` only when the detail section opens).
- Give each image meaningful alt text: `<Set name> booster wrapper Art <N>`.
- On image failure, keep the checkbox and label visible and show a neutral `Image unavailable` placeholder.
- Visually distinguish `group_reference`, `review_only`, and `pending_image_source` from `exact_individual`; never imply those images are confirmed exact thumbnails.
- Keep the section usable at desktop width and at 390 px and 360 px without horizontal scrolling.

Suggested lookup: normalize the dashboard pack row's canonical set code and join to `sets[].setCode`. Do not join only on display name. Only attach the art section to the regular pack row, not Collector/Set/Theme/VIP/sleeved variants.

## Image provenance and exceptions

The main image source is the public Card Forge extras repository. Most files use `<SET>_<N>.jpg`.

| Set | Status | Required handling |
| --- | --- | --- |
| Iconic Masters (`IMA`) | Exact individual | Forge uses legacy filename prefix `ICO` and PNG files. Keep state IDs as `IMA-N`. |
| Portal (`POR`) | Exact individual, count needs physical confirmation | The acquisition catalog uses four English fronts. Forge also exposes `POR_5.jpg`; verify the four physical fronts before final human-readable art labeling. Do not add a fifth checklist item without evidence. |
| Unhinged (`UNH`) | Group reference | One photo shows three fronts. Create reviewed crops or replace with durable individual images before calling the thumbnails exact. |
| Unstable (`UST`) | Review only | Three retailer-hosted candidates appear distinct. Visually verify and replace with durable/licensed sources where possible. |
| Battlebond (`BBD`) | Group reference | One reference image contains three vertically stacked fronts. Create reviewed top/middle/bottom crops or replace them. |
| Double Masters (`2XM`) | Image pending | Three Draft Booster fronts are counted, but no trustworthy image URLs are supplied. Do not substitute VIP Edition or outer sleeved art. |

The catalog's `imageStatus` is a hard UI truth label:

- `exact_individual`: may be shown as the exact thumbnail.
- `group_reference`: show the shared image plus position hint and an unverified badge, unless replaced by a reviewed crop.
- `review_only`: show only with a review badge, or fall back to placeholder until manually approved.
- `pending_image_source`: placeholder only.

Do not download and commit third-party imagery without first confirming repository policy and reuse rights. Remote-image loading must fail safely.

## New-set artwork discovery and intake

Use this process whenever a new booster product is announced or released. Discovery may identify candidates, but the dashboard must add a checkbox only after product identity and the number of distinct physical wrapper fronts are verified.

### 1. Establish the exact product lane

Start with Wizards of the Coast product/packaging articles and product galleries. Record:

- Canonical set name, set code, release date, language, and booster type.
- Whether the pictured item is a loose inner booster, an outer sleeved booster, or display packaging.
- Whether Draft, Play, Set, Collector, Jumpstart, Beyond, promo/sample, and other booster lanes have different art runs.
- The explicitly shown or stated count of distinct loose-wrapper fronts.

Keep each booster lane separate. This catalog currently accepts only the regular English loose retail booster lane. Never infer loose-wrapper art from a display box, Collector Booster, or outer cardboard sleeve.

### 2. Find candidate imagery in this order

1. Official Wizards product pages, packaging articles, press kits, or CDN assets.
2. The Forge filename manifest and Forge extras image repository after the community adds the product.
3. Reputable distributor or large-retailer product galleries that show the exact loose pack and every front.
4. High-resolution marketplace photographs only as temporary review evidence, never as automatic exact identity.

Useful discovery locations:

- Wizards Magic product index: <https://magic.wizards.com/en/products>
- Wizards articles/search: <https://magic.wizards.com/en/news>
- Forge booster filename manifest: <https://raw.githubusercontent.com/Card-Forge/forge/master/forge-gui/res/lists/booster-images.txt>
- Forge extras booster directory: <https://github.com/Card-Forge/forge-extras/tree/main/images/boosters>
- Scryfall set metadata for canonical set code/name/date only: <https://scryfall.com/sets>

Scryfall card art is not pack art. Do not manufacture a wrapper thumbnail by substituting a card image.

### 3. Verify every distinct front

For every candidate image, confirm all of the following:

- The set logo, language, card count, and booster-type wording match the intended product.
- The image shows the loose factory wrapper rather than an outer sleeve or box.
- The front artwork is actually distinct, not the same art photographed at a different angle.
- The claimed total is supported by an official gallery, a complete group photo, a Forge manifest run, or two independent reputable sources.
- No image is a mock-up, fan render, repack, mystery pack, damaged wrapper, or mixed-set lot.

If the count or identity is ambiguous, add the record only as `review_only` or `pending_image_source`. Do not expose an ambiguous image as `exact_individual`.

### 4. Add stable catalog records

Append the set to `data/booster_wrapper_art_counts.csv`, update the builder's explicit expected totals, then extend `scripts/build_wrapper_art_handoff_catalog.py` only when an alias or special source is required. Preserve this identity pattern:

```text
setCode = official uppercase set code
art id = <setCode>-<1-based physical-front index>
persisted key = packs|wrapper-art|<art id>
```

Number fronts in a deterministic published order. Prefer official gallery order; otherwise use the Forge numeric suffix order. Once released, never renumber an existing art ID because an image URL, display label, or source changes.

For a newly added set, include provenance and any uncertainty in `validationNote`. If later evidence changes the art count, preserve prior owned state through an explicit migration rather than silently reusing IDs.

### 5. Validate and promote

Regenerate the catalog and confirm its totals intentionally changed by the expected amount. Add fixtures for the new set, including at least one failed-image case. A reviewer should compare every thumbnail to the physical-front evidence before changing `imageStatus` to `exact_individual`.

Only then regenerate the dashboard, run the full test suite, and perform desktop plus 390/360 px browser QA. The new wrapper checks remain optional and must not change the main collection totals.

### Suggested maintainable automation

A future read-only discovery job may periodically compare:

- Canonical booster products present in dashboard data.
- Forge manifest prefixes and numeric image runs.
- Set codes and release dates from Scryfall metadata.

It may produce a review queue containing proposed set code, product lane, candidate art count, image URLs, source timestamps, and discrepancies. It must not auto-promote candidates to `exact_individual`; a deterministic validator plus human image review remains the gate.

## Required tests

Add regression coverage before considering the feature complete:

1. Catalog validation asserts 96 sets, 378 artworks, unique set codes, unique art IDs, `artCount === artworks.length`, and allowed image statuses.
2. A representative five-art set renders five distinct stable checkbox keys.
3. The `IMA` alias loads `ICO_1.png` while persisting `IMA-1`.
4. `2XM` renders three usable checkbox cards with placeholders and no broken-image collapse.
5. Toggling wrapper art does not change existing required-target or inventory-slot totals.
6. Existing saved state without `wrapperArts` loads successfully.
7. Export/import and packs Gist serialization round-trip wrapper checks.
8. The regular booster receives the art section; Collector/Set/Theme/VIP/sleeved variants do not.
9. Image load failure keeps the label and checkbox operable.

Run at minimum:

```sh
npm --prefix node-app test
git diff --check
```

Also run any generator/dashboard-specific suites named in `HANDOFF.md`.

## Browser acceptance

Serve the generated dashboard over HTTP and verify the actual user surface, not a local-file shortcut.

Desktop acceptance:

- Open at least one five-art set and one exception set.
- Confirm thumbnails, labels, checkbox hit areas, summary count, persistence after reload, and no change to main completion totals.
- Confirm a missing image produces a visible placeholder.

Narrow-width acceptance at both 390 px and 360 px:

- No horizontal page scroll.
- Art cards remain readable and tappable.
- Opening/closing details does not jump the page unexpectedly.
- Checkbox state remains visible without relying on hover.

## Source references

- Forge manifest: <https://raw.githubusercontent.com/Card-Forge/forge/master/forge-gui/res/lists/booster-images.txt>
- Forge image repository: <https://github.com/Card-Forge/forge-extras/tree/main/images/boosters>
- General booster reference: <https://mtg.fandom.com/wiki/Booster_pack>
- Portal: <https://mtg.fandom.com/wiki/Portal>
- Unstable: <https://mtg.fandom.com/wiki/Unstable>
- Battlebond: <https://mtg.fandom.com/wiki/Battlebond>
- Double Masters: <https://mtg.fandom.com/wiki/Double_Masters>

## Definition of done

The feature is complete only when the generated dashboard exposes all 378 stable optional checks, exact/review status is truthful, existing completion semantics are unchanged, persistence and sync are covered by tests, the generated artifact is rebuilt, and desktop plus narrow-width browser QA passes.
