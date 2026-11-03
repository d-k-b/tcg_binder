'use strict';

const assert = require('assert');
const path = require('path');

const contracts = require(path.resolve(__dirname, '..', '..', 'browser-extension', 'vendor', 'tcg-comps-2.42.0', 'pricing-contracts.js'));
globalThis.TCGPricingContracts = contracts;
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
  snapshot: { schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker', generatedAt: '2026-09-03T12:00:00.000Z', revision: HASH, products: {},
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
  revision: VERIFIED_MONITOR_REVISION, productCount: 719, activeTargetCount: 0,
  requestedMonitorEnabled: true, effectiveMonitorEnabled: false,
  ownershipPolicy: conditionalOwnershipPolicy, authorityCache: monitorCache
};
const conditionalValidation = authorityApi.validateMonitorSyncResponse(conditionalMonitorResponse, { productCount: 719 });
assert.strictEqual(conditionalValidation.conditional, true);
assert.strictEqual(authorityApi.validateMonitorSyncResponse(conditionalMonitorResponse).conditional, true,
  'the Authority client default must require the complete 719-product catalog');
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
  assert.throws(() => authorityApi.validateMonitorSyncResponse({ ...conditionalMonitorResponse, ...unsafe }, { productCount: 719 }),
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
}, { productCount: 719 }).conditional, false, 'authoritative monitor behavior must remain enabled');
assert.strictEqual(authorityApi.validateMonitorSyncResponse({
  apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true,
  revision: 'sha256:' + HASH, productCount: 719, activeTargetCount: 12, authorityCache: monitorCache
}, { productCount: 719 }).conditional, false, 'legacy authoritative responses without the additive policy must remain compatible');

