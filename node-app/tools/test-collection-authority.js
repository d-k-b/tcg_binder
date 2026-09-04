#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  AuthorityError, GitHubGistStore, CollectionAuthority, safeErrorBody,
} = require('../lib/collection-authority');
const { CACHE_SCHEMA } = require('../lib/collection-derived-cache');
const { buildSnapshot, EXPECTED_LANES } = require('../lib/collection-snapshot');
const { CollectionAuthorityClient } = require('../lib/collection-authority-client');
const { createHandler } = require('../services/collection-authority/server');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'binder_data.json'), 'utf8'));
const NOW = Date.parse('2026-08-31T12:00:00.000Z');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-collection-authority-')); }

function payload(lane, extra = {}) {
  return {
    checklist: lane, keyVersion: 2, checks: {}, extras: {}, ordered: {}, wrapperArts: {}, orderedWrapperArts: {},
    legacyChecksV1: {}, updatedAt: '2026-08-31T11:30:00.000Z', ...extra,
  };
}

class MemoryStore {
  constructor(records, options = {}) {
    this.records = new Map(records.map((record) => [record.lane, JSON.parse(JSON.stringify(record))]));
    this.credential = options.credential !== false;
    this.retry = { state: 'idle', reasonCode: null, retryAt: null, attempts: 0 };
    this.writes = 0;
  }
  configured() { return this.credential; }
  safeRetryState() { return this.retry; }
  validatePayload(lane, body, { allowLegacyDefaults = false } = {}) {
    if (!body || typeof body !== 'object' || !body.checks || typeof body.checks !== 'object') throw new AuthorityError('GIST_SCHEMA_INVALID', 'invalid', 503, { lane });
    const optional = ['extras', 'ordered', 'wrapperArts', 'orderedWrapperArts', 'legacyChecksV1'];
    const missingDefaults = optional.filter((field) => body[field] === undefined);
    if (!allowLegacyDefaults && missingDefaults.length) throw new AuthorityError('GIST_LEGACY_REPAIR_REQUIRED', 'legacy', 503, { lane });
    return { missingDefaults };
  }
  async readLane(lane, options = {}) {
    const record = this.records.get(lane);
    if (!record) throw new AuthorityError('GIST_ID_MISSING', 'missing', 503, { lane });
    const validation = this.validatePayload(lane, record.payload, options);
    return { ...JSON.parse(JSON.stringify(record)), missingDefaults: validation.missingDefaults };
  }
  async readAll() {
    const result = [];
    const failedLanes = [];
    for (const lane of EXPECTED_LANES) {
      try { result.push(await this.readLane(lane)); } catch { failedLanes.push(lane); }
    }
    if (failedLanes.length) throw new AuthorityError('COLLECTION_SNAPSHOT_INCOMPLETE', 'Complete seven-lane collection snapshot is unavailable', 503, { failedLanes });
    return result;
  }
  async diagnose() {
    const lanes = [];
    for (const lane of EXPECTED_LANES) {
      try {
        const record = await this.readLane(lane, { allowLegacyDefaults: true });
        lanes.push({ lane, state: record.missingDefaults.length ? 'legacy' : 'valid', reasonCodes: record.missingDefaults.map((field) => 'DEFAULT_FIELD_MISSING_' + field.toUpperCase()) });
      } catch (error) { lanes.push({ lane, state: 'missing', reasonCodes: [error.code] }); }
    }
    return { schema: 'tcg.collection-gist-diagnostic/v1', credentialConfigured: this.credential, lanes };
  }
  async writeLane(lane, body, expected, { create = false } = {}) {
    const current = this.records.get(lane);
    if (!current && !create) throw new AuthorityError('GIST_ID_MISSING', 'missing', 503, { lane });
    if (current && expected && current.upstreamRevision !== expected) throw new AuthorityError('COLLECTION_REVISION_CONFLICT', 'conflict', 409, { lane });
    this.validatePayload(lane, body);
    const revision = 'upstream-' + (++this.writes);
    const record = { lane, payload: JSON.parse(JSON.stringify(body)), stateRevision: revision, upstreamRevision: revision };
    this.records.set(lane, record);
    return JSON.parse(JSON.stringify(record));
  }
}

