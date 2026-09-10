# Local collection-monitor helpers

These scripts bootstrap the optional TCG Comps collection-deal monitor without
putting credentials, OAuth tokens, browser sessions, or durable listing state in
Git.

## Files

- `open_monitor_browser.command` starts the dedicated Chrome marketplace profile.
- `complete_ebay_oauth.command` completes one-time eBay user authorization and
  stores only the refresh token in the protected environment file.
- `run_local_price_monitor.command` validates all alert prerequisites, mints and
  renews the short-lived eBay Browse application token, and runs the canonical
  TCG Comps monitor on `127.0.0.1:3099`, Collection Authority on `3102`, and the
  Tailscale-facing path router on `3180`, with state under
  `/Users/dkb/.config/tcg-price-monitor/data`.
- `configure_local_price_monitor.mjs` generates internal bearer tokens and adds
  safe local defaults, including the official OpenBoosters sealed catalog, a
  quota-aware eBay Browse budget, and the Heritage feed path/premium rules.
- `update_heritage_feed.mjs` validates a trusted Heritage MyWantlist/session JSON
  export, rejects credential-like fields, canonicalizes lot URLs, applies the exact
  premium or 25%/$49 minimum, and atomically updates the protected monitor feed.
- `update_hibid_texas_feed.mjs` validates a structured public/browser capture of
  canonical HiBid Texas lots, rejects credentials, preserves each auctioneer's
  explicit shipping, buyer-premium rate/minimum, and current-premium evidence,
  and atomically updates the protected feed.
- `sync_local_monitor_from_gist.mjs` builds the complete 689-ProductRef
  subscription only from the authenticated loopback Collection Authority API;
  the legacy filename is retained for operator compatibility. Conditional
  snapshots are synchronized through `POST /v1/monitor/sync`, where Authority
  adds explicit review-only ownership policy and an effective disabled monitor
  preference; acknowledgement must retain all 689 products and report zero
  active targets. The helper never posts directly to the Pricing Analyzer monitor.
- `repair_collection_authority_gists.mjs` performs a safe dry-run diagnostic by
  default and an explicit, source-hash-gated legacy/missing-lane repair only with
  `--apply`.
- `install_local_price_monitor_launch_agent.mjs` installs the per-user macOS
  RunAtLoad/KeepAlive service.
- `refresh_monitored_markets.py` slowly refreshes exact Markets for the current
  monitor scope through the provider-owned Python Pricing REST client. It is
  sequential, resumable, and writes only a private sidecar checkpoint; it never
  edits monitor state, collection state, watches, or alerts.

The scripts expect `/Users/dkb/.config/tcg-price-monitor/monitor.env` to be mode
`0600`. They never print secret values. The runner locates the canonical provider
checkout at `/Users/dkb/Apps/Extensions/TcgPriceComparisons` unless
`TCG_PROVIDER_REPO` overrides it.

## Check readiness

```bash
node scripts/run_local_price_monitor.mjs --check
```

Generate the two internal bearer tokens and local authority defaults without
displaying their values:

```bash
node scripts/configure_local_price_monitor.mjs
```

This helper only fills blank internal fields and preserves any existing token.
It writes the protected file atomically with mode `0600`; it does not configure
third-party API keys or email addresses.

## Heritage feed

Heritage's public search may return a JavaScript/bot-defense interstitial, so the
always-on service does not scrape around it or store a marketplace password. Export
active MyWantlist/search lots through the trusted signed-in capture path, then validate
and install that sanitized JSON with:

```bash
node scripts/update_heritage_feed.mjs --input /path/to/heritage-export.json --check
node scripts/update_heritage_feed.mjs --input /path/to/heritage-export.json
```

The input must provide a stable `listingId`, exact title, canonical Heritage URL,
current bid, and end time for each lot. Shipping may remain unknown, but that row will
be review-only. Optional fields include next bid, exact buyer premium, reserve state,
bid/winning state, secret maximum, marketplace-watch state, and observed time. The
installed feed expires after 45 minutes by default, so stale session capture degrades
to review-only instead of generating a ceiling. Never add cookies, session values,
passwords, or OAuth material to this file.

## HiBid Texas feed

