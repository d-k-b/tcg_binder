(function initCollectionAuthorityClient(root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TCGCollectionAuthorityClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function collectionAuthorityClientFactory(root) {
  'use strict';

  const SNAPSHOT_RESPONSE_SCHEMA = 'tcg.collection-snapshot-response/v1';
  const SNAPSHOT_SCHEMA = 'tcg.collection-snapshot/v2';
  const CACHE_STATUS_SCHEMA = 'tcg.collection-derived-cache-status/v1';
  const OWNERSHIP_POLICY_SCHEMA = 'tcg.collection-ownership-policy/v1';
  const MONITOR_SYNC_RESULT_SCHEMA = 'tcg.collection-monitor-sync-result/v1';
  const ORDER_OPERATION_SCHEMA = 'tcg.collection-order-operation/v1';
  const ORDER_OPERATION_RESPONSE_SCHEMA = 'tcg.collection-order-operation-response/v1';
  const ORDER_APPLIED_SCHEMA = 'tcg.collection-order-applied/v1';
  const EXPECTED_PRODUCT_COUNT = 689;
  const PRODUCT_FIELDS = ['schema', 'productId', 'game', 'setCode', 'setName', 'productName', 'productType', 'unit', 'language', 'variant'];
  const CACHE_MODES = new Set([
    'readiness-hit', 'readiness-refresh', 'snapshot-refresh', 'complete-snapshot-fallback',
    'monitor-subscription-hit', 'monitor-subscription-refresh'
  ]);

  function clientError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function validIso(value) {
    return typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value));
  }

  function exactKeys(value, allowed) {
    return isObject(value) && Object.keys(value).length === allowed.length && Object.keys(value).every((key) => allowed.includes(key));
  }

  function normalizeExactProductRef(value) {
    if (!exactKeys(value, PRODUCT_FIELDS) || typeof value.setCode !== 'string' || !value.setCode.trim() ||
        (value.variant !== null && (typeof value.variant !== 'string' || !value.variant.trim()))) {
      throw clientError('ORDER_PRODUCTREF_INVALID', 'Order operation requires one exact canonical ProductRef.');
    }
    const validator = root.TCGPricingContracts && root.TCGPricingContracts.validateProductRef;
    if (typeof validator !== 'function') {
      throw clientError('ORDER_PRODUCTREF_VALIDATOR_UNAVAILABLE', 'Reload the updated Tracker extension before recording an order.');
    }
    const checked = validator(value);
    if (!checked || !checked.ok || !checked.value || PRODUCT_FIELDS.some((field) => checked.value[field] !== value[field])) {
      throw clientError('ORDER_PRODUCTREF_INVALID', 'Order operation requires one exact canonical ProductRef.');
    }
    return checked.value;
  }

  function normalizeEvidence(value) {
    const allowed = ['type', 'referenceId'];
    if (!exactKeys(value, allowed) || !['provider-message', 'order', 'manual-receipt'].includes(value.type) ||
        typeof value.referenceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(value.referenceId)) {
      throw clientError('ORDER_EVIDENCE_INVALID', 'Order evidence reference is invalid.');
    }
    return { type: value.type, referenceId: value.referenceId };
  }

  function normalizeOrderOperation(value) {
    const allowed = ['schema', 'idempotencyKey', 'expectedSnapshotRevision', 'product', 'ordered', 'fulfillment', 'evidence'];
    if (!exactKeys(value, allowed) || value.schema !== ORDER_OPERATION_SCHEMA) {
      throw clientError('ORDER_OPERATION_INVALID', 'Order operation schema is invalid.');
    }
    if (typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.idempotencyKey)) {
      throw clientError('ORDER_IDEMPOTENCY_KEY_INVALID', 'Order idempotency key is invalid.');
    }
    if (typeof value.expectedSnapshotRevision !== 'string' || !/^[0-9a-f]{64}$/.test(value.expectedSnapshotRevision)) {
      throw clientError('ORDER_EXPECTED_REVISION_INVALID', 'Expected collection snapshot revision is invalid.');
    }
    if (!Number.isInteger(value.ordered) || value.ordered < 0 || value.ordered > 100) {
      throw clientError('ORDER_QUANTITY_INVALID', 'Ordered total must be an integer from 0 through 100.');
    }
    if (!['shipping', 'pending-pickup', 'other'].includes(value.fulfillment)) {
      throw clientError('ORDER_FULFILLMENT_INVALID', 'Order fulfillment is invalid.');
    }
    return {
      schema: ORDER_OPERATION_SCHEMA,
      idempotencyKey: value.idempotencyKey,
      expectedSnapshotRevision: value.expectedSnapshotRevision,
      product: normalizeExactProductRef(value.product),
      ordered: value.ordered,
      fulfillment: value.fulfillment,
      evidence: normalizeEvidence(value.evidence)
    };
  }

  function preserveOrderedSnapshot(snapshot, providerSnapshot, options = {}) {
    if (!isObject(snapshot) || snapshot.schema !== SNAPSHOT_SCHEMA || !isObject(snapshot.products)) {
      throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection Authority did not return a collection snapshot v2.');
    }
    const base = providerSnapshot || snapshot;
    if (!isObject(base) || base.schema !== SNAPSHOT_SCHEMA || !isObject(base.products)) {
      throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection snapshot projection is invalid.');
    }
    const sourceIds = Object.keys(snapshot.products);
    const baseIds = Object.keys(base.products);
    if (sourceIds.length !== baseIds.length || baseIds.some((productId) => !Object.prototype.hasOwnProperty.call(snapshot.products, productId))) {
      throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection snapshot products do not match the canonical projection.');
    }
    if (Number.isInteger(options.productCount) && baseIds.length !== options.productCount) {
      throw clientError('COLLECTION_SNAPSHOT_INCOMPLETE', `Collection Authority did not return all ${options.productCount} canonical products.`);
    }
    const products = {};
    for (const productId of baseIds) {
      const raw = snapshot.products[productId];
      const canonical = base.products[productId];
      if (!isObject(raw) || !isObject(canonical) || !isObject(raw.product) || raw.product.productId !== productId) {
        throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection snapshot ProductRef identity is invalid.');
      }
      const ordered = raw.ordered;
      if (ordered == null && options.requireOrdered !== true) {
        products[productId] = { ...canonical };
        continue;
      }
      if (!Number.isInteger(ordered) || ordered < 0 || ordered > 100000) {
        throw clientError('COLLECTION_ORDERED_INVALID', 'Collection Authority returned an invalid ordered quantity.');
      }
      const target = raw.target;
      const owned = raw.owned;
      const missing = raw.missing;
      if (![target, owned, missing].every((count) => Number.isInteger(count) && count >= 0 && count <= 100000) ||
          target !== canonical.target || owned !== canonical.owned || missing !== canonical.missing ||
          missing !== Math.max(target - owned - ordered, 0)) {
        throw clientError('COLLECTION_ORDERED_INCONSISTENT', 'Collection Authority returned inconsistent owned, ordered, and missing quantities.');
      }
      products[productId] = { ...canonical, ordered };
    }
    return { ...base, products };
  }

  function normalizeAuthority(value, required = false) {
    if (!isObject(value)) {
      if (required) throw clientError('COLLECTION_AUTHORITY_PROVENANCE_INVALID', 'Collection Authority snapshot provenance is missing.');
      return null;
    }
    if (!['fresh', 'stale'].includes(value.state) || !['AUTHORITATIVE', 'CONDITIONAL'].includes(value.consumerStatus) ||
        !Array.isArray(value.degradedReasonCodes)) {
      throw clientError('COLLECTION_AUTHORITY_PROVENANCE_INVALID', 'Collection Authority snapshot provenance is invalid.');
    }
    const degradedReasonCodes = [];
    for (const raw of value.degradedReasonCodes.slice(0, 12)) {
      const code = String(raw || '').trim().slice(0, 80);
      if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(code)) {
        throw clientError('COLLECTION_AUTHORITY_PROVENANCE_INVALID', 'Collection Authority returned an invalid degraded-state code.');
      }
      if (!degradedReasonCodes.includes(code)) degradedReasonCodes.push(code);
    }
    return { state: value.state, consumerStatus: value.consumerStatus, degradedReasonCodes };
  }

  function normalizeCache(value, required = false) {
    if (!isObject(value)) {
      if (required) throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority snapshot cache provenance is missing.');
      return null;
    }
    if (value.schema !== CACHE_STATUS_SCHEMA || !CACHE_MODES.has(value.mode) || !validIso(value.savedAt) ||
        !Number.isFinite(Number(value.ageMs)) || Number(value.ageMs) < 0) {
      throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority snapshot cache provenance is invalid.');
    }
    const cache = {
      schema: CACHE_STATUS_SCHEMA,
      mode: value.mode,
      savedAt: new Date(value.savedAt).toISOString(),
      ageMs: Number(value.ageMs)
    };
    if (value.maxAgeMs != null) {
      if (!Number.isFinite(Number(value.maxAgeMs)) || Number(value.maxAgeMs) < 0) {
        throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority cache age limit is invalid.');
      }
      cache.maxAgeMs = Number(value.maxAgeMs);
    }
    if (value.revision != null) {
      const revision = String(value.revision || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(revision)) throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority cache revision is invalid.');
      cache.revision = revision;
    }
    if (value.eligibleForMutation != null) {
      if (typeof value.eligibleForMutation !== 'boolean') throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority cache mutation eligibility is invalid.');
      cache.eligibleForMutation = value.eligibleForMutation;
    }
    if (value.key != null) {
      const key = String(value.key || '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(key)) throw clientError('COLLECTION_AUTHORITY_CACHE_INVALID', 'Collection Authority cache key is invalid.');
      cache.key = key;
    }
    return cache;
  }

  function snapshotPolicy(snapshot, options = {}) {
    if (!isObject(snapshot) || snapshot.schema !== SNAPSHOT_SCHEMA) {
      throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection Authority did not return a collection snapshot v2.');
    }
    const required = options.requireAuthority === true;
    const authority = normalizeAuthority(snapshot.authority, required);
    const cache = normalizeCache(snapshot.cache, required);
    const authoritativeSnapshot = Boolean(authority && cache &&
      authority.consumerStatus === 'AUTHORITATIVE' && authority.state === 'fresh' &&
      cache.mode === 'snapshot-refresh' && cache.eligibleForMutation === true);
    const reviewOnly = Boolean(authority && !authoritativeSnapshot);
    return {
      authority,
      cache,
      reviewOnly,
      mayInferOwnership: !reviewOnly,
      eligibleForMutation: authoritativeSnapshot
    };
  }

  function attachSnapshotProvenance(result, options = {}) {
    if (!isObject(result) || result.schema !== SNAPSHOT_RESPONSE_SCHEMA || !isObject(result.snapshot)) {
      throw clientError('COLLECTION_SNAPSHOT_RESPONSE_INVALID', 'Collection Authority returned an unsupported snapshot response.');
    }
    if (!validIso(result.generatedAt) || !validIso(result.snapshot.generatedAt) ||
        !/^[0-9a-f]{64}$/.test(String(result.revision || '')) || result.snapshot.revision !== result.revision) {
      throw clientError('COLLECTION_SNAPSHOT_RESPONSE_INVALID', 'Collection Authority returned invalid snapshot revision metadata.');
    }
    const authority = normalizeAuthority(result.authority || result.snapshot.authority, true);
    const cache = normalizeCache(result.cache, true);
    let projection = result.snapshot;
    if (options.validateCanonical === true) {
      const validator = root.TCGPricingContracts && root.TCGPricingContracts.validateCollectionSnapshot;
      if (typeof validator !== 'function') {
        throw clientError('COLLECTION_SNAPSHOT_VALIDATOR_UNAVAILABLE', 'Reload the updated Tracker extension before using Collection Authority.');
      }
      const checked = validator(result.snapshot);
      if (!checked || !checked.ok || !checked.value) {
        throw clientError('COLLECTION_SNAPSHOT_INVALID', 'Collection Authority returned an invalid canonical ProductRef snapshot.');
      }
      projection = checked.value;
    }
    const ordered = preserveOrderedSnapshot(result.snapshot, projection, {
      requireOrdered: options.requireOrdered === true,
      productCount: options.productCount
    });
    const snapshot = {
      ...ordered,
      generatedAt: new Date(result.snapshot.generatedAt).toISOString(),
      revision: result.revision,
      authority,
      cache
    };
    snapshotPolicy(snapshot, { requireAuthority: true });
    return snapshot;
  }

  function normalizeSnapshotResponseEnvelope(result, options = {}) {
    const snapshot = attachSnapshotProvenance(result, options);
    return {
      schema: SNAPSHOT_RESPONSE_SCHEMA,
      generatedAt: new Date(result.generatedAt).toISOString(),
      revision: result.revision,
      authority: snapshot.authority,
      cache: snapshot.cache,
      snapshot
    };
  }

  function normalizeAppliedOrder(value, request) {
    const allowed = ['schema', 'idempotencyKey', 'productId', 'priorOrdered', 'ordered', 'fulfillment', 'evidence', 'recordedAt'];
    if (!exactKeys(value, allowed) || value.schema !== ORDER_APPLIED_SCHEMA ||
        value.idempotencyKey !== request.idempotencyKey || value.productId !== request.product.productId ||
        !Number.isInteger(value.priorOrdered) || value.priorOrdered < 0 || value.priorOrdered > 100 ||
        value.ordered !== request.ordered || value.fulfillment !== request.fulfillment || !validIso(value.recordedAt)) {
      throw clientError('ORDER_RESPONSE_INVALID', 'Collection Authority returned invalid order operation details.');
    }
    const evidence = normalizeEvidence(value.evidence);
    if (evidence.type !== request.evidence.type || evidence.referenceId !== request.evidence.referenceId) {
      throw clientError('ORDER_RESPONSE_INVALID', 'Collection Authority returned mismatched order evidence.');
    }
    return {
      schema: ORDER_APPLIED_SCHEMA,
      idempotencyKey: value.idempotencyKey,
      productId: value.productId,
      priorOrdered: value.priorOrdered,
      ordered: value.ordered,
      fulfillment: value.fulfillment,
      evidence,
      recordedAt: new Date(value.recordedAt).toISOString()
    };
  }

  function validateOrderOperationResponse(response, request) {
    if (!isObject(response) || response.schema !== ORDER_OPERATION_RESPONSE_SCHEMA ||
        typeof response.applied !== 'boolean' || typeof response.idempotentReplay !== 'boolean') {
      throw clientError('ORDER_RESPONSE_INVALID', 'Collection Authority returned an unsupported order operation response.');
    }
    const operation = normalizeAppliedOrder(response.operation, request);
    const snapshot = normalizeSnapshotResponseEnvelope(response.snapshot, {
      requireOrdered: true,
      validateCanonical: true,
      productCount: EXPECTED_PRODUCT_COUNT
    });
    return {
      schema: ORDER_OPERATION_RESPONSE_SCHEMA,
      applied: response.applied,
      idempotentReplay: response.idempotentReplay,
      operation,
      snapshot
    };
  }

  function normalizeOwnershipPolicy(value, required = false) {
    if (!isObject(value)) {
      if (required) throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority monitor ownership policy is missing.');
      return null;
    }
    if (value.schema !== OWNERSHIP_POLICY_SCHEMA || !/^[0-9a-f]{64}$/.test(String(value.snapshotRevision || '')) ||
        !['AUTHORITATIVE', 'CONDITIONAL'].includes(value.consumerStatus) || typeof value.reviewOnly !== 'boolean' ||
        typeof value.mayInferOwnership !== 'boolean' || typeof value.eligibleForAction !== 'boolean' ||
        !Array.isArray(value.degradedReasonCodes) || !validIso(value.verifiedAt) ||
        (value.oldestSourceAt != null && !validIso(value.oldestSourceAt))) {
      throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority returned an invalid monitor ownership policy.');
    }
    const degradedReasonCodes = [];
    for (const raw of value.degradedReasonCodes.slice(0, 20)) {
      const code = String(raw || '').trim().slice(0, 80);
      if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(code)) {
        throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority returned an invalid monitor ownership policy.');
      }
      if (!degradedReasonCodes.includes(code)) degradedReasonCodes.push(code);
    }
    return {
      schema: OWNERSHIP_POLICY_SCHEMA,
      snapshotRevision: String(value.snapshotRevision),
      consumerStatus: value.consumerStatus,
      reviewOnly: value.reviewOnly,
      mayInferOwnership: value.mayInferOwnership,
      eligibleForAction: value.eligibleForAction,
      degradedReasonCodes,
      verifiedAt: new Date(value.verifiedAt).toISOString(),
      oldestSourceAt: value.oldestSourceAt == null ? null : new Date(value.oldestSourceAt).toISOString()
    };
  }

  function validateMonitorSyncResponse(response, options = {}) {
    if (!isObject(response)) throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority returned an invalid monitor response.');
    const expectedProductCount = Number.isInteger(options.productCount) ? options.productCount : 689;
    const cache = normalizeCache(response.authorityCache, true);
    if (Number(response.apiVersion) !== 1 || response.schema !== MONITOR_SYNC_RESULT_SCHEMA || response.accepted !== true ||
        !/^sha256:[0-9a-f]{64}$/.test(String(response.revision || '')) || response.productCount !== expectedProductCount ||
        !Number.isInteger(response.activeTargetCount) || response.activeTargetCount < 0 ||
        !['monitor-subscription-hit', 'monitor-subscription-refresh'].includes(cache.mode)) {
      throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority did not confirm the complete monitor subscription.');
    }
    const hasPolicyFields = response.ownershipPolicy != null || response.requestedMonitorEnabled != null || response.effectiveMonitorEnabled != null;
    if (!hasPolicyFields) return { response, cache, ownershipPolicy: null, conditional: false };
    const ownershipPolicy = normalizeOwnershipPolicy(response.ownershipPolicy, true);
    if (typeof response.requestedMonitorEnabled !== 'boolean' || typeof response.effectiveMonitorEnabled !== 'boolean') {
      throw clientError('INVALID_MONITOR_RESPONSE', 'Collection Authority monitor enablement policy is invalid.');
    }
    const conditional = ownershipPolicy.consumerStatus === 'CONDITIONAL';
    if (conditional) {
      if (ownershipPolicy.reviewOnly !== true || ownershipPolicy.mayInferOwnership !== false ||
          ownershipPolicy.eligibleForAction !== false || response.effectiveMonitorEnabled !== false ||
          response.activeTargetCount !== 0) {
        throw clientError('MONITOR_POLICY_NOT_ENFORCED', 'Collection Authority did not retain the complete fail-closed conditional subscription.');
      }
    } else if (ownershipPolicy.reviewOnly !== false || ownershipPolicy.mayInferOwnership !== true ||
        ownershipPolicy.eligibleForAction !== true || response.effectiveMonitorEnabled !== response.requestedMonitorEnabled ||
        (response.effectiveMonitorEnabled === false && response.activeTargetCount !== 0)) {
      throw clientError('MONITOR_POLICY_NOT_ENFORCED', 'Collection Authority returned inconsistent authoritative monitor policy.');
    }
    return { response, cache, ownershipPolicy, conditional };
  }

  function createClient(options) {
    const baseUrl = String(options && options.baseUrl || '').trim().replace(/\/+$/, '');
    const token = String(options && options.token || '').trim();
    const fetchImpl = options && options.fetchImpl || root.fetch;
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(baseUrl)) throw new Error('Collection Authority URL must use HTTPS or loopback HTTP.');
    if (!token) throw new Error('Collection Authority bearer token is required.');
    if (typeof fetchImpl !== 'function') throw new Error('Collection Authority requires fetch.');
    async function request(method, path, body) {
      const response = await fetchImpl(baseUrl + path, {
        method,
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: root.AbortSignal && typeof root.AbortSignal.timeout === 'function' ? root.AbortSignal.timeout(30000) : undefined
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || typeof result !== 'object') {
        const error = new Error(String(result && result.error && result.error.message || 'Collection Authority request failed.'));
        error.code = String(result && result.error && result.error.code || 'COLLECTION_AUTHORITY_UNAVAILABLE');
        error.status = response.status;
        throw error;
      }
      return result;
    }
    return {
      readiness: () => request('GET', '/v1/readiness'),
      snapshot: () => request('GET', '/v1/collection/snapshot')
        .then(result => attachSnapshotProvenance(result, {
          requireOrdered: true,
          validateCanonical: true,
          productCount: EXPECTED_PRODUCT_COUNT
        })),
      priceProduct: (product, requestOptions) => request('POST', '/v1/pricing/price', {
        schema: 'tcg.collection-pricing-request/v1',
        requestId: 'tracker-' + Date.now().toString(36),
        product,
        options: requestOptions || {}
      }),
      syncMonitor: preferences => request('POST', '/v1/monitor/sync', { schema: 'tcg.collection-monitor-sync-request/v1', preferences: preferences || {} }),
      orderOperation: operation => {
        const normalized = normalizeOrderOperation(operation);
        return request('POST', '/v1/collection/order-operations', normalized)
          .then(response => validateOrderOperationResponse(response, normalized));
      }
    };
  }

  return {
    SNAPSHOT_RESPONSE_SCHEMA,
    SNAPSHOT_SCHEMA,
    CACHE_STATUS_SCHEMA,
    OWNERSHIP_POLICY_SCHEMA,
    MONITOR_SYNC_RESULT_SCHEMA,
    ORDER_OPERATION_SCHEMA,
    ORDER_OPERATION_RESPONSE_SCHEMA,
    createClient,
    attachSnapshotProvenance,
    normalizeSnapshotResponseEnvelope,
    preserveOrderedSnapshot,
    normalizeOrderOperation,
    validateOrderOperationResponse,
    snapshotPolicy,
    normalizeOwnershipPolicy,
    validateMonitorSyncResponse
  };
});