function completeRecords() {
  return EXPECTED_LANES.map((lane, index) => ({ lane, payload: payload(lane), stateRevision: 'state-' + index, upstreamRevision: 'upstream-' + index }));
}

async function expectCode(promise, code) {
  let failure = null;
  try { await promise; } catch (error) { failure = error; }
  assert(failure, 'expected failure ' + code);
  assert.strictEqual(failure.code, code);
  return failure;
}

async function testSnapshotAndAtomicFailure() {
  const records = completeRecords();
  const first = buildSnapshot(catalog, records, { generatedAt: '2026-08-31T12:00:00.000Z', nowMs: NOW });
  const second = buildSnapshot(catalog, records, { generatedAt: '2026-08-31T12:01:00.000Z', nowMs: NOW + 60_000 });
  assert.strictEqual(Object.keys(first.snapshot.products).length, 688);
  assert.deepStrictEqual(Object.keys(first.snapshot.lanes), EXPECTED_LANES);
  assert.strictEqual(first.revision, second.revision, 'revision must be stable across observation time');
  assert.strictEqual(first.authority.consumerStatus, 'AUTHORITATIVE');
  assert.strictEqual(first.authority.oldestContentUpdatedAt, '2026-08-31T11:30:00.000Z');
  assert.strictEqual(first.snapshot.wrapperArt.affectsRequiredProgress, false);
  const box = Object.values(first.snapshot.products).find((row) => row.product.unit === 'display');
  const pack = Object.values(first.snapshot.products).find((row) => row.lane === 'packs' && row.product.unit === 'pack');
  assert(box && pack && box.product.productId !== pack.product.productId);

  const freshlyVerifiedOldContent = records.map((record) => ({
    ...record,
    payload: { ...record.payload, updatedAt: '2026-07-01T00:00:00.000Z' },
    verifiedAt: '2026-08-31T12:00:00.000Z',
    verificationMethod: 'authenticated-github-gist-read',
  }));
  const verified = buildSnapshot(catalog, freshlyVerifiedOldContent, { generatedAt: '2026-08-31T12:00:00.000Z', nowMs: NOW });
  assert.strictEqual(verified.authority.consumerStatus, 'AUTHORITATIVE', 'fresh authenticated reads, not old content edit times, establish source freshness');
  assert.strictEqual(verified.authority.oldestVerifiedAt, '2026-08-31T12:00:00.000Z');
  assert.strictEqual(verified.authority.oldestContentUpdatedAt, '2026-07-01T00:00:00.000Z');
  assert(verified.snapshot.source.lanes.every((lane) => lane.verificationMethod === 'authenticated-github-gist-read'));
  const reverified = buildSnapshot(catalog, freshlyVerifiedOldContent.map((record) => ({ ...record, verifiedAt: '2026-08-31T12:01:00.000Z' })),
    { generatedAt: '2026-08-31T12:01:00.000Z', nowMs: NOW + 60_000 });
  assert.strictEqual(reverified.revision, verified.revision, 're-reading unchanged content must not churn the collection revision');

  const missing = new MemoryStore(records.filter((record) => record.lane !== 'lorcana_coll'));
  const authority = new CollectionAuthority({ store: missing, catalog, dataDir: tempDir(), now: () => NOW });
  const failure = await expectCode(authority.snapshot(), 'COLLECTION_SNAPSHOT_INCOMPLETE');
  assert.deepStrictEqual(failure.details.failedLanes, ['lorcana_coll']);
  assert.strictEqual(safeErrorBody(failure).error.consumerStatus, 'CONDITIONAL');
  assert.strictEqual(safeErrorBody(failure).error.retryable, false, 'incomplete snapshots must not be retried');
}