(async () => {
  const calls = [];
  const product = {
    schema: 'tcg.product/v1', productId: 'mtg:fix:fixture-exact:booster:display:en', game: 'mtg',
    setCode: 'FIX', setName: 'Fixture Exact', productName: 'Fixture Exact Booster Display',
    productType: 'booster', unit: 'display', language: 'en', variant: null
  };
  const completeProducts = {
    [product.productId]: {
      product, status: 'target', target: 1, owned: 0, ordered: 1, missing: 0, requirement: 'required'
    }
  };
  for (let index = 1; index < 719; index += 1) {
    const productId = `mtg:fix:fixture-${index}:booster:display:en`;
    completeProducts[productId] = {
      product: {
        schema: 'tcg.product/v1', productId, game: 'mtg', setCode: 'FIX', setName: `Fixture ${index}`,
        productName: `Fixture ${index} Booster Display`, productType: 'booster', unit: 'display',
        language: 'en', variant: null
      },
      status: 'missing', target: 1, owned: 0, ordered: 0, missing: 1, requirement: 'required'
    };
  }
  const completeSnapshotBody = {
    ...snapshotBody,
    snapshot: { ...snapshotBody.snapshot, products: completeProducts }
  };
  const canonicalOne = contracts.validateCollectionSnapshot({
    schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker',
    products: { [product.productId]: completeProducts[product.productId] }
  });
  assert.strictEqual(canonicalOne.ok, true);
  const preservedOne = authorityApi.preserveOrderedSnapshot({
    schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker',
    products: { [product.productId]: completeProducts[product.productId] }
  }, canonicalOne.value, { requireOrdered: true });
  assert.strictEqual(preservedOne.products[product.productId].ordered, 1,
    'the wrapper-local snapshot must retain pending orders separately from owned inventory');
  assert.strictEqual(canonicalOne.value.products[product.productId].ordered, undefined,
    'the older TCG Comps decoration projection must not receive the additive ordered field');
  assert.throws(() => authorityApi.preserveOrderedSnapshot({
    schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker',
    products: { [product.productId]: { ...completeProducts[product.productId], missing: 1 } }
  }, canonicalOne.value, { requireOrdered: true }), error => error.code === 'COLLECTION_ORDERED_INCONSISTENT');

  const orderRequest = {
    schema: 'tcg.collection-order-operation/v1',
    idempotencyKey: 'order:extension:0001',
    expectedSnapshotRevision: HASH,
    product,
    ordered: 1,
    fulfillment: 'shipping',
    evidence: { type: 'order', referenceId: 'shopify:order-1234' }
  };
  const orderResponse = {
    schema: 'tcg.collection-order-operation-response/v1', applied: true, idempotentReplay: false,
    operation: {
      schema: 'tcg.collection-order-applied/v1', idempotencyKey: orderRequest.idempotencyKey,
      productId: product.productId, priorOrdered: 0, ordered: 1, fulfillment: 'shipping',
      evidence: orderRequest.evidence, recordedAt: '2026-09-03T12:00:00.000Z'
    },
    snapshot: completeSnapshotBody
  };
  const pricingCache = { mode: 'incremental', evidenceCache: { schema: 'provider-owned/v1', reused: true } };
  const valuation = { apiVersion: 1, schema: 'tcg.valuation/v1', product, market: { value: 100 }, cache: pricingCache };
  const client = authorityApi.createClient({
    baseUrl: 'https://gogo.tail903ec0.ts.net/collection', token: 'authority-test-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = url.endsWith('/v1/collection/snapshot') ? completeSnapshotBody
        : url.endsWith('/v1/pricing/price') ? valuation
          : url.endsWith('/v1/collection/order-operations') ? orderResponse
          : { apiVersion: 1, schema: 'tcg.collection-monitor-sync-result/v1', accepted: true };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
    }
  });

  const fetchedSnapshot = await client.snapshot();
  assert.deepStrictEqual(fetchedSnapshot.cache, freshCache);
  assert.strictEqual(fetchedSnapshot.products[product.productId].ordered, 1);
  const fetchedValuation = await client.priceProduct(product, { includeActive: true });
  assert.deepStrictEqual(fetchedValuation, valuation, 'Pricing Analyzer cache provenance must pass through Authority unchanged');
  await client.syncMonitor({ enabled: true });
  const appliedOrder = await client.orderOperation(orderRequest);
  assert.strictEqual(appliedOrder.schema, 'tcg.collection-order-operation-response/v1');
  assert.strictEqual(appliedOrder.snapshot.revision, HASH);
  assert.strictEqual(appliedOrder.snapshot.snapshot.products[product.productId].owned, 0);
  assert.strictEqual(appliedOrder.snapshot.snapshot.products[product.productId].ordered, 1);
  assert.strictEqual(appliedOrder.snapshot.snapshot.products[product.productId].missing, 0);
  assert.strictEqual(calls.length, 4);
  assert(calls.every(call => call.options.headers.Authorization === 'Bearer authority-test-secret'));
  assert.deepStrictEqual(JSON.parse(calls[2].options.body), {
    schema: 'tcg.collection-monitor-sync-request/v1', preferences: { enabled: true }
  }, 'Authority monitor sync must receive preferences only, never a cached collection snapshot');
  assert(!calls[2].options.body.includes('complete-snapshot-fallback'));
  assert.strictEqual(calls[3].url, 'https://gogo.tail903ec0.ts.net/collection/v1/collection/order-operations');
  assert.deepStrictEqual(JSON.parse(calls[3].options.body), orderRequest,
    'the order endpoint must receive only the exact revision-checked Authority operation');
  assert(!calls[3].options.body.includes('authority-test-secret'),
    'the Authority bearer must remain in the request header and out of the order body');
  const missingOrderedResponse = JSON.parse(JSON.stringify(orderResponse));
  delete missingOrderedResponse.snapshot.snapshot.products[product.productId].ordered;
  assert.throws(() => authorityApi.validateOrderOperationResponse(missingOrderedResponse, orderRequest),
    error => error.code === 'COLLECTION_ORDERED_INVALID',
    'an order response without separate ordered inventory must fail closed');
  assert.throws(() => authorityApi.validateOrderOperationResponse({
    ...orderResponse, operation: { ...orderResponse.operation, rawProviderDetail: 'must not pass through' }
  }, orderRequest), error => error.code === 'ORDER_RESPONSE_INVALID',
  'unexpected order-operation response fields must not cross the wrapper boundary');
  const callsBeforeRejectedOrder = calls.length;
  assert.throws(() => client.orderOperation({ ...orderRequest, leakedToken: 'do-not-send' }),
    error => error.code === 'ORDER_OPERATION_INVALID');
  assert.throws(() => client.orderOperation({ ...orderRequest, product: { ...product, unexpected: true } }),
    error => error.code === 'ORDER_PRODUCTREF_INVALID');
  assert.strictEqual(calls.length, callsBeforeRejectedOrder, 'invalid order operations must fail before authenticated transport');

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
  console.log('browser extension Authority tests: ordered snapshot, order operation, cache provenance, and conditional safety passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
