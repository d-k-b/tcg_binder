# TCG Collection Tracker browser extension

This Manifest V3 extension opens the live collection dashboard in Chrome or
Microsoft Edge's persistent side panel. The dashboard remains hosted at
`https://d-k-b.github.io/tcg_binder/`, so it keeps the same browser storage and
GitHub Gist sync state as the full-page app.

The extension is deliberately a thin shell. Publishing a newly generated dashboard
updates the extension view without copying generated HTML into the extension or
creating a second progress store.

For extension architecture, workstream ownership, the dashboard compatibility
contract, and the TCG Comps bridge, read
[`browser-extension/HANDOFF.md`](HANDOFF.md). Dashboard collecting rules and
generator internals remain in the root [`HANDOFF.md`](../HANDOFF.md).

## How the app and dashboard fit together

The extension supplies the browser-native surface: a toolbar action, persistent side
panel, refresh/open controls, and a safe choice between the live and local dashboard.
The iframe supplies the actual collection app. It continues to own rendering,
collection data, progress, Gist sync, and the GitHub token.

Because the embedded page keeps its normal `https://d-k-b.github.io` origin, opening
the dashboard in the extension or in a full tab reaches the same browser storage.
The extension does not duplicate the dashboard, copy its generated HTML, or create a
second collection state.

## Install in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this `browser-extension` folder.
4. Pin **TCG Collection Tracker** to the toolbar.
5. Select its toolbar icon, or press **Command+Shift+Y** on macOS
   (**Ctrl+Shift+Y** elsewhere), to open the side panel.

## Install in Microsoft Edge

1. Open `edge://extensions`.
2. Turn on **Developer mode**.
3. Select **Load unpacked** and choose this `browser-extension` folder.
4. Show the extension on the toolbar and select it to open the sidebar.

The browser may leave the suggested keyboard shortcut unassigned if it conflicts
with another extension. Change it at `chrome://extensions/shortcuts` or
`edge://extensions/shortcuts`.

## Update the dashboard

The dashboard remains generator-first:

```bash
cd generators
python3 gen_data.py
python3 build_app.py
```

After committing and publishing the generated root `index.html`, select **Get the
latest published dashboard** (the circular arrow) in the extension toolbar. It adds
a one-time cache-busting query while keeping the dashboard on its normal GitHub
Pages origin, so the existing local progress and Gist connection remain available.

For local work, open the extension's gear and use
`http://127.0.0.1:8765/` after starting `./serve_binder.command`.

When the extension's own files change, increment `version` in `manifest.json`, then
select **Reload** for the unpacked extension on the browser's extensions page.
Version `1.5.0` adds AI-assisted local collection drafts, reuses the remembered BYOK
OpenAI key, and retains photo identification plus the privileged
collection deal/auction monitor bridge, explicit
monitor sync/status/manual-run controls, active-panel debounced resync, and
credential-safe monitor diagnostics. It also blocks monitor messages until the
cross-origin dashboard has replaced the iframe's initial `about:blank` document.
Provider release differences remain
informational when the negotiated API stays v1. The dashboard remains pinned to the
side panel's flexible grid row, so hiding Settings or the page-check summary cannot
collapse it to 150px tall.

Dashboard features and responsive UI changes belong in the dashboard workstream.
Extension controls, browser integration, packaging, and the pricing-app bridge belong
in the extension workstream. Coordinate changes only when they alter the documented
interface between the iframe and its extension shell.

## Identify a sealed product from a photo

Open Settings, paste a dedicated OpenAI API key, leave **Remember on this device**
checked, and save. The key remains in the Tracker extension's private local storage;
it is never sent into the dashboard iframe or collection/Gist state. Use a project
key with a conservative spending limit, and use **Forget key** to remove it.

## Create a collection with AI

Use **New Collection** in the dashboard toolbar, then describe a rule such as
“collect three of every Lorcana booster box.” The extension sends the conversation
and the dashboard's non-secret built-in catalog to OpenAI with API storage disabled.
The assistant may ask clarifying questions, but it can propose only catalog IDs the
dashboard supplied and validates again.

Clicking **Create local draft** stores a self-describing, versioned collection only
in the dashboard origin's local state. Draft definitions, owned quantities, extras,
and ordered quantities are excluded from every automatic or manual Gist write.
After testing the checklist, use its explicit **Publish to GitHub Gist** button to
promote it. Deleting a draft is local-only and clearly reports how many progress
records will be removed.

In the dashboard, select the camera button and take or choose a clear photo of one
sealed product. The dashboard resizes and re-encodes the image, the extension asks
OpenAI for structured observations, and exact wrapper fronts are compared only with
the reviewed catalog references for the identified set. Results are suggestions.
Collection state changes only if the user presses a displayed − or + quantity
control. A low-confidence or out-of-catalog result leaves collection state unchanged.

## Pair with TCG Comps

Live pricing requires TCG Comps API v1 and a two-part pairing. Both the provider's
capability token and the tracker's extension ID must match.

1. Open `chrome://extensions` or `edge://extensions` and select **Reload** for both
   **TCG Comps** and **TCG Collection Tracker**.