async function testDerivedCacheAndSafeFallback() {
  const dataDir = tempDir();
  const store = new MemoryStore(completeRecords());
  const authority = new CollectionAuthority({ store, catalog, dataDir, now: () => NOW });
  const fresh = await authority.snapshot();
  assert.strictEqual(fresh.cache.mode, 'snapshot-refresh');
  assert.strictEqual(fresh.cache.eligibleForMutation, true);
  const cachePath = path.join(dataDir, 'collection-authority-derived-cache.json');
  const persisted = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  assert.strictEqual(persisted.schema, CACHE_SCHEMA);
  assert.strictEqual(persisted.snapshot.revision, fresh.revision);
  assert.strictEqual(fs.statSync(cachePath).mode & 0o777, 0o600);
  assert(!JSON.stringify(persisted).includes('token') && !JSON.stringify(persisted).includes('gist.github'));

  store.readAll = async () => { throw new AuthorityError('GIST_TRANSIENT_FAILURE', 'temporary', 503, { retryable: true }); };
  const fallback = await authority.snapshot();
  assert.strictEqual(fallback.revision, fresh.revision);
  assert.strictEqual(Object.keys(fallback.snapshot.products).length, 688);
  assert.strictEqual(fallback.authority.consumerStatus, 'CONDITIONAL');
  assert(fallback.authority.degradedReasonCodes.includes('COLLECTION_SNAPSHOT_CACHE_FALLBACK'));
  assert.strictEqual(fallback.cache.mode, 'complete-snapshot-fallback');
  assert.strictEqual(fallback.cache.eligibleForMutation, false);
  await expectCode(authority.snapshot({ allowFallback: false }), 'GIST_TRANSIENT_FAILURE');

  store.readAll = async () => { throw new AuthorityError('COLLECTION_SNAPSHOT_INCOMPLETE', 'incomplete', 503, { retryable: false }); };
  await expectCode(authority.snapshot(), 'COLLECTION_SNAPSHOT_INCOMPLETE');
}

async function testReadinessCache() {
  const store = new MemoryStore(completeRecords());
  let diagnoses = 0;
  const diagnose = store.diagnose.bind(store);
  store.diagnose = async () => { diagnoses += 1; return diagnose(); };
  let pricingReadiness = 0;
  const pricingClient = { readiness: async () => { pricingReadiness += 1; return { ready: true }; } };
  const authority = new CollectionAuthority({ store, catalog, dataDir: tempDir(), now: () => NOW, pricingClient });
  const first = await authority.readiness();
  const second = await authority.readiness();
  assert.strictEqual(first.cache.mode, 'readiness-refresh');
  assert.strictEqual(second.cache.mode, 'readiness-hit');
  assert.strictEqual(diagnoses, 1);
  assert.strictEqual(pricingReadiness, 1);
}

async function testLegacyRepair() {
  const records = completeRecords();
  const legacy = records.find((record) => record.lane === 'lorcana_pre');
  delete legacy.payload.extras;
  legacy.payload.futureField = { preserve: true };
  legacy.payload.recoveryV0 = { old: 'value' };
  const store = new MemoryStore(records);
  const authority = new CollectionAuthority({ store, catalog, dataDir: tempDir(), now: () => NOW });
  const dryRun = await authority.repair({ apply: false });
  assert.deepStrictEqual(dryRun.lanes.find((lane) => lane.lane === 'lorcana_pre').reasonCodes, ['DEFAULT_FIELD_MISSING_EXTRAS']);
  assert.strictEqual(store.writes, 0, 'dry run must not mutate');
  const applied = await authority.repair({ apply: true });
  assert.deepStrictEqual(applied.changed, ['lorcana_pre']);
  const repaired = (await store.readLane('lorcana_pre')).payload;
  assert.deepStrictEqual(repaired.extras, {});
  assert.deepStrictEqual(repaired.futureField, { preserve: true });
  assert.deepStrictEqual(repaired.recoveryV0, { old: 'value' });

  store.records.delete('lorcana_coll');
  await expectCode(authority.repair({ apply: true }), 'REPAIR_SOURCE_REQUIRED');
  assert(!store.records.has('lorcana_coll'), 'missing lane must not be manufactured as empty');
  const source = payload('lorcana_coll', { checks: { 'lorcana_coll|v2|verified': true }, verifiedExport: { source: 'user-export' } });
  const created = await authority.repair({ apply: true, sourcePayloads: { lorcana_coll: source } });
  assert(created.changed.includes('lorcana_coll'));
  assert.strictEqual((await store.readLane('lorcana_coll')).payload.checks['lorcana_coll|v2|verified'], true);
}