HiBid Texas has active MTG, Lorcana, Pokémon, and other TCG catalogs, but it is a
multi-auctioneer platform: premium, shipping, soft-close rules, and condition vary
by catalog and lot. Capture only current, exact, sealed lot facts from a normal
public or signed-in browser view; never store browser state or raw HTML. Then
validate and install the sanitized feed:

```bash
node scripts/update_hibid_texas_feed.mjs --input /path/to/hibid-texas-lots.json --check
node scripts/update_hibid_texas_feed.mjs --input /path/to/hibid-texas-lots.json
```

Each row needs a stable lot ID, canonical `https://hibid.com/texas/lot/...` URL,
exact title, current bid, next valid bid, end time, shipping, and the catalog's
`buyerPremiumRate` (plus `buyerPremiumMinimum` when applicable). An observed
current-dollar `buyerPremium` is useful evidence but cannot by itself support a
maximum bid: the monitor deducts shipping and the premium at the *maximum hammer*
before recommending one. Missing components remain REVIEW ONLY.

After the service is healthy, synchronize the newest trustworthy ownership state
from the local authenticated Collection Authority:

```bash
node scripts/sync_local_monitor_from_gist.mjs --dry-run
node scripts/sync_local_monitor_from_gist.mjs
```

The authority returns all 689 canonical ProductRefs atomically across seven lanes.
The sync sends only requested monitor preferences to the authenticated Authority,
which rebuilds and validates the collection before calling the loopback monitor. A
partial or stale ownership result is never converted into an all-missing claim;
neither the Gist token nor monitor token is read by this sync helper or forwarded.
The supervisor also runs this sync once after every service generation starts, so
an authenticated Gist repair or browser-closed collection change cannot leave an
obsolete partial subscription indefinitely. Failure retains the prior state and is
logged; it never starts marketplace work.

Direct Tracker exports and direct Gist reads are no longer monitor-authority paths.
Use `docs/COLLECTION_AUTHORITY_API.md` for the source-hash-gated missing-Gist
repair flow.

Every secret is reported only as `SET` or `EMPTY`. A ready capture configuration
requires eBay application credentials plus long monitor and authority bearer
tokens. The runner starts the canonical local provider authority and public-path
gateway on loopback by default. Tailscale serves the gateway; Provider Authority
itself is never exposed. Monitor email is delivered only through the authenticated
Google Workspace adapter when its account and recipient both equal
`dustyn@blasig.us`; otherwise delivery must fail closed. Resend values are not a
fallback for this workflow. OpenAI is optional: exact TCGplayer identity and Market do not
need it, while eBay asks remain unverified/review-only until AI verification is
configured.

## Run locally

Double-click `run_local_price_monitor.command`, or run:

```bash
scripts/run_local_price_monitor.command
```

To keep the runner active after login and restart it if it exits, install the
per-user macOS LaunchAgent:

```bash
node scripts/install_local_price_monitor_launch_agent.mjs
```

Its stdout and stderr logs are stored under
`~/.config/tcg-price-monitor/logs/`. The monitor remains local to this Mac and
runs while the Mac is awake and the user session is available.

The runner refreshes eBay authorization before expiry by restarting the
restart-safe authority and monitor against the same durable state. Source cadence is
provider-configured; the review/delivery layer wakes every two hours. Every source must consult
its durable cache, cursor, next-due time, and rate budget before making a request. eBay discovery uses shared broad and rotating set-level
Browse queries, refreshes active IDs in batches, and retrieves full item details only
for preliminary exact matches. A persisted daily safety budget and HTTP 429 circuit
breaker protect coverage from request storms. When `EBAY_USER_REFRESH_TOKEN` is set,
the runner also refreshes a short-lived user token and makes one read-only official
My eBay buying-state request per run for bid/watch/max-bid status. A refresh failure
degrades only those account fields; public discovery continues.

Collection Authority is supervised independently from Provider Authority, Pricing
REST, the monitor, and the gateway. The runner recognizes Node's transient iCloud
module-read `EAGAIN`/`Unknown system error -11` failure and treats an Authority that
does not reach its health endpoint as a bounded startup failure. A failed start uses
capped 1/2/5/10/30-second retry backoff and does not tear down the healthy provider
pricing socket or interrupt an active browser-pricing job. The gateway remains
available and reports the allowlisted `collectionAuthority` state as `starting`,
`ready`, `degraded`, `external`, or `stopped` at `/gateway/healthz`; no credentials,
paths, or collection data enter that status. The initial seven-lane collection sync
runs only after Authority is healthy. Keep this repository downloaded locally when
possible; the retry is a resilience boundary, not a substitute for durable files.

