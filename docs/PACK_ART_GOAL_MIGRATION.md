# Required two-per-front MTG pack goals — November 3, 2026

The approved policy is `data/mtg_pack_art_goal.json`. It supersedes the older
optional wrapper-art rule. Samples, promotional/prize packs and Welcome boosters
remain separate. Boxes and all Lorcana goals are unchanged.

## Inventory and completion are different

The 719-product catalog adds 30 pack identities: 11 Jumpstart products, 16 Theme
products, and regular Unhinged, Unstable and Ultimate Masters boosters. Existing
689 ProductRefs and every old content key remain stable. New slots have no legacy
positional key. Draft/Set/Play/Collector and specialty editions never share art
credit solely because a set code matches.

`tcg.collection-snapshot/v2` retains physical `owned`, `ordered`, and baseline
`missing = max(target - owned - ordered, 0)` arithmetic. For MTG packs those
baseline counts are NOT artwork completion. The independent additive
`packArtRequirements` field uses `tcg.pack-art-requirements/v1`, keyed by existing
pack ProductRef and stable artwork ID. It is included in the snapshot revision.
No synthetic artwork ProductRef or price identity is created.

Each known front requires two copies. Absent front ownership is `null` (unreviewed),
not zero. An explicit numeric zero persists a physical inventory review. Old
boolean true migrates to one. Owned and ordered artwork quantities remain separate;
an incoming pack never becomes owned without explicit receipt. Neither artwork
credit nor box ownership adds physical loose-pack inventory.

The current art catalog covers 378 regular-pack fronts (756 copy targets). Other
types, editions and newer releases have unverified art counts and remain visibly
incomplete. This is a partial catalog, not a claim to have identified every booster
ever made. The dashboard labels known-target progress partial and does not hide a
row merely because its aggregate pack count is two. Count-review exceptions also
cannot become complete automatically.

## Shared semantics and edits

`node-app/lib/pack-art-goal.js` is the pure shared model, embedded verbatim by the
dashboard generator. `collection-state.describe()` exposes the same goal.
`setArtworkQuantities()` and CLI `art-review <ProductRef> --artwork <id> --owned N`
validate the exact product/front relationship. CLI writes still preview by default
and require `--apply`; unknown fronts and cross-set IDs are rejected. Physical
quantity operations are unchanged. No migration doubles old quantities.

Generator order: `python3 generators/gen_data.py`, then
`python3 generators/build_app.py`. Both binder JSON copies and all three HTML
copies must match. Never edit generated HTML directly.

## Fail-closed compatibility

Collection Authority 1.4.0 and Tracker extension 1.7.0 require 719 products. The
extension preserves the artwork overlay but blocks legacy marketplace page
decoration because it cannot establish front-specific NEED/OWNED badges.

Authority monitor sync refuses to replace the existing durable subscription when
the provider validator drops the artwork overlay (`MONITOR_PACK_ART_UNSUPPORTED`).
Global ownership freshness remains independent: do not make all seven lanes
conditional just because pack artwork is partial. Provider normalization, revision
hashing and review-target retention require a compatible provider release. Until
that release is activated, the live monitor's legacy pack counts are not complete
new-goal coverage. Normal monitoring and the saved heartbeat policy continue with
that limitation explicit. Provider deployment/restart needs separate approval.

## Validation and activation

Run focused pack-art/core/Authority tests, the full `npm --prefix node-app test`
suite, and `git diff --check`. Browser acceptance must verify persistence, unknown
versus reviewed-zero, 1/2 per front, duplicate caps, and desktop/390/360 px layouts.
Publish only reviewed source/generated artifacts; never publish private evidence,
receipts, tokens or `outputs/`. Reload only the approved Tracker Authority child
and Tracker extension, not the provider/monitor supervisor. Compare all 689 old
physical counts before/after, then apply the two pending confirmed Jumpstart receipts
through revision-checked, idempotent Authority operations and verify readback.