async function testReceipts() {
  const store = new MemoryStore(completeRecords());
  const authority = new CollectionAuthority({ store, catalog, dataDir: tempDir(), now: () => NOW });
  const before = await authority.snapshot();
  const prerelease = catalog.checklists.find((lane) => lane.id === 'prerelease').eras.flatMap((era) => era.items)
    .flatMap((item) => item.pricingProducts || []).find((product) => Number.isInteger(product.slotOrdinal));
  const operation = {
    schema: 'tcg.collection-receipt-operation/v1', idempotencyKey: 'receipt:test:0001',
    expectedSnapshotRevision: before.revision, product: prerelease.ref, quantity: 1,
    deliveredAt: '2026-08-31T11:00:00.000Z', evidence: { type: 'provider-message', referenceId: 'gmail:abc-123' },
  };
  const first = await authority.receiptOperation(operation);
  assert.strictEqual(first.applied, true);
  assert.strictEqual(first.idempotentReplay, false);
  assert.strictEqual(first.snapshot.snapshot.products[prerelease.ref.productId].owned, 1);
  const writes = store.writes;
  const replay = await authority.receiptOperation(operation);
  assert.strictEqual(replay.idempotentReplay, true);
  assert.strictEqual(store.writes, writes, 'idempotent replay must not write');
  await expectCode(authority.receiptOperation({ ...operation, quantity: 2 }), 'RECEIPT_IDEMPOTENCY_CONFLICT');
  await expectCode(authority.receiptOperation({ ...operation, idempotencyKey: 'receipt:test:0002' }), 'COLLECTION_REVISION_CONFLICT');
  await expectCode(authority.receiptOperation({ ...operation, idempotencyKey: 'receipt:test:0003', expectedSnapshotRevision: first.snapshot.revision,
    product: { ...operation.product, variant: 'ambiguous-change' } }), 'PRODUCTREF_EXACT_IDENTITY_REQUIRED');
  await expectCode(authority.receiptOperation({ ...operation, idempotencyKey: 'receipt:test:0004', expectedSnapshotRevision: first.snapshot.revision,
    quantity: 0 }), 'RECEIPT_QUANTITY_INVALID');
}

