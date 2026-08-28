# Collection-state core and CLI

`node-app/lib/collection-state.js` is the deterministic collection-state core.
It owns stable content keys, group quantities, distinct variants, ordered
quantities, and receiving an order into owned inventory. It has no credentials,
network calls, browser storage, or filesystem writes.

`node-app/bin/tcg-collection.js` is the command-line adapter. It resolves a
published `tcg.product/v1` ProductRef from `data/binder_data.json`, reads the
corresponding private Gist, previews an exact mutation, and only writes after
an explicit `--apply`. The adapter re-reads the saved Gist and verifies the
changed maps. Its optimistic revision check refuses a stale write rather than
merging state it has not seen.

## Use

Run from `node-app/` after putting a classic GitHub token with only `gist`
scope in the process environment (normally an ignored local `.env`):

```bash
npm run collection -- find Mirage --lane boxes
npm run collection -- show mtg:mir:mirage:booster:display:en
npm run collection -- set mtg:mir:mirage:booster:display:en --owned 3 --ordered 1
npm run collection -- set mtg:mir:mirage:booster:display:en --owned 3 --ordered 1 --apply
npm run collection -- receive mtg:mir:mirage:booster:display:en --count 1 --apply
```

`set` and `receive` are previews unless `--apply` is included. `find` is
catalog-only. `show`, `set`, and `receive` never read dashboard localStorage or
a browser token; they require `GITHUB_TOKEN` and operate only on the private
Gist state. Use a full ProductRef if a text query matches more than one lane.
Add `--json` for machine-readable output.

## Compatibility contract

The core function surface and CLI verbs form the collection-state API:

| State operation | Core function | CLI |
| --- | --- | --- |
| Resolve a canonical product | `resolveProduct()` | `find`, `show` |
| Inspect quantity state | `describe()` | `show` |
| Set owned/ordered totals | `setQuantities()` | `set` |
| Receive ordered inventory | `receive()` | `receive` |

All state-changing features added to the dashboard must be added to this core,
exposed by a matching CLI verb or documented intentional exception, and covered
by a parity test in the same change. HTTP/API surfaces should use these same
operation names and JSON request fields (`productId`, `checklistId`, `owned`,
`ordered`, `count`) whenever their security model permits. No caller may invent
its own key, quantity, or receive semantics.

The current GitHub Pages dashboard is a generated browser bundle and cannot
import Node CommonJS directly. It still owns its browser integration, but its
stable-key and quantity behavior is now regression-tested against this core.
When the dashboard receives its next collection-state refactor, bundle this
pure module through `generators/build_app.py` (or call a versioned server API)
rather than copying another implementation. Do not edit generated HTML directly.

## Required change checklist

For any dashboard feature that reads or mutates durable collection state:

1. Add or revise the core operation in `node-app/lib/collection-state.js`.
2. Add a CLI command/flag with the same semantic input and JSON output fields,
   unless the feature is intrinsically browser-only; document that exception.
3. Preserve unknown Gist fields and use an exact ProductRef plus a current
   revision for any CLI/API mutation.
4. Add regression coverage to `node-app/tools/test-collection-state.js` and,
   when persistence changes, `node-app/tools/test-gist-logic.js`.
5. Update this document and `HANDOFF.md`; run the focused tests, full `npm
   test`, and `git diff --check`.

Wrapper-art ownership is intentionally not yet a CLI mutation verb. It remains
dashboard-only until it receives an exact wrapper-art ID lookup and a parity
test; the CLI preserves both wrapper-art state maps on every checklist mutation.
