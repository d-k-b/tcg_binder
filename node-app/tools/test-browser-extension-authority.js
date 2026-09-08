'use strict';

const assert = require('assert');
const path = require('path');

const authorityApi = require(path.resolve(__dirname, '..', '..', 'browser-extension', 'collection-authority-client.js'));
const HASH = 'a'.repeat(64);
const VERIFIED_MONITOR_REVISION = 'sha256:6f8b585b06de4a8e2606cd9500abea1da43a2fb8170e7347efc6489eaed36394';
const VERIFIED_SNAPSHOT_REVISION = 'd6c29e907232dc2e595b0432d249383d9f0b66531d7232d8203ea9eefed5bc32';
const authority = { state: 'fresh', consumerStatus: 'AUTHORITATIVE', degradedReasonCodes: [] };
const freshCache = {
  schema: 'tcg.collection-derived-cache-status/v1', mode: 'snapshot-refresh',
  savedAt: '2026-09-03T12:00:00.000Z', ageMs: 0, revision: HASH, eligibleForMutation: true
};
const snapshotBody = {
  schema: 'tcg.collection-snapshot-response/v1', generatedAt: '2026-09-03T12:00:00.000Z', revision: HASH,
  authority: { ...authority, unexpected: 'discard me' }, cache: { ...freshCache, unexpected: 'discard me' },
  snapshot: { schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker', products: {},
    authority: { state: 'stale', consumerStatus: 'CONDITIONAL', degradedReasonCodes: ['OLD_INNER_VALUE'] } }
};

const attached = authorityApi.attachSnapshotProvenance(snapshotBody);
assert.deepStrictEqual(attached.authority, authority, 'safe outer Authority status must replace stale inner metadata');
assert.deepStrictEqual(attached.cache, freshCache, 'safe outer cache provenance must stay attached to the returned snapshot');
assert.strictEqual(attached.authority.unexpected, undefined);
assert.strictEqual(attached.cache.unexpected, undefined);
assert.deepStrictEqual(authorityApi.snapshotPolicy(attached, { requireAuthority: true }), {
  authority, cache: freshCache, reviewOnly: false, mayInferOwnership: true, eligibleForMutation: true
});

const fallback = authorityApi.attachSnapshotProvenance({
  ...snapshotBody,
  authority: { state: 'stale', consumerStatus: 'CONDITIONAL', degradedReasonCodes: ['COLLECTION_SNAPSHOT_CACHE_FALLBACK'] },
  cache: { ...freshCache, mode: 'complete-snapshot-fallback', ageMs: 3600000, eligibleForMutation: false }
});
const fallbackPolicy = authorityApi.snapshotPolicy(fallback, { requireAuthority: true });
assert.strictEqual(fallbackPolicy.reviewOnly, true);
assert.strictEqual(fallbackPolicy.mayInferOwnership, false);
assert.strictEqual(fallbackPolicy.eligibleForMutation, false);
const incompleteFreshPolicy = authorityApi.snapshotPolicy({
  schema: 'tcg.collection-snapshot/v2',
  authority,
  cache: { ...freshCache, eligibleForMutation: undefined }
}, { requireAuthority: true });
assert.strictEqual(incompleteFreshPolicy.reviewOnly, true);
assert.strictEqual(incompleteFreshPolicy.mayInferOwnership, false);
assert.strictEqual(incompleteFreshPolicy.eligibleForMutation, false);
assert.throws(() => authorityApi.snapshotPolicy({ schema: 'tcg.collection-snapshot/v2' }, { requireAuthority: true }),
  error => error.code === 'COLLECTION_AUTHORITY_PROVENANCE_INVALID');
assert.throws(() => authorityApi.attachSnapshotProvenance({ ...snapshotBody, cache: { ...freshCache, mode: 'invented-cache-mode' } }),
  error => error.code === 'COLLECTION_AUTHORITY_CACHE_INVALID');

const monitorCache = {
  schema: 'tcg.collection-derived-cache-status/v1', mode: 'monitor-subscription-refresh',
  savedAt: '2026-09-03T12:00:00.000Z', ageMs: 0, key: HASH, eligibleForMutation: false
};
const conditionalOwnershipPolicy = {
  schema: 'tcg.collection-ownership-policy/v1', snapshotRevision: VERIFIED_SNAPSHOT_REVISION, consumerStatus: 'CONDITIONAL',
  reviewOnly: true, mayInferOwnership: false, eligibleForAction: false,
  degradedReasonCodes: ['OLDEST_SOURCE_STALE'], verifiedAt: '2026-09-03T12:00:00.000Z',
  oldestSourceAt: '2026-07-19T16:47:29.183Z'
};
const conditionalMonitorResponse = {
  apiVersion: 1, engineVersion: '2.43.69', schema: 'tcg.collection-monitor-sync-result/v1', accepted: true,
  revision: VERIFIED_MONITOR_REVISION, productCount: 689, activeTargetCount: 0,
  requestedMonitorEnabled: true, effectiveMonitorEnabled: false,
  ownershipPolicy: conditionalOwnershipPolicy, authorityCache: monitorCache
};
const conditionalValidation = authorityApi.validateMonitorSyncResponse(conditionalMonitorResponse, { productCount: 689 });
assert.strictEqual(conditionalValidation.conditional, true);
assert.strictEqual(authorityApi.validateMonitorSyncResponse(conditionalMonitorResponse).conditional, true,
  'the Authority client default must require the complete 689-product catalog');