async function testPricingAndMonitorDelegation() {
  const calls = { pricing: [], monitor: [] };
  const pricingClient = {
    readiness: async () => ({ schema: 'tcg.pricing-rest-readiness/v1', ready: true }),
    priceProduct: async (product, options, requestId) => {
      calls.pricing.push({ product, options, requestId });
      return { apiVersion: 1, schema: 'tcg.valuation/v1', requestId, product, market: null,
        cache: { mode: 'market-cache', evidenceCache: { reused: true } } };
    },
  };
  const monitorClient = { syncCollection: async (subscription) => {
    calls.monitor.push(subscription);
    return { apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true,
      revision: subscription.revision, productCount: Object.keys(subscription.collection.products).length,
      activeTargetCount: subscription.preferences.enabled ? 399 : 0 };
  } };
  const pricingContracts = require('/Users/dkb/Apps/Extensions/TcgPriceComparisons/shared/pricing-contracts.js');
  const authority = new CollectionAuthority({ store: new MemoryStore(completeRecords()), catalog, dataDir: tempDir(), now: () => NOW,
    pricingClient, monitorClient, pricingContracts });
  const product = catalog.checklists[0].eras[0].items[0].pricingProducts[0].ref;
  const priced = await authority.priceProduct({ schema: 'tcg.collection-pricing-request/v1', requestId: 'pricing:test:0001', product,
    options: { includeActive: true, includeRecentSales: true } });
  assert.strictEqual(priced.product.productId, product.productId);
  assert.deepStrictEqual(priced.cache, { mode: 'market-cache', evidenceCache: { reused: true } }, 'Pricing Analyzer cache provenance must pass through unchanged');
  assert.strictEqual(calls.pricing.length, 1);
  await expectCode(authority.priceProduct({ schema: 'tcg.collection-pricing-request/v1', product: { ...product, variant: 'wrong' } }), 'PRICING_PRODUCTREF_INVALID');
  pricingClient.priceProduct = async () => {
    const error = new Error('Bearer super-secret-provider-token');
    error.code = 'NO_VERIFIED_PRICE';
    error.jobId = 'browser-12345678-1234-1234-1234-123456789abc';
    error.body = { error: { code: error.code, message: 'raw provider text' }, Authorization: 'Bearer super-secret-provider-token' };
    throw error;
  };
  let safePricingFailure;
  try {
    await authority.priceProduct({ schema: 'tcg.collection-pricing-request/v1', requestId: 'pricing:test:error', product });
    assert.fail('pricing failure should remain fail-closed');
  } catch (error) {
    safePricingFailure = safeErrorBody(error);
  }
  assert.strictEqual(safePricingFailure.error.code, 'PRICING_DEPENDENCY_UNAVAILABLE');
  assert.strictEqual(safePricingFailure.error.providerErrorCode, 'NO_VERIFIED_PRICE');
  assert.strictEqual(safePricingFailure.error.jobId, 'browser-12345678-1234-1234-1234-123456789abc');
  assert.ok(!JSON.stringify(safePricingFailure).includes('super-secret-provider-token'));
  assert.ok(!JSON.stringify(safePricingFailure).includes('raw provider text'));
  assert.ok(!Object.hasOwn(safePricingFailure.error, 'body'));
  pricingClient.priceProduct = async () => {
    const error = new Error('unsafe details');
    error.code = 'UNREVIEWED_PROVIDER_CODE';
    error.jobId = '../../not-a-job';
    throw error;
  };
  try {
    await authority.priceProduct({ schema: 'tcg.collection-pricing-request/v1', requestId: 'pricing:test:unsafe', product });
    assert.fail('unsafe pricing failure should remain fail-closed');
  } catch (error) {
    const rejected = safeErrorBody(error);
    assert.ok(!Object.hasOwn(rejected.error, 'providerErrorCode'));
    assert.ok(!Object.hasOwn(rejected.error, 'jobId'));
  }
  const sync = await authority.monitorSync({ schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true, sources: ['ebay'] } });
  assert.strictEqual(sync.accepted, true);
  assert.strictEqual(calls.monitor.length, 1);
  assert.strictEqual(Object.keys(calls.monitor[0].collection.products).length, 688);
  assert.match(calls.monitor[0].revision, /^sha256:[0-9a-f]{64}$/);
  assert.strictEqual(calls.monitor[0].preferences.sources[0], 'ebay');
  assert.strictEqual(sync.authorityCache.mode, 'monitor-subscription-refresh');
  const syncAgain = await authority.monitorSync({ schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true, sources: ['ebay'] } });
  assert.strictEqual(syncAgain.authorityCache.mode, 'monitor-subscription-hit');
  assert.strictEqual(calls.monitor.length, 2, 'cached derived subscription must still be synchronized with the monitor');

  const conditionalCalls = [];
  const conditionalMonitor = { syncCollection: async (subscription) => {
    conditionalCalls.push(subscription);
    return { apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true,
      revision: subscription.revision, productCount: Object.keys(subscription.collection.products).length,
      activeTargetCount: subscription.preferences.enabled ? 399 : 0 };
  } };
  const conditionalAuthority = new CollectionAuthority({ store: new MemoryStore(completeRecords()), catalog, dataDir: tempDir(),
    now: () => NOW, maxAgeMs: 1, monitorClient: conditionalMonitor, pricingContracts });
  const conditionalSync = await conditionalAuthority.monitorSync({
    schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true, sources: ['ebay'] }
  });
  assert.strictEqual(conditionalCalls.length, 1);
  assert.strictEqual(Object.keys(conditionalCalls[0].collection.products).length, 688,
    'a complete conditional snapshot must replace an obsolete partial subscription');
  assert.strictEqual(conditionalCalls[0].ownershipPolicy.consumerStatus, 'CONDITIONAL');
  assert.strictEqual(conditionalCalls[0].ownershipPolicy.reviewOnly, true);
  assert.strictEqual(conditionalCalls[0].ownershipPolicy.mayInferOwnership, false);
  assert.strictEqual(conditionalCalls[0].ownershipPolicy.eligibleForAction, false);
  assert.strictEqual(conditionalCalls[0].preferences.enabled, false,
    'conditional ownership must fail closed even for a legacy monitor that drops ownershipPolicy');
  assert.strictEqual(conditionalSync.requestedMonitorEnabled, true);
  assert.strictEqual(conditionalSync.effectiveMonitorEnabled, false);
  assert.strictEqual(conditionalSync.activeTargetCount, 0);

  const unsafeConditionalMonitor = { syncCollection: async (subscription) => ({
    accepted: true, revision: subscription.revision, productCount: 688, activeTargetCount: 1
  }) };
  const unsafeConditionalAuthority = new CollectionAuthority({ store: new MemoryStore(completeRecords()), catalog, dataDir: tempDir(),
    now: () => NOW, maxAgeMs: 1, monitorClient: unsafeConditionalMonitor, pricingContracts });
  await expectCode(unsafeConditionalAuthority.monitorSync({
    schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true, sources: ['ebay'] }
  }), 'MONITOR_POLICY_NOT_ENFORCED');
  const ready = await authority.readiness();
  assert.deepStrictEqual(ready.dependencies, { pricing: { configured: true, ready: true, reasonCode: null }, monitor: { configured: true } });
}

