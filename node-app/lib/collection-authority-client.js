'use strict';

const { validateSnapshotResponse } = require('./collection-snapshot');

class CollectionAuthorityClientError extends Error {
  constructor(code, message, status = null, retryable = false) {
    super(message);
    this.name = 'CollectionAuthorityClientError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response, fallbackMs) {
  const raw = response.headers && response.headers.get('retry-after');
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - Date.now(), 30_000)) : fallbackMs;
}

class CollectionAuthorityClient {
  constructor(options = {}) {
    this.baseUrl = String(options.baseUrl || 'http://127.0.0.1:3102').replace(/\/$/, '');
    this.token = String(options.token || '');
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.attempts = Number.isInteger(options.attempts) ? options.attempts : 3;
    this.baseDelayMs = Number.isFinite(options.baseDelayMs) ? options.baseDelayMs : 250;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    if (!this.token) throw new CollectionAuthorityClientError('AUTH_TOKEN_MISSING', 'Collection authority bearer token is required');
  }

  async request(path, options = {}) {
    let lastTransport = null;
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      let response;
      try {
        response = await this.fetch(this.baseUrl + path, {
          ...options,
          headers: { Authorization: 'Bearer ' + this.token, Accept: 'application/json', ...(options.headers || {}) },
        });
      } catch (error) {
        lastTransport = error;
        if (attempt === this.attempts) break;
        await this.sleep(Math.min(this.baseDelayMs * (2 ** (attempt - 1)), 5_000));
        continue;
      }
      let body;
      try { body = await response.json(); } catch { throw new CollectionAuthorityClientError('RESPONSE_JSON_INVALID', 'Collection authority returned invalid JSON', response.status); }
      if (response.ok) return body;
      const code = body && body.error && body.error.code || 'COLLECTION_AUTHORITY_HTTP_ERROR';
      const message = body && body.error && body.error.message || 'Collection authority request failed';
      const retryable = retryableStatus(response.status) && (!body || !body.error || body.error.retryable !== false);
      if (!retryable || attempt === this.attempts) {
        throw new CollectionAuthorityClientError(code, message, response.status, retryable);
      }
      await this.sleep(retryAfterMs(response, Math.min(this.baseDelayMs * (2 ** (attempt - 1)), 5_000)));
    }
    throw new CollectionAuthorityClientError('COLLECTION_AUTHORITY_TRANSPORT_RETRY_EXHAUSTED',
      'Collection authority transport failed after bounded retries', null, true, lastTransport);
  }

  async readiness() {
    const body = await this.request('/v1/readiness');
    if (!body || body.schema !== 'tcg.collection-authority-readiness/v1') {
      throw new CollectionAuthorityClientError('READINESS_VERSION_UNSUPPORTED', 'Unsupported collection readiness schema');
    }
    return body;
  }

  async snapshot() {
    const body = await this.request('/v1/collection/snapshot');
    try { return validateSnapshotResponse(body); }
    catch { throw new CollectionAuthorityClientError('SNAPSHOT_VERSION_OR_COMPLETENESS_INVALID', 'Collection snapshot failed closed validation'); }
  }

  async syncMonitor(preferences = {}) {
    const body = await this.request('/v1/monitor/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schema: 'tcg.collection-monitor-sync-request/v1', preferences }),
    });
    const policy = body && body.ownershipPolicy;
    if (!body || body.accepted !== true || typeof body.revision !== 'string' ||
        body.productCount !== 688 || !Number.isInteger(body.activeTargetCount) ||
        !policy || policy.schema !== 'tcg.collection-ownership-policy/v1' ||
        typeof body.requestedMonitorEnabled !== 'boolean' ||
        typeof body.effectiveMonitorEnabled !== 'boolean') {
      throw new CollectionAuthorityClientError('MONITOR_RESPONSE_INVALID', 'Collection authority returned an invalid monitor sync response');
    }
    if (policy.eligibleForAction === false &&
        (body.effectiveMonitorEnabled !== false || body.activeTargetCount !== 0)) {
      throw new CollectionAuthorityClientError('MONITOR_POLICY_NOT_ENFORCED', 'Conditional collection monitor sync was not fail closed');
    }
    return body;
  }

  async receiptOperation(operation) {
    const body = await this.request('/v1/collection/receipt-operations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation),
    });
    if (!body || body.schema !== 'tcg.collection-receipt-operation-response/v1') {
      throw new CollectionAuthorityClientError('RECEIPT_RESPONSE_VERSION_UNSUPPORTED', 'Unsupported receipt operation response schema');
    }
    try { validateSnapshotResponse(body.snapshot); }
    catch { throw new CollectionAuthorityClientError('RECEIPT_SNAPSHOT_INVALID', 'Receipt response did not include a complete authoritative snapshot'); }
    return body;
  }
}

module.exports = { CollectionAuthorityClient, CollectionAuthorityClientError, retryableStatus, retryAfterMs };