assert.throws(() => authorityApi.validateMonitorSyncResponse({ ...conditionalMonitorResponse, productCount: 688 }),
  error => error.code === 'INVALID_MONITOR_RESPONSE',
  'the Authority client default must reject the superseded 688-product catalog');
assert.strictEqual(conditionalValidation.response.revision, VERIFIED_MONITOR_REVISION);
assert.strictEqual(conditionalValidation.ownershipPolicy.snapshotRevision, VERIFIED_SNAPSHOT_REVISION);
assert.deepStrictEqual(conditionalValidation.ownershipPolicy, conditionalOwnershipPolicy,
  'conditional ownership policy must remain available for the wrapper status decision');
for (const unsafe of [
  { ownershipPolicy: { ...conditionalOwnershipPolicy, reviewOnly: false } },
  { ownershipPolicy: { ...conditionalOwnershipPolicy, mayInferOwnership: true } },
  { ownershipPolicy: { ...conditionalOwnershipPolicy, eligibleForAction: true } },
  { effectiveMonitorEnabled: true },
  { activeTargetCount: 1 },
  { productCount: 688 }
]) {
  assert.throws(() => authorityApi.validateMonitorSyncResponse({ ...conditionalMonitorResponse, ...unsafe }, { productCount: 689 }),
    error => ['MONITOR_POLICY_NOT_ENFORCED', 'INVALID_MONITOR_RESPONSE'].includes(error.code),
    'conditional monitor response must fail closed when any safety invariant changes');
}
const authoritativeOwnershipPolicy = {
  ...conditionalOwnershipPolicy, consumerStatus: 'AUTHORITATIVE', reviewOnly: false,
  mayInferOwnership: true, eligibleForAction: true, degradedReasonCodes: []
};
assert.strictEqual(authorityApi.validateMonitorSyncResponse({
  ...conditionalMonitorResponse, activeTargetCount: 12, effectiveMonitorEnabled: true,
  ownershipPolicy: authoritativeOwnershipPolicy
}, { productCount: 689 }).conditional, false, 'authoritative monitor behavior must remain enabled');
assert.strictEqual(authorityApi.validateMonitorSyncResponse({
  apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true,
  revision: 'sha256:' + HASH, productCount: 689, activeTargetCount: 12, authorityCache: monitorCache
}, { productCount: 689 }).conditional, false, 'legacy authoritative responses without the additive policy must remain compatible');

(async () => {
  const calls = [];
  const product = {
    schema: 'tcg.product/v1', productId: 'mtg:fix:fixture-exact:booster:display:en', game: 'mtg',
    setCode: 'FIX', setName: 'Fixture Exact', productName: 'Fixture Exact Booster Display',
    productType: 'booster', unit: 'display', language: 'en', variant: null
  };
  const pricingCache = { mode: 'incremental', evidenceCache: { schema: 'provider-owned/v1', reused: true } };
  const valuation = { apiVersion: 1, schema: 'tcg.valuation/v1', product, market: { value: 100 }, cache: pricingCache };
  const client = authorityApi.createClient({
    baseUrl: 'https://gogo.tail903ec0.ts.net/collection', token: 'authority-test-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = url.endsWith('/v1/collection/snapshot') ? snapshotBody
        : url.endsWith('/v1/pricing/price') ? valuation
          : { apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    }
  });

  const fetchedSnapshot = await client.snapshot();
  assert.deepStrictEqual(fetchedSnapshot.cache, freshCache);
  const fetchedValuation = await client.priceProduct(product, { includeActive: true });
  assert.deepStrictEqual(fetchedValuation, valuation, 'Pricing Analyzer cache provenance must pass through Authority unchanged');
  await client.syncMonitor({ enabled: true });
  assert.strictEqual(calls.length, 3);
  assert(calls.every(call => call.options.headers.Authorization === 'Bearer authority-test-secret'));
  assert.deepStrictEqual(JSON.parse(calls[2].options.body), {
    schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true }
  }, 'Authority monitor sync must receive preferences only, never a cached collection snapshot');
  assert(!calls[2].options.body.includes('complete-snapshot-fallback'));

  const contracts = require(path.resolve(__dirname, '..', '..', 'browser-extension', 'vendor', 'tcg-comps-2.42.0', 'pricing-contracts.js'));
  const pricingBridgeApi = require(path.resolve(__dirname, '..', '..', 'browser-extension', 'vendor', 'tcg-comps-2.42.0', 'pricing-bridge.js'));
  const posted = [];
  const frame = { contentWindow: { postMessage: (message, origin) => posted.push({ message, origin }) } };
  const listeners = {};
  const bridge = pricingBridgeApi.createDashboardBridge({
    windowObject: {
      addEventListener: (type, listener) => { listeners[type] = listener; },
      removeEventListener: () => {}
    },
    frame,
    client: { priceProduct: client.priceProduct },
    allowedOrigins: ['https://d-k-b.github.io']
  });
  await bridge.listener({
    origin: 'https://d-k-b.github.io', source: frame.contentWindow,
    data: { channel: 'tcg-pricing/v1', type: 'priceProduct', requestId: 'cache-proof', target: product, options: { includeActive: true } }
  });
  assert.strictEqual(posted.length, 1);
  assert.deepStrictEqual(posted[0].message.result.cache, pricingCache,
    'the exact-origin dashboard pricing bridge must not strip Pricing Analyzer cache provenance');
  assert.strictEqual(posted[0].origin, 'https://d-k-b.github.io');
  assert.strictEqual(contracts.validateProductRef(product).ok, true);
  console.log('browser extension Authority tests: cache provenance and conditional safety passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
