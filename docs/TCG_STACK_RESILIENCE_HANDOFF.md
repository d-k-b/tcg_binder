# TCG Stack Resilience Contract

**Status:** durable implementation and operations handoff — updated 2026-09-10

## Purpose

The Collection Tracker, Collection Authority, TCG Comps, marketplace monitor, browser agent,
and Gmail delivery bridge must recover from partial failures without converting incomplete or
old evidence into current ownership, Market, availability, or action advice.

This file records stable contracts and completion gates. It deliberately does not record mutable
candidate counts, source ages, browser-session state, live service readiness, or provider release
numbers as current facts. Read those values from the live, timestamped health surfaces.

## Committed repository baseline

- Dashboard/catalog and browser recovery: `884db67`
- Collection Authority 689-product parity: `900f7a37`
- Monitor browser-evidence and HiBid ingestion: `0ebdbc4`
- Canonical catalog: seven lanes and 689 ProductRefs

These commits and the offline suite prove repository behavior only. They do not prove that a
LaunchAgent is running, a marketplace feed is fresh, an account session is authenticated, a public
endpoint is reachable, or an email was delivered.

## Non-negotiable rules

- Collection Authority is the only ownership authority. A partial, malformed, or stale seven-lane
  response is conditional and never becomes an all-missing snapshot.
- TCG Comps is the only pricing and exact-listing authority. Catalog references, listing asks, and
  stale fallbacks never establish Market or a ceiling.
- Every listing and sale is keyed by stable source identity. Unchanged evidence must be served from
  cache and must not repeat detail, resolver, pricing, or AI work.
- Active auction-like rows require an exact end time. Recheck only while active or materially
  changed; once ended, preserve the final result as immutable historical sale evidence.
- Historical sales are retained indefinitely. Dense history may compact older raw rows into exact
  quarterly count, median, mean, standard deviation, and preserved stable identities.
- Market freshness is adaptive to observed trend and dispersion. Stable products may reuse analysis
  longer; volatile products refresh sooner. A fixed age alone must not relabel valid stable evidence
  as stale.
- Source failures are isolated. A failure on eBay, Heritage, Facebook, or any store cannot erase
  retained evidence or stop unrelated sources.
- No monitor path may bid, buy, send an offer, contact a seller, or expose credentials.

## Collection and Gist boundary

The authenticated Collection Authority provides complete snapshot/readiness and idempotent receipt
operations. Monitor sync goes through Authority; helpers do not post reconstructed Gist state
directly to Pricing Analyzer.

The legacy Node Gist adapter retains `readStrict()` only as a fail-closed compatibility path. It:

- reads every expected checklist;
- retries only transport failures and HTTP 408/425/429/5xx with bounded backoff;
- honors bounded `Retry-After`;
- rejects missing, malformed, truncated-without-recovery, or undated lanes atomically; and
- never silently drops a checklist.

Current completeness tests require exactly 689 ProductRefs across all seven lanes.

## Source cadence and cache behavior

The review layer wakes every two hours. The collector may maintain source-specific internal
schedules, but each source call must first consult its durable cursor, rate budget, listing identity,
evidence fingerprint, and next-due time.

| Source | Required behavior |
|---|---|
| eBay | Use API-first shared discovery, persisted quota and `Retry-After`, batched active-ID refresh, and detail calls only for new/changed preliminary exact matches. |
| TCGplayer | Diff stable live seller/listing IDs; re-evaluate only new, returned, repriced, changed, or due rows. |
| Heritage and auction houses | Refresh current catalog evidence and ending-soon tracked lots; keep archive sweeps bounded and separate from active lots. Unknown premium, shipping, or end time remains review-only. |
| Stores | Cache stable SKU/URL and inventory fingerprint; revisit sold-out/restock rows only when due or changed. |
| Facebook Marketplace/groups | Browser-assisted only. Cache stable post ID/URL plus evidence fingerprint before detail or AI work. Inspect only new or materially edited posts. |
| Craigslist and Temu | Browser-assisted and fail-closed. Stable identity, seller/source evidence, exact product, and landed cost are mandatory before action status. |
| Browser Analyzer | Explicit single-product user action only. Require `tcg.browser-comp-evidence/v1`, `interactive-extension`, exact ProductRef, and a UUID-shaped job ID. |

## Recommendation and delivery policy

- Missing required target: routine recommendation up to 100% of verified exact Market landed.
- Urgent missing-target email: complete after-tax landed cost at or below 90% of Market.
- Facebook rapid negotiation: exact new/changed required target, credible direct negotiation,
  85% opening target, and 90% complete-cost ceiling.
- Collector Booster rip/gift: at or below 70% landed.
- High-value vintage/full Collector pack: at or below 75% pre-tax landed.
- Other discretionary auction: at or below 70% pre-tax landed.
- Sub-$50 loose booster-pack noise is suppressed during the current inventory review.

Routine cumulative Gmail digests are limited to 06:00 and 18:00 America/Chicago. Other two-hour
wakes send only a newly urgent, deduplicated event. Delivery requires a multipart message with
non-empty text and HTML bodies, read-back verification, and a persisted slot/event idempotency key.
A failed send is retried and reported; capture-only state is never described as delivered.

## Live verification checklist

Before declaring the stack healthy, verify all of the following with current timestamps:

1. Authority returns an authoritative seven-lane, 689-product snapshot.
2. Monitor acknowledges the same revision and product count without an older run overwriting it.
3. Pricing readiness distinguishes sale-derived Market, catalog-only reference, and pending/stale.
4. Every enabled source reports fresh, verified-empty, stale, unavailable, or rate-limited state.
5. Browser-agent readiness and a one-product probe pass before browser-derived pricing is claimed.
6. Active auctions have stable IDs, current price, exact end time, and bounded required costs.
7. Gmail send and read-back prove both MIME alternatives and every cumulative active row.
8. Focused tests, the full offline suite, and `git diff --check` pass.

Any failed item degrades only its affected lane and suppresses only the recommendation classes that
depend on it. It must never be papered over with a catalog estimate, old feed, guessed fee, or prior
email.