Verify the loopback services with:

```bash
curl -sS http://127.0.0.1:3099/healthz
curl -sS http://127.0.0.1:3100/healthz
curl -sS http://127.0.0.1:3180/gateway/healthz
```

Then configure TCG Comps with `http://127.0.0.1:3099` and the same
`TCG_MONITOR_TOKEN`, Reload TCG Comps and Tracker, and use **Sync monitor**. This
Mac must remain awake and online; moving the same service/state to an always-on
host is a later deployment step.

The service and these helpers never bid, buy, send offers, contact sellers, or
read stored marketplace passwords. Marketplace watch changes remain a separate,
explicitly authorized action.

## Slow Pricing REST refresh

Use this optional worker when the current monitor scope needs a fresh provider
Market pass outside its normal cadence. It reads active targets, active listings,
and review rows from the durable monitor state, deduplicates their canonical
ProductRefs, then invokes the Provider's documented Python
`PricingRestClient.price_product()` method one at a time. The Provider remains responsible for
serving unchanged evidence from its durable cache and fetching only source evidence that is due.
It uses the dedicated
Pricing REST token from the protected pricing config and never prints it.

Only a fresh, sale-derived method such as `theil-sen-recent-sales`,
`median-recent-sales`, or the Analyzer's `venue-balanced-median` stable
cross-venue consensus is stored as `status: market`. A catalog reference,
`source-market-fallback`, stale fallback, missing observation timestamp, or
unresolved response is recorded separately as non-actionable evidence and retried
on the next invocation. It never becomes a ceiling, Buy Now, or alert input.
When the provider supplies additive `market.stability`, the checkpoint retains
its safe consensus/dispersion diagnostics for email display. The displayed
Market and any future ceiling must still use only top-level `market.value`;
`trendProjection` is diagnostic and is never promoted. When a verified
recent-sales `monthlyTrendPct` is present, the worker also saves a separately
labeled **timing advisory** (down, up, or steady). It is a collector-facing
hint only: current Market remains primary, and the timing advisory cannot
change a ceiling, deal ratio, alert, or recommendation eligibility.

The normal worker intentionally does **not** call `price_via_browser()`.
Interactive browser comps are a direct-user-action-only feature for **one
explicit ProductRef**—never a scheduled or bulk monitor operation. Browser
mode requires `--mode browser`, `--user-initiated`, and exactly one
`--product-id`, passes `user_initiated=True` to the packaged client, and accepts
only `interactive-extension` provenance. Its sidecar checkpoint is separate
from the monitor-owned `state.json`; no raw response is inserted into a
collection record or turned into a recommendation.

Inspect the planned scope first:

```bash
python3 scripts/refresh_monitored_markets.py --dry-run
```

Run a small verification batch, with a twelve-second pause between calls:

```bash
python3 scripts/refresh_monitored_markets.py --max-items 5 --force
```

Resume the remaining unique ProductRefs later. The worker's six-day checkpoint interval
(`--market-ttl-hours`) is only a conservative manual refresh throttle; it does not define Market
staleness. The provider's trend/dispersion policy determines whether the returned Market remains
usable, allowing stable products to age longer and volatile products to refresh sooner.
Transient failures persist a bounded `nextRetryAt` backoff;
they are not retried hot and they do not wait a full week:

```bash
python3 scripts/refresh_monitored_markets.py
```

An explicitly requested foreground Analyzer inspection uses a separate resume
state from headless results. Scheduled and bulk monitoring must use headless
REST; the browser path accepts a single ProductRef only:

```bash
python3 scripts/refresh_monitored_markets.py --mode browser --user-initiated \\
  --product-id mtg:dis:dissension:booster:display:en
```

`install_weekly_browser_market_refresh.py` is retained only as a fail-closed
legacy entry point and refuses to create a schedule. A legacy plist may remain
on disk as historical configuration, but the service must not be loaded.

The default checkpoint is
`~/.config/tcg-price-monitor/data/market-refresh-checkpoint.json`, created
atomically with mode `0600`. The script never starts, stops, or changes the
always-on monitor service; future monitor runs continue to own listing lifecycle,
alert eligibility, and email delivery.
