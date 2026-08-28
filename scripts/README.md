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
  TCG Comps monitor on `127.0.0.1:3099` with state under
  `/Users/dkb/.config/tcg-price-monitor/data`.
- `configure_local_price_monitor.mjs` generates internal bearer tokens and adds
  safe local defaults, including the official OpenBoosters sealed catalog, a
  quota-aware eBay Browse budget, and the Heritage feed path/premium rules.
- `update_heritage_feed.mjs` validates a trusted Heritage MyWantlist/session JSON
  export, rejects credential-like fields, canonicalizes lot URLs, applies the exact
  premium or 25%/$49 minimum, and atomically updates the protected monitor feed.
- `sync_local_monitor_from_gist.mjs` builds the complete 686-ProductRef
  subscription from Gist state or a current authenticated Tracker export.
- `install_local_price_monitor_launch_agent.mjs` installs the per-user macOS
  RunAtLoad/KeepAlive service.

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

After the service is healthy, synchronize the newest trustworthy ownership state
from the existing authenticated Gist backend:

```bash
node scripts/sync_local_monitor_from_gist.mjs --dry-run
node scripts/sync_local_monitor_from_gist.mjs
```

The sync reconstructs all 686 canonical ProductRefs locally, sends only ProductRefs
and ownership counts to the loopback monitor, and refuses an all-missing snapshot
when no active Gist keys match the current v2 catalog. It never prints or forwards
the GitHub token.

When an authenticated Tracker is already open but no headless Gist token is
configured, export progress from the dashboard and sync that current file instead:

```bash
node scripts/sync_local_monitor_from_gist.mjs --export /path/to/mtg-binder-progress.json --dry-run
node scripts/sync_local_monitor_from_gist.mjs --export /path/to/mtg-binder-progress.json
```

The export path uses the file modification time as its snapshot evidence timestamp
and still requires current v2 ownership keys to match the full catalog.

Every secret is reported only as `SET` or `EMPTY`. A ready capture configuration
requires eBay application credentials plus long monitor and authority bearer
tokens. The runner starts the canonical local provider authority on loopback by
default. Resend key/from/to values are optional for capture and required for
email delivery. OpenAI is optional: exact TCGplayer identity and Market do not
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
restart-safe authority and monitor against the same durable state. The default
scan interval is 30 minutes. eBay discovery uses shared broad and rotating set-level
Browse queries, refreshes active IDs in batches, and retrieves full item details only
for preliminary exact matches. A persisted daily safety budget and HTTP 429 circuit
breaker protect coverage from request storms. When `EBAY_USER_REFRESH_TOKEN` is set,
the runner also refreshes a short-lived user token and makes one read-only official
My eBay buying-state request per run for bid/watch/max-bid status. A refresh failure
degrades only those account fields; public discovery continues. Verify both loopback
services with:

```bash
curl -sS http://127.0.0.1:3099/healthz
curl -sS http://127.0.0.1:3100/healthz
```

Then configure TCG Comps with `http://127.0.0.1:3099` and the same
`TCG_MONITOR_TOKEN`, Reload TCG Comps and Tracker, and use **Sync monitor**. This
Mac must remain awake and online; moving the same service/state to an always-on
host is a later deployment step.

The service and these helpers never bid, buy, send offers, contact sellers, or
read stored marketplace passwords. Marketplace watch changes remain a separate,
explicitly authorized action.