function fakeResponse(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status,
    headers: { get: (name) => headers[name.toLowerCase()] || null }, json: async () => body, text: async () => String(body) };
}

async function testRetriesAndMalformedGist() {
  const retryDir = tempDir();
  const sleeps = [];
  let calls = 0;
  const retryStore = new GitHubGistStore({ token: 'not-a-real-token', catalog, dataDir: retryDir,
    sleep: async (ms) => sleeps.push(ms), now: () => NOW,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return fakeResponse(429, {}, { 'retry-after': '2' });
      if (calls === 2) return fakeResponse(503, {});
      return fakeResponse(200, { ok: true });
    } });
  assert.strictEqual((await retryStore.request('/fixture', {}, { attempts: 3, baseDelayMs: 10 })).status, 200);
  assert.deepStrictEqual(sleeps, [2000, 20], 'Retry-After and bounded exponential delay must be honored');
  assert.strictEqual(retryStore.safeRetryState().state, 'idle');

  let transportCalls = 0;
  const transportStore = new GitHubGistStore({ token: 'not-a-real-token', catalog, dataDir: tempDir(), sleep: async () => {},
    fetchImpl: async () => { transportCalls += 1; if (transportCalls < 3) throw new Error('secret token must not escape'); return fakeResponse(200, {}); } });
  await transportStore.request('/fixture', {}, { attempts: 3, baseDelayMs: 0 });
  assert.strictEqual(transportCalls, 3);

  const malformedStore = new GitHubGistStore({ token: 'not-a-real-token', catalog, dataDir: tempDir(), sleep: async () => {},
    fetchImpl: async (url) => {
      if (String(url).includes('?per_page')) return fakeResponse(200, [{ id: 'private-id', files: { 'mtg-binder-collector.json': {} } }]);
      return fakeResponse(200, { files: { 'mtg-binder-collector.json': { truncated: true } } });
    } });
  await expectCode(malformedStore.readLane('collector'), 'GIST_TRUNCATED_WITHOUT_SOURCE');
}

async function testHttpAuthAndRedaction() {
  const authority = new CollectionAuthority({ store: new MemoryStore(completeRecords()), catalog, dataDir: tempDir(), now: () => NOW });
  const handler = createHandler({ authority, accessToken: 'authority-test-token', adminToken: '' });
  const invoke = (method, url, authorization = '') => new Promise((resolve, reject) => {
    const req = { method, url, headers: authorization ? { authorization } : {} };
    const response = { status: null, headers: null, body: '',
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(bytes) { this.body = Buffer.from(bytes || '').toString('utf8'); resolve(this); } };
    Promise.resolve(handler(req, response)).catch(reject);
  });
  const healthResponse = await invoke('GET', '/healthz');
  const health = JSON.parse(healthResponse.body);
  assert.deepStrictEqual(Object.keys(health).sort(), ['ok', 'schema', 'version']);
  const rejectedResponse = await invoke('GET', '/v1/readiness', 'Bearer wrong-secret');
  assert.strictEqual(rejectedResponse.status, 401);
  assert(!rejectedResponse.body.includes('wrong-secret') && !rejectedResponse.body.includes('authority-test-token'));
  const readyResponse = await invoke('GET', '/v1/readiness', 'Bearer authority-test-token');
  assert.strictEqual(readyResponse.status, 200);
  assert(!/gist\.github|https:\/\/api\.github|private-id|mtg-binder-/.test(readyResponse.body));
}

