# MTG Sealed Collecting Binder

A small Node app that turns your Magic: The Gathering sealed-product checklists into a
live, clickable web app — with optional **Google Drive sync** so your progress is backed
up and available on any device.

Seven checklists are built in (888 required targets, plus 40 bonus booster-box
inventory slots that do not affect completion):

| Tab | What it tracks |
|-----|----------------|
| **MTG Collector Boxes** | Every Collector Booster display, by era, with market values |
| **MTG Booster Boxes** | One goal display per set, plus quantities for every other non-Collector display type |
| **MTG Booster Packs** | Two of every booster pack per set, by type |
| **MTG Prerelease Packs** | One of every prerelease variant (guild/clan/college sets included) |
| **Lorcana Booster Boxes** | One booster box per kid |
| **Lorcana Prerelease Boxes** | One prerelease box per kid, where released |
| **Lorcana Collector Boxes** | One collector box per kid, where released |

---

## Quick start (no Google account needed)

You need [Node.js 18+](https://nodejs.org) installed. Then, in this folder:

```bash
npm install
npm start
```

Open **http://localhost:3000**. Everything works immediately and your checkmarks are saved
in the browser. Google Drive stays "off" until you do the setup below.

---

## Backup & sync — two options

Your checkmarks always save in the browser. To back them up and sync across
devices, connect **one** storage backend. If both are set, GitHub wins.

### Option A — GitHub Gist (easiest, ~1 minute)
1. github.com → **Settings → Developer settings → Personal access tokens →
   Tokens (classic) → Generate new token**.
2. Tick **only the `gist` scope**. Generate, copy the token.
3. Put it in `.env` as `GITHUB_TOKEN=...` and restart.

That's it — no OAuth, no consent screen, no verification warning. Progress saves
to **one private gist per checklist**, named `mtg-binder-<checklist>.json`, and the
app re-discovers those gists by filename, so it survives a wiped disk on a host.

**Two places you can put the token — both work, use either or both:**

| Where | Good for |
|---|---|
| **Dashboard → Sync button** | Stored in that browser. Paste it on any device/fresh install; no file editing. The page then talks to GitHub directly. |
| **`.env` → `GITHUB_TOKEN=`** | Server-side. Needed for the CLI diagnostics below, and for a deployed instance. |

Keep a copy of the token in your password manager — that's all you need to bring
the app up anywhere.

### Diagnostics
```bash
npm run check:gist   # real round-trip against GitHub: auth → write → read back
npm test             # offline logic tests, no token/network needed
```
`check:gist` never prints your token, so its output is safe to share when
something needs debugging.

### Command-line collection access

The CLI reads and updates the same private-Gist collection state without needing
the dashboard open. It previews every mutation first; add `--apply` only after
reviewing the exact ProductRef and resulting totals.

```bash
npm run collection -- find Mirage --lane boxes
npm run collection -- show mtg:mir:mirage:booster:display:en
npm run collection -- set mtg:mir:mirage:booster:display:en --owned 3 --ordered 1
npm run collection -- set mtg:mir:mirage:booster:display:en --owned 3 --ordered 1 --apply
```

The CLI requires `GITHUB_TOKEN` in the process environment and deliberately
does not access browser localStorage. See
[`docs/COLLECTION_STATE_CLI.md`](../docs/COLLECTION_STATE_CLI.md) for the
shared state contract and dashboard/CLI parity rule.

### Option B — Google Drive (~5–10 minutes)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a project
   (or pick an existing one).
2. **APIs & Services → Library →** search **"Google Drive API"** → **Enable**.
3. **APIs & Services → OAuth consent screen:** choose **External**, fill in an app name and
   your email, and add yourself as a **Test user** (your own Gmail). You can leave it in
   "Testing" mode — no Google review needed for personal use.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**
   - **Authorized redirect URI:** `http://localhost:3000/auth/google/callback`
   - Create, then copy the **Client ID** and **Client secret**.
5. In this folder, copy `.env.example` to `.env` and paste your values:
   ```bash
   cp .env.example .env
   ```
   ```
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
   SESSION_SECRET=any-random-string
   PORT=3000
   ```
6. Restart the server (`npm start`), open the app, click **Sync Drive → Connect Google
   Drive**, and approve. A file called `mtg-binder-progress.json` will appear in your Drive
   and update automatically every time you check something off.

**Privacy:** the app requests only the `drive.file` scope — it can read/write the single
file it creates and **cannot see anything else** in your Drive. Your OAuth tokens are stored
locally in `.data/` (git-ignored) and never leave your machine.

---

## How it's built

```
server.js          Express server: UI + OAuth + Drive + price endpoints
lib/ebay.js        eBay Buy API client (Browse active + Insights sold)
lib/prices.js      Price cache, query builders, extension job queue
public/index.html  The app shell (same look as the PDF checklists)
public/app.js      Frontend: rendering, progress, Drive sync, live prices
data/binder_data.json   The seven checklists' data (MTG + Lorcana)
extension/         Chrome extension (TCGplayer price helper)
.env(.example)     Google + eBay credentials
.data/             Local token / file-id / price cache (git-ignored)
```

### API endpoints
| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/data` | Checklist structure |
| GET | `/api/status` | `{configured, connected, email}` |
| GET / PUT | `/api/progress` | Read/save your checks (Drive) |
| GET | `/auth/google` · `/auth/google/callback` · POST `/auth/logout` | Drive OAuth |
| GET | `/api/prices` | Cached live prices + refresh status |
| POST | `/api/prices/refresh?checklist=ID` | Kick off an eBay refresh + queue TCG jobs |
| GET | `/api/ext/jobs` | Extension pulls TCGplayer jobs |
| POST | `/api/ext/ingest` | Extension posts a scraped TCGplayer price |

The generated static dashboard has a separate current integration under **More →
Pricing API settings**. It accepts an HTTPS TCG Pricing REST base URL and the
dedicated read-only access key, optionally remembered on that device. Those fields
are not part of this historical Node pricing frontend and never enter collection
state or Gists. Qualified current auctions supplied by TCG Comps render separately
from the verified Buy Now low, with a provisional-current-bid warning; they never
change Market value or fixed-price watch semantics. The deployed non-secret base URL
is `https://gogo.tail903ec0.ts.net`; **Save & test** verifies authenticated readiness
before use. See `../docs/API_CREDENTIALS.md`.
Exact responses whose verified recent-sale Market is still pending are labeled
separately; review-only catalog reference amounts are never displayed or used for
deals or watches. A pending or unavailable REST result can request bounded source
health explicitly without exposing the dashboard's REST key.
Every authenticated dashboard refresh checks exact product identity and requested
live asks. The Provider Authority persists ProductRef-keyed sale identities,
discovers only new public recent-sale rows once per UTC day, and recomputes Market
only when new evidence arrives or its adaptive trend/dispersion forecast reaches the
configured change band. A successful exact response immediately replaces the
row's static headline estimate with the top-level Market value. Pending results retain
the static headline; cached or expired Analyzer values remain visible only as red
**Stale** pricing. Multi-product rows use the primary catalog-priced product or a
compact live range. The separate reload-safe dashboard cache retains only the
provider's allowlisted cache mode and bounded scheduling timestamps/flags. Market
freshness follows the sale-derived `market.observedAt` or
`cache.marketRefreshedAt`, not a newer live-listing observation, and no provider
cache key or raw evidence is stored. Freshness is display-only: the largest bounded provider percentage
signal (accepted monthly trend, venue spread, leave-one-out spread, or trend-versus-
consensus difference) becomes a conservative monthly drift rate. Projected drift below
5% is green **Market fresh**, 5% through under 8% amber **Market aging**, and 8% or more
red **Market stale**. The card shows the estimated drift and the calculated time from
refresh to the 4% target. This is a heuristic, not a forecast or guarantee. The UI never
displays or uses held-out `trendProjection` dollars. This display remains memory-only.
Expanded REST price cards also expose **Run full browser comps**. This separate,
manual-only action requires the installed TCG Comps browser agent and may take several
minutes. It is never used by normal refresh, toolbar batches, watches, timers, or
monitor work. Exact ProductRef and interactive-browser provenance are required;
offline, timeout, queue, expiry, analysis, and invalid-result failures keep the prior
valuation and display a sanitized row message. Browser jobs and evidence stay
memory-only and outside collection state, Gists, exports, and debug reports.

---

## Live prices (eBay API + TCGplayer via the Chrome extension)

Click **↻ Refresh prices** on any tab and the app pulls current values, replacing the
static estimates with a green **LIVE** figure (hover it for the breakdown + timestamp).

**How it works**
- **eBay** runs server-side through eBay's official Buy API:
  - *lowest active listing* via the **Browse API** (works with a standard app token), and
  - *recent sold price* via the **Marketplace Insights API** — note this one needs
    separate access approval from eBay; if your app isn't approved, sold just shows blank
    and you still get the lowest active price.
- **TCGplayer** has no usable public API, so its market price is read by the companion
  **Chrome extension** (in `extension/`), which opens the TCGplayer page in a background
  tab on demand and scrapes the price. This is personal-use, on-demand, one-tab-at-a-time —
  not a crawler. Keep volume reasonable and respect TCGplayer's terms.

### eBay setup (~5 min)
1. Create a free developer account at [developer.ebay.com](https://developer.ebay.com/).
2. Make an app keyset (Production). Copy the **Client ID (App ID)** and **Client Secret (Cert ID)**.
3. Put them in `.env` as `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (the server mints and refreshes
   tokens automatically). Or paste a ready OAuth token as `EBAY_TOKEN` (expires ~2h).
4. Restart the server. The lowest-active price works immediately. (Sold prices require the
   Marketplace Insights API — request access in your eBay dev dashboard if you want them.)

### Load the Chrome extension (one time)
1. In Chrome: **chrome://extensions** → toggle **Developer mode** (top-right).
2. **Load unpacked** → pick the `extension/` folder in this project.
3. Click the puzzle-piece toolbar icon → pin **Binder Price Helper**. Open it; confirm the
   server URL is `http://localhost:3000` and the status dot is green.
4. Flow: click **↻ Refresh prices** in the binder (this queues TCGplayer jobs and updates
   eBay right away), then click **Sync now** in the extension popup — it opens each TCGplayer
   page briefly, reads the price, and the binder fills in the TCGplayer column. Turn on
   **Auto-sync** in the popup to have it drain the queue every minute on its own.

> Note: TCGplayer changes its page markup periodically. If prices stop coming through, the
> scraper selectors in `extension/background.js` (`scrapeTcgPage`) may need a quick tweak.

### Smart listing filter (AI — optional)
Marketplace results are noisy: empty boxes, lots, loose packs, graded singles, the wrong
product type. Add an AI key and the server will read each batch of candidate listings and
keep only the ones that are actually *this* sealed box — and for lots/bundles it computes a
per-box price (e.g. "$420 for 3" → $140/box). Hover a LIVE price to see how many listings
it filtered out (and whether AI or the basic heuristic did it).

- Provider-agnostic: set **`OPENAI_API_KEY`** *or* **`ANTHROPIC_API_KEY`** in `.env`
  (or force `AI_PROVIDER`). Uses a cheap fast model by default (`gpt-4o-mini` /
  `claude-haiku-4-5-20251001`); override with `AI_MODEL`. One batched call per set per
  refresh — pennies at on-demand volume.
- No key? It silently falls back to a regex heuristic. Nothing breaks.

### Pasting keys from the extension (instead of editing `.env`)
The extension popup has an **⚙ API keys** panel. Anything you paste there is POSTed to your
local server and stored in `.data/secrets.json` (git-ignored) — **not** kept in the
extension. This keeps secrets off the browser side. The `.env` file still works and takes
precedence on startup.

> **Sandbox vs production (eBay):** `EBAY_ENV=sandbox` talks to eBay's test environment,
> which returns **fake test listings, not real market prices**. Use it to confirm the OAuth
> connection works, then switch to **Production** keys (remove `EBAY_ENV`) for real values.

## Extending it to "other things"

Because it's a normal Express backend, you can add more integrations the same way:

- **Notion / Airtable / a database** — mirror progress to a second store.
- **Dropbox / OneDrive** — swap the Drive client for another SDK behind `/api/progress`.
- **eBay sold via extension** — if you don't get Marketplace Insights access, the extension
  can also read eBay's *sold* pages (same pattern as TCGplayer). Ask and I'll wire it.

---

## Deploying it (so your phone can use it)

Running locally means the app only exists at `localhost` — your phone can't reach it.
To get a real URL, deploy to any Node host (Render, Railway, Fly.io, a VPS):

1. Push this folder to a GitHub repo.
2. On [Render](https://render.com) → **New → Web Service** → pick the repo.
   Build command `npm install`, start command `npm start`. The free tier is fine.
3. In the host's **Environment** tab, add your vars (not a `.env` file):
   - `APP_PASSWORD` — **set this.** A deployed app is public; this puts a
     login prompt in front of everything. Without it, anyone with the URL can
     read and edit your collection.
   - `GITHUB_TOKEN` (Gist) **or** the Google vars (Drive).
   - `SESSION_SECRET` — any random string.
4. **If using Drive**, add `https://YOUR-APP.onrender.com/auth/google/callback` to the
   Authorized redirect URIs in Google Cloud and set `GOOGLE_REDIRECT_URI` to match.
   Then connect once and copy the `GOOGLE_REFRESH_TOKEN` the server logs into your
   env vars — free hosts wipe the disk on redeploy, which would otherwise log you out.
   *(Gist has no such problem — it's just a token.)*

Then open the URL on any device, enter the password, and everything syncs.

**Security note:** the `/api/config` key-entry endpoint is disabled on deployed
instances — set keys as host env vars instead. That keeps a public URL from being
able to write credentials.

---

*Values and counts are best-effort estimates compiled June 2026 — verify before purchase.
Magic: The Gathering is © Wizards of the Coast. This is a personal collecting tool.*
