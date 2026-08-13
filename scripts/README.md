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

The scripts expect `/Users/dkb/.config/tcg-price-monitor/monitor.env` to be mode
`0600`. They never print secret values. The runner locates the canonical provider
checkout at `/Users/dkb/Apps/Extensions/TcgPriceComparisons` unless
`TCG_PROVIDER_REPO` overrides it.

## Check readiness

```bash
node scripts/run_local_price_monitor.mjs --check
```

Every required key is reported only as `SET` or `EMPTY`. A ready configuration
requires eBay application credentials, Resend key/from/to values, a long monitor
bearer token, and the exact provider-authority URL/token. OpenAI is optional to
the runner and advisory to the monitor; it cannot replace provider identity or
pricing authority.

## Run locally

Double-click `run_local_price_monitor.command`, or run:

```bash
scripts/run_local_price_monitor.command
```

The runner refreshes eBay authorization before expiry by restarting the
restart-safe service against the same durable state. Verify liveness with:

```bash
curl -sS http://127.0.0.1:3099/healthz
```

Then configure TCG Comps with `http://127.0.0.1:3099` and the same
`TCG_MONITOR_TOKEN`, Reload TCG Comps and Tracker, and use **Sync monitor**. This
Mac must remain awake and online; moving the same service/state to an always-on
host is a later deployment step.

The service and these helpers never bid, buy, send offers, contact sellers, or
read stored marketplace passwords. Marketplace watch changes remain a separate,
explicitly authorized action.