async function testNodeClientContract() {
  const snapshot = buildSnapshot(catalog, completeRecords(), { generatedAt: '2026-08-31T12:00:00.000Z', nowMs: NOW });
  let calls = 0;
  const sleeps = [];
  const client = new CollectionAuthorityClient({ token: 'client-token', attempts: 2, baseDelayMs: 0, sleep: async (ms) => sleeps.push(ms),
    fetchImpl: async (_url, options) => {
      calls += 1;
      assert.strictEqual(options.headers.Authorization, 'Bearer client-token');
      if (calls === 1) return fakeResponse(503, { error: { code: 'UPSTREAM_TRANSIENT', message: 'temporary' } }, { 'retry-after': '0' });
      return fakeResponse(200, snapshot);
    } });
  const response = await client.snapshot();
  assert.strictEqual(response.revision, snapshot.revision);
  assert.strictEqual(calls, 2);
  assert.deepStrictEqual(sleeps, [0]);

  const incomplete = new CollectionAuthorityClient({ token: 'client-token', attempts: 1,
    fetchImpl: async () => fakeResponse(200, { ...snapshot, snapshot: { ...snapshot.snapshot, products: {} } }) });
  await expectCode(incomplete.snapshot(), 'SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID');

  let nonRetryCalls = 0;
  const nonRetry = new CollectionAuthorityClient({ token: 'client-token', attempts: 3, baseDelayMs: 0,
    fetchImpl: async () => { nonRetryCalls += 1; return fakeResponse(503, { error: {
      code: 'COLLECTION_SNAPSHOT_INCOMPLETE', message: 'incomplete', retryable: false,
    } }); } });
  await expectCode(nonRetry.snapshot(), 'COLLECTION_SNAPSHOT_INCOMPLETE');
  assert.strictEqual(nonRetryCalls, 1, 'typed incomplete failure must not retry');

  const monitorCalls = [];
  const monitorClient = new CollectionAuthorityClient({ token: 'client-token', attempts: 1,
    fetchImpl: async (url, options) => {
      monitorCalls.push({ url, options });
      return fakeResponse(200, {
        accepted: true, revision: 'sha256:' + 'b'.repeat(64), productCount: 688, activeTargetCount: 0,
        ownershipPolicy: { schema: 'tcg.collection-ownership-policy/v1', consumerStatus: 'CONDITIONAL', eligibleForAction: false },
        requestedMonitorEnabled: true, effectiveMonitorEnabled: false,
      });
    } });
  const monitorReply = await monitorClient.syncMonitor({ enabled: true, sources: ['ebay'] });
  assert.strictEqual(monitorReply.activeTargetCount, 0);
  assert(monitorCalls[0].url.endsWith('/v1/monitor/sync'));
  assert.deepStrictEqual(JSON.parse(monitorCalls[0].options.body), {
    schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true, sources: ['ebay'] },
  });

  const unsafeMonitorClient = new CollectionAuthorityClient({ token: 'client-token', attempts: 1,
    fetchImpl: async () => fakeResponse(200, {
      accepted: true, revision: 'sha256:' + 'c'.repeat(64), productCount: 688, activeTargetCount: 1,
      ownershipPolicy: { schema: 'tcg.collection-ownership-policy/v1', consumerStatus: 'CONDITIONAL', eligibleForAction: false },
      requestedMonitorEnabled: true, effectiveMonitorEnabled: false,
    }) });
  await expectCode(unsafeMonitorClient.syncMonitor({ enabled: true }), 'MONITOR_POLICY_NOT_ENFORCED');
}

(async () => {
  await testSnapshotAndAtomicFailure();
  await testDerivedCacheAndSafeFallback();
  await testReadinessCache();
  await testLegacyRepair();
  await testReceipts();
  await testPricingAndMonitorDelegation();
  await testRetriesAndMalformedGist();
  await testHttpAuthAndRedaction();
  await testNodeClientContract();
  console.log('Collection authority tests passed (7 lanes / 688 ProductRefs)');
})().catch((error) => { console.error(error); process.exit(1); });