2. Open the tracker side panel, open its gear, and copy the displayed **Trusted
   consumer ID**.
3. Open the TCG Comps popup. Paste that tracker ID into **Trusted consumer extension
   IDs**, then save.
4. In TCG Comps select **Copy API connection**. The copied JSON contains the TCG
   Comps extension ID and capability token.
5. Paste those two values into the tracker's **TCG Comps live pricing** settings and
   select **Save & test**. A successful check reports the installed provider release
   and confirms that API v1 is compatible. A different provider release number is an
   informational version note, not a connection error.
6. If either unpacked extension changes, reload both extensions and reopen the side
   panel. If TCG Comps rotates its token, paste the new token and test again.

The token is stored only in the tracker extension's private `chrome.storage.local`.
It is never sent to the dashboard iframe, page `localStorage`, generated HTML, Gist,
logs, debug state, or this repository. Selecting **Remove pairing** deletes the
stored TCG Comps ID and token.

Open any dashboard row's detail drawer and select **Check live price**. A successful
exact-product response shows the live market value, lowest verified landed ask,
confidence, and observation time. Static catalog values remain labeled fallbacks.
An unavailable result is never displayed as `$0`. Watch creation, removal, and
manual **Run now** controls appear only after that exact product prices successfully;
TCG Comps owns and persists the watch.

## Mark collection needs on a marketplace page

After pairing TCG Comps, open an eBay seller/search page, Heritage auction surface,
or supported storefront such as Game Nerdz or Flipside Gaming. Open the Tracker side
panel and select **Mark collection needs on this page** (the first toolbar button).

The button is intentionally a direct action: the extension asks the dashboard for
one current, memory-only snapshot of all 686 canonical ProductRefs, then asks TCG
Comps to discover, match, and decorate the active page. TCG Comps watches supported
infinite-scroll results for up to 30 minutes. Run the button again after changing
collection quantities or after either extension reloads.

Page badges are fail-closed:

- **NEED** means an exact matched product is still missing from a required target.
- **OWNED** means the exact product's target is already satisfied.
- **TARGET** identifies a tracked optional/unowned product without calling it needed.
- **CHECK** means the listing is ambiguous, mixed, accessory-like, or not in the
  submitted catalog. It never means that the item is safe to ignore.

The Tracker does not scrape marketplace pages or request marketplace, scripting, or
tab permissions. TCG Comps owns discovery, matching, and its namespaced overlay. The
collection snapshot contains only full ProductRefs and target/owned/missing counts;
it contains no progress keys, Gist data, GitHub credential, or pricing credential,
and TCG Comps keeps it only in memory for the overlay session.

If a page check fails, select the copy icon beside the error and paste the report
into the extension support task. The report distinguishes dashboard snapshot,
provider-call, and response-validation failures and includes the Tracker version,
dashboard URL/origin, paired provider ID, schemas, timing, and sanitized stack. It
never includes the TCG Comps capability token. For
`DASHBOARD_SNAPSHOT_TIMEOUT`, first select **Get the latest published dashboard**;
if it repeats, the copied dashboard URL and failure stage reveal whether the public
dashboard is still missing the snapshot bridge.

## Collection deal and auction monitor

Open the extension gear and use **Collection deal monitor** after pairing TCG
Comps 2.42.0. **Sync monitor** requests the current
`tcg.collection-monitor-subscription/v1` bundle from the exact dashboard frame,
validates it, and forwards all 686 canonical ProductRefs atomically through the
authenticated TCG Comps client. **Refresh status** retrieves the provider's current
non-secret revision/counts plus configured/online state. **Run now** is the only browser path that requests an
immediate monitor run and is never called automatically.

While the side panel is visible, a payload-free dashboard `monitorStateChanged`
hint schedules a debounced fresh-bundle request. Repeated hints for the same
accepted revision do not create repeated automatic provider syncs; a changed
revision does. Hints received while the panel is inactive remain queued until it
becomes visible again.

The extension reports only bounded, memory-only sync status back to the exact
dashboard origin/frame. It never sends the TCG Comps capability token, monitor
bearer token, email address, subscription body, GitHub/Gist credentials, checklist
keys, prices, listings, or provider IDs to the dashboard. Monitor errors expose a
copy button with the failing stage, revision/count metadata, versions, and sanitized
error details.

TCG Comps and its always-on service own exact listing identity, Market and landed
price calculation, alert eligibility, listing history, scheduling, deduplication,
and email delivery. The Tracker does not parse marketplace pages for monitoring and
never buys, bids, submits offers, or weakens ambiguous/mixed/stale safeguards.

After updating the unpacked extension, select **Reload** for both extensions in
`chrome://extensions` or `edge://extensions`, reopen the side panel, refresh the
published dashboard, then use **Sync monitor**.

## Build icons and validate

```bash
python3 browser-extension/tools/build_icons.py
cd node-app
npm test
```

The extension uses no remote scripts, asks only for side-panel and extension-storage
permissions, and does not store the dashboard's GitHub token itself. The token and
checklist state remain inside the dashboard origin exactly as they do today.
