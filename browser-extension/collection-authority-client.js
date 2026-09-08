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

  function attachSnapshotProvenance(result) {
    if (!isObject(result) || result.schema !== SNAPSHOT_RESPONSE_SCHEMA || !isObject(result.snapshot)) {
      throw clientError('COLLECTION_SNAPSHOT_RESPONSE_INVALID', 'Collection Authority returned an unsupported snapshot response.');
    }
    const authority = normalizeAuthority(result.authority || result.snapshot.authority, true);
    const cache = normalizeCache(result.cache, true);
    const snapshot = { ...result.snapshot, authority, cache };
    snapshotPolicy(snapshot, { requireAuthority: true });
    return snapshot;
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
      snapshot: () => request('GET', '/v1/collection/snapshot').then(attachSnapshotProvenance),
      priceProduct: (product, requestOptions) => request('POST', '/v1/pricing/price', {
        schema: 'tcg.collection-pricing-request/v1',
        requestId: 'tracker-' + Date.now().toString(36),
        product,
        options: requestOptions || {}
      }),
      syncMonitor: preferences => request('POST', '/v1/monitor/sync', { schema: 'tcg.collection-monitor-sync-request/v1', preferences: preferences || {} })
    };
  }

  return {
    SNAPSHOT_RESPONSE_SCHEMA,
    SNAPSHOT_SCHEMA,
    CACHE_STATUS_SCHEMA,
    OWNERSHIP_POLICY_SCHEMA,
    MONITOR_SYNC_RESULT_SCHEMA,
    createClient,
    attachSnapshotProvenance,
    snapshotPolicy,
    normalizeOwnershipPolicy,
    validateMonitorSyncResponse
  };
});
