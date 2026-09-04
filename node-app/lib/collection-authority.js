'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const state = require('./collection-state');
const snapshotContract = require('./collection-snapshot');
const { CollectionDerivedCache } = require('./collection-derived-cache');

const SERVICE_VERSION = '1.2.0';
const OPTIONAL_OBJECT_FIELDS = Object.freeze([
  'extras', 'ordered', 'wrapperArts', 'orderedWrapperArts', 'legacyChecksV1',
]);
const SAFE_PRICING_ERROR_CODES = new Set([
  'REST_TIMEOUT', 'REST_UNAVAILABLE', 'REST_REJECTED', 'INVALID_RESPONSE',
  'NO_PRODUCT_MATCH', 'NO_VERIFIED_PRICE', 'PRICING_NOT_CONFIGURED',
  'UNAUTHORIZED', 'UNSUPPORTED_VERSION', 'PRODUCT_MISMATCH', 'SOURCE_UNAVAILABLE',
  'BROWSER_AGENT_OFFLINE', 'BROWSER_ANALYSIS_FAILED', 'BROWSER_JOB_NOT_FOUND',
  'BROWSER_JOB_TIMEOUT', 'BROWSER_QUEUE_FULL', 'BROWSER_QUEUE_UNAVAILABLE',
  'CAPTURE_STALE', 'INVALID_BROWSER_PROVENANCE',
]);
const SAFE_BROWSER_JOB_ID = /^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class AuthorityError extends Error {
  constructor(code, message, httpStatus = 503, details = {}) {
    super(message);
    this.name = 'AuthorityError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safePricingErrorDetails(error) {
  const details = { retryable: true };
  if (error && typeof error.code === 'string' && SAFE_PRICING_ERROR_CODES.has(error.code)) {
    details.providerErrorCode = error.code;
  }
  if (error && typeof error.jobId === 'string' && SAFE_BROWSER_JOB_ID.test(error.jobId)) {
    details.jobId = error.jobId;
  }
  return details;
}

function atomicJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), '.' + path.basename(filePath) + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp');
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
  }
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function safeErrorBody(error) {
  const known = error instanceof AuthorityError ? error : new AuthorityError('COLLECTION_AUTHORITY_INTERNAL', 'Collection authority failed safely');
  const nonRetryableCodes = new Set([
    'AUTH_REJECTED', 'GIST_AUTH_REJECTED', 'GIST_ID_MISSING', 'GIST_RESOURCE_MISSING', 'GIST_FILE_MISSING',
    'GIST_PAYLOAD_INVALID', 'GIST_SCHEMA_INVALID', 'GIST_LEGACY_REPAIR_REQUIRED', 'GIST_SNAPSHOT_UNDATED',
    'GIST_JSON_INVALID', 'GIST_RESPONSE_MALFORMED', 'GIST_TRUNCATED_WITHOUT_SOURCE', 'GIST_RAW_SOURCE_REJECTED',
    'COLLECTION_SNAPSHOT_INCOMPLETE', 'PRODUCTREF_SNAPSHOT_INVALID', 'PRODUCTREF_EXACT_IDENTITY_REQUIRED',
    'RECEIPT_SCHEMA_INVALID', 'IDEMPOTENCY_KEY_INVALID', 'EXPECTED_REVISION_INVALID', 'RECEIPT_QUANTITY_INVALID',
    'DELIVERED_AT_INVALID', 'EVIDENCE_REFERENCE_INVALID', 'RECEIPT_IDEMPOTENCY_CONFLICT', 'COLLECTION_REVISION_CONFLICT',
    'REPAIR_SOURCE_REQUIRED', 'REPAIR_UNSAFE_SCHEMA', 'REPAIR_SOURCE_MISMATCH',
    'PRICING_REQUEST_INVALID', 'PRICING_PRODUCTREF_INVALID', 'MONITOR_PREFERENCES_INVALID',
    'PRICING_DEPENDENCY_NOT_CONFIGURED', 'MONITOR_DEPENDENCY_NOT_CONFIGURED',
  ]);
  const details = { ...known.details };
  delete details.retryable;
  const retryable = typeof known.details.retryable === 'boolean'
    ? known.details.retryable
    : (!nonRetryableCodes.has(known.code) && ([408, 425, 429].includes(known.httpStatus) || known.httpStatus >= 500));
  return {
    schema: 'tcg.collection-authority-error/v1',
    error: {
      code: known.code,
      message: known.message,
      consumerStatus: 'CONDITIONAL',
      retryable,
      ...details,
    },
  };
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryAfterMs(response, fallbackMs, now = Date.now()) {
  const raw = response && response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null;
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds * 1000), 30_000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.min(at - now, 30_000)) : fallbackMs;
}

class GitHubGistStore {
  constructor(options) {
    this.token = String(options.token || '');
    this.catalog = options.catalog;
    this.fetch = options.fetchImpl || globalThis.fetch;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now || (() => Date.now());
    this.api = options.api || 'https://api.github.com';
    this.dataDir = options.dataDir;
    this.idsPath = path.join(this.dataDir, 'collection-authority-gists.json');
    this.retryPath = path.join(this.dataDir, 'collection-authority-retry.json');
    this.ids = null;
    this.retry = readJson(this.retryPath, { state: 'idle', reasonCode: null, retryAt: null, attempts: 0 });
  }

  configured() { return Boolean(this.token); }

  headers() {
    return {
      Authorization: 'Bearer ' + this.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'tcg-collection-authority/' + SERVICE_VERSION,
    };
  }

  saveRetry(next) {
    this.retry = next;
    atomicJsonWrite(this.retryPath, next);
  }

  safeRetryState() { return clone(this.retry); }

  async request(urlOrPath, options = {}, retryOptions = {}) {
    if (!this.configured()) throw new AuthorityError('GIST_CREDENTIAL_MISSING', 'Protected collection credential is not configured', 503);
    const attempts = Number.isInteger(retryOptions.attempts) ? retryOptions.attempts : 3;
    const baseDelayMs = Number.isFinite(retryOptions.baseDelayMs) ? retryOptions.baseDelayMs : 500;
    const url = /^https?:\/\//.test(urlOrPath) ? urlOrPath : this.api + urlOrPath;
    let lastTransport = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await this.fetch(url, { ...options, headers: { ...this.headers(), ...(options.headers || {}) } });
        if (response.ok || !retryableStatus(response.status) || attempt === attempts) {
          if (response.ok) this.saveRetry({ state: 'idle', reasonCode: null, retryAt: null, attempts: 0 });
          else if (retryableStatus(response.status)) {
            this.saveRetry({ state: 'exhausted', reasonCode: response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_TRANSIENT_HTTP', retryAt: null, attempts: attempt });
          }
          return response;
        }
        const delayMs = retryAfterMs(response, Math.min(baseDelayMs * (2 ** (attempt - 1)), 5_000), this.now());
        const reasonCode = response.status === 429 ? 'UPSTREAM_RATE_LIMIT' : 'UPSTREAM_TRANSIENT_HTTP';
        this.saveRetry({ state: 'waiting', reasonCode, retryAt: new Date(this.now() + delayMs).toISOString(), attempts: attempt });
        await this.sleep(delayMs);
      } catch (error) {
        lastTransport = error;
        if (attempt === attempts) break;
        const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)), 5_000);
        this.saveRetry({ state: 'waiting', reasonCode: 'UPSTREAM_TRANSPORT', retryAt: new Date(this.now() + delayMs).toISOString(), attempts: attempt });
        await this.sleep(delayMs);
      }
    }
    this.saveRetry({ state: 'exhausted', reasonCode: 'UPSTREAM_TRANSPORT', retryAt: null, attempts });
    throw new AuthorityError('GIST_TRANSPORT_RETRY_EXHAUSTED', 'Collection upstream transport failed after bounded retries', 503,
      { reasonCode: 'UPSTREAM_TRANSPORT' });
  }

  fileFor(lane) { return 'mtg-binder-' + lane + '.json'; }

  lanes() { return snapshotContract.EXPECTED_LANES; }

  readIds() {
    if (this.ids) return this.ids;
    this.ids = readJson(this.idsPath, {});
    return this.ids;
  }

  saveIds() { atomicJsonWrite(this.idsPath, this.ids || {}); }

  async ensureIds() {
    const ids = this.readIds();
    if (this.lanes().every((lane) => ids[lane])) return ids;
    const response = await this.request('/gists?per_page=100');
    if (!response.ok) throw this.httpError(response.status, 'GIST_DISCOVERY_FAILED');
    const discovered = {};
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body)) throw new AuthorityError('GIST_DISCOVERY_SCHEMA_INVALID', 'Collection source discovery response was invalid', 502);
    for (const gist of body) {
      for (const filename of Object.keys(gist.files || {})) {
        const match = /^mtg-binder-(.+)\.json$/.exec(filename);
        if (match && this.lanes().includes(match[1]) && typeof gist.id === 'string') discovered[match[1]] = gist.id;
      }
    }
    this.ids = { ...discovered, ...ids };
    this.saveIds();
    return this.ids;
  }

  httpError(status, fallbackCode) {
    if (status === 401 || status === 403) return new AuthorityError('GIST_AUTH_REJECTED', 'Collection source authentication was rejected', 503);
    if (status === 404) return new AuthorityError('GIST_RESOURCE_MISSING', 'A configured collection source is unavailable', 503);
    if (retryableStatus(status)) return new AuthorityError(fallbackCode || 'GIST_TRANSIENT_FAILURE', 'Collection source is temporarily unavailable', 503, { retryable: true });
    return new AuthorityError(fallbackCode || 'GIST_HTTP_FAILURE', 'Collection source request failed safely', 502);
  }

  validatePayload(lane, payload, { allowLegacyDefaults = false } = {}) {
    if (!isObject(payload)) throw new AuthorityError('GIST_PAYLOAD_INVALID', 'Collection lane payload is invalid', 503, { lane, reasonCode: 'PAYLOAD_NOT_OBJECT' });
    if (!isObject(payload.checks)) throw new AuthorityError('GIST_SCHEMA_INVALID', 'Collection lane schema is incomplete', 503, { lane, reasonCode: 'CHECKS_MISSING' });
    const missingDefaults = OPTIONAL_OBJECT_FIELDS.filter((field) => payload[field] === undefined);
    for (const field of OPTIONAL_OBJECT_FIELDS) {
      if (payload[field] !== undefined && !isObject(payload[field])) {
        throw new AuthorityError('GIST_SCHEMA_INVALID', 'Collection lane schema is invalid', 503, { lane, reasonCode: 'OPTIONAL_FIELD_INVALID' });
      }
    }
    if (!allowLegacyDefaults && missingDefaults.length) {
      throw new AuthorityError('GIST_LEGACY_REPAIR_REQUIRED', 'Collection lane requires explicit legacy repair', 503,
        { lane, reasonCode: 'DEFAULT_FIELDS_MISSING' });
    }
    if (typeof payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(payload.updatedAt))) {
      throw new AuthorityError('GIST_SNAPSHOT_UNDATED', 'Collection lane has no trustworthy timestamp', 503, { lane, reasonCode: 'UPDATED_AT_INVALID' });
    }
    return { missingDefaults };
  }

  async readLane(lane, options = {}) {
    const ids = await this.ensureIds();
    const gistId = ids[lane];
    if (!gistId) throw new AuthorityError('GIST_ID_MISSING', 'Collection lane source is not configured', 503, { lane, reasonCode: 'GIST_ID_MISSING' });
    const response = await this.request('/gists/' + gistId, {}, options.retryOptions);
    if (!response.ok) throw this.httpError(response.status, 'GIST_READ_FAILED');
    const gist = await response.json().catch(() => null);
    if (!isObject(gist)) throw new AuthorityError('GIST_RESPONSE_MALFORMED', 'Collection source response was malformed', 502, { lane });
    const file = isObject(gist.files) ? gist.files[this.fileFor(lane)] : null;
    if (!isObject(file)) throw new AuthorityError('GIST_FILE_MISSING', 'Expected collection lane file is missing', 503, { lane });
    let content = file.content;
    if (file.truncated) {
      if (typeof file.raw_url !== 'string' || !file.raw_url.startsWith('https://')) {
        throw new AuthorityError('GIST_TRUNCATED_WITHOUT_SOURCE', 'Truncated collection lane could not be completed', 503, { lane });
      }
      const rawHost = new URL(file.raw_url).hostname;
      if (!['gist.githubusercontent.com', 'raw.githubusercontent.com', 'api.github.com'].includes(rawHost)) {
        throw new AuthorityError('GIST_RAW_SOURCE_REJECTED', 'Truncated collection lane source was rejected', 503, { lane });
      }
      const raw = await this.request(file.raw_url, {}, options.retryOptions);
      if (!raw.ok) throw this.httpError(raw.status, 'GIST_RAW_READ_FAILED');
      content = await raw.text();
    }
    if (typeof content !== 'string') throw new AuthorityError('GIST_RESPONSE_MALFORMED', 'Collection source content was malformed', 502, { lane });
    let payload;
    try { payload = JSON.parse(content); } catch { throw new AuthorityError('GIST_JSON_INVALID', 'Collection lane JSON is invalid', 503, { lane }); }
    const validation = this.validatePayload(lane, payload, { allowLegacyDefaults: options.allowLegacyDefaults });
    const stateRevision = crypto.createHash('sha256').update(content).digest('hex');
    const verifiedAt = new Date(this.now()).toISOString();
    return {
      lane,
      payload,
      missingDefaults: validation.missingDefaults,
      stateRevision,
      verifiedAt,
      verificationMethod: 'authenticated-github-gist-read',
      upstreamRevision: gist.history && gist.history[0] && gist.history[0].version || gist.updated_at || stateRevision,
      etag: response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null,
    };
  }

  async readAll(options = {}) {
    const records = [];
    const failures = [];
    for (const lane of this.lanes()) {
      try { records.push(await this.readLane(lane, options)); }
      catch (error) { failures.push(error instanceof AuthorityError ? error : new AuthorityError('GIST_READ_FAILED', 'Collection lane read failed', 503, { lane })); }
    }
    if (failures.length) {
      throw new AuthorityError('COLLECTION_SNAPSHOT_INCOMPLETE', 'Complete seven-lane collection snapshot is unavailable', 503, {
        reasonCodes: [...new Set(failures.map((failure) => failure.code))].sort(),
        failedLanes: failures.map((failure) => failure.details.lane).filter(Boolean).sort(),
        retryable: failures.every((failure) => safeErrorBody(failure).error.retryable === true),
      });
    }
    return records;
  }

  async diagnose() {
    const lanes = [];
    for (const lane of this.lanes()) {
      try {
        const record = await this.readLane(lane, { allowLegacyDefaults: true });
        lanes.push({ lane, state: record.missingDefaults.length ? 'legacy' : 'valid', reasonCodes: record.missingDefaults.map((field) => 'DEFAULT_FIELD_MISSING_' + field.toUpperCase()) });
      } catch (error) {
        const safe = error instanceof AuthorityError ? error : new AuthorityError('GIST_READ_FAILED', 'Collection lane read failed');
        lanes.push({ lane, state: safe.code === 'GIST_ID_MISSING' ? 'missing' : 'invalid', reasonCodes: [safe.code] });
      }
    }
    return { schema: 'tcg.collection-gist-diagnostic/v1', credentialConfigured: this.configured(), lanes };
  }

  async writeLane(lane, payload, expectedUpstreamRevision, { create = false } = {}) {
    this.validatePayload(lane, payload);
    const ids = await this.ensureIds();
    const gistId = ids[lane];
    if (!gistId && !create) throw new AuthorityError('GIST_ID_MISSING', 'Collection lane source is not configured', 503, { lane });
    if (gistId && expectedUpstreamRevision) {
      const current = await this.readLane(lane, { allowLegacyDefaults: true });
      if (current.upstreamRevision !== expectedUpstreamRevision) {
        throw new AuthorityError('COLLECTION_REVISION_CONFLICT', 'Collection lane changed before the operation could be applied', 409, { lane });
      }
    }
    const title = (this.catalog.checklists.find((candidate) => candidate.id === lane) || {}).title || lane;
    const content = JSON.stringify(payload, null, 2);
    const body = { description: 'MTG Binder · ' + title, files: { [this.fileFor(lane)]: { content } } };
    const response = await this.request(gistId ? '/gists/' + gistId : '/gists', {
      method: gistId ? 'PATCH' : 'POST',
      body: JSON.stringify(gistId ? body : { public: false, ...body }),
    });
    if (!response.ok) {
      if (response.status === 409 || response.status === 412) throw new AuthorityError('COLLECTION_REVISION_CONFLICT', 'Collection lane changed before the operation could be applied', 409, { lane });
      throw this.httpError(response.status, 'GIST_WRITE_FAILED');
    }
    const saved = await response.json().catch(() => ({}));
    if (!gistId) {
      if (typeof saved.id !== 'string' || !saved.id) throw new AuthorityError('GIST_CREATE_VERIFY_FAILED', 'Created collection lane could not be verified', 503, { lane });
      this.ids[lane] = saved.id;
      this.saveIds();
    }
    const verified = await this.readLane(lane);
    if (snapshotContract.stableJson(verified.payload) !== snapshotContract.stableJson(payload)) {
      throw new AuthorityError('GIST_READBACK_MISMATCH', 'Saved collection lane did not pass authoritative read-back', 503, { lane });
    }
    return verified;
  }
}

class CollectionAuthority {
  constructor(options) {
    this.store = options.store;
    this.catalog = options.catalog;
    this.catalogIndex = state.createCatalog(this.catalog);
    this.dataDir = options.dataDir;
    this.maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 24 * 60 * 60 * 1000;
    this.now = options.now || (() => Date.now());
    this.metaPath = path.join(this.dataDir, 'collection-authority-state.json');
    this.ledgerPath = path.join(this.dataDir, 'collection-authority-receipts.json');
    this.meta = readJson(this.metaPath, { lastSuccessfulSnapshotAt: null, lastSuccessfulRevision: null });
    this.ledger = readJson(this.ledgerPath, { schema: 'tcg.collection-receipt-ledger/v1', operations: {} });
    this.operationLock = Promise.resolve();
    this.pricingClient = options.pricingClient || null;
    this.monitorClient = options.monitorClient || null;
    this.pricingContracts = options.pricingContracts || null;
    this.derivedCache = options.derivedCache || new CollectionDerivedCache({
      filePath: path.join(this.dataDir, 'collection-authority-derived-cache.json'),
      now: this.now,
      readinessTtlMs: options.readinessCacheTtlMs,
      snapshotFallbackTtlMs: options.snapshotFallbackTtlMs,
      maxMonitorEntries: options.maxMonitorCacheEntries,
    });
  }

  async snapshot(options = {}) {
    const allowFallback = options.allowFallback !== false;
    let records;
    try {
      records = await this.store.readAll();
    } catch (error) {
      if (allowFallback && safeErrorBody(error).error.retryable === true) {
        const fallback = this.derivedCache.getSnapshotFallback();
        if (fallback) return fallback;
      }
      throw error;
    }
    let response;
    try {
      response = snapshotContract.buildSnapshot(this.catalog, records, {
        generatedAt: new Date(this.now()).toISOString(), maxAgeMs: this.maxAgeMs, nowMs: this.now(),
      });
      snapshotContract.validateSnapshotResponse(response);
    } catch (error) {
      if (error instanceof AuthorityError) throw error;
      throw new AuthorityError('PRODUCTREF_SNAPSHOT_INVALID', 'Complete ProductRef snapshot validation failed', 503);
    }
    this.meta = { lastSuccessfulSnapshotAt: response.generatedAt, lastSuccessfulRevision: response.revision };
    atomicJsonWrite(this.metaPath, this.meta);
    return this.derivedCache.putSnapshot(response);
  }

  async readiness() {
    const cached = this.derivedCache.getReadiness();
    if (cached) return cached;
    const diagnostic = await this.store.diagnose();
    const invalid = diagnostic.lanes.filter((lane) => lane.state !== 'valid');
    let pricing = { configured: Boolean(this.pricingClient), ready: false, reasonCode: this.pricingClient ? 'PRICING_READINESS_UNAVAILABLE' : 'PRICING_DEPENDENCY_NOT_CONFIGURED' };
    if (this.pricingClient) {
      try {
        const result = await this.pricingClient.readiness();
        pricing = { configured: true, ready: result && result.ready === true, reasonCode: result && result.ready === true ? null : 'PRICING_NOT_READY' };
      } catch (_error) {
        pricing = { configured: true, ready: false, reasonCode: 'PRICING_READINESS_UNAVAILABLE' };
      }
    }
    return this.derivedCache.putReadiness({
      schema: 'tcg.collection-authority-readiness/v1',
      version: SERVICE_VERSION,
      ready: this.store.configured() && invalid.length === 0,
      credentialConfigured: this.store.configured(),
      checklistCount: diagnostic.lanes.length,
      validChecklistCount: diagnostic.lanes.length - invalid.length,
      checklistStates: diagnostic.lanes,
      lastSuccessfulSnapshotAt: this.meta.lastSuccessfulSnapshotAt,
      lastSuccessfulRevision: this.meta.lastSuccessfulRevision,
      degradedReasonCodes: [...new Set(invalid.flatMap((lane) => lane.reasonCodes))].sort(),
      retry: this.store.safeRetryState(),
      dependencies: {
        pricing,
        monitor: { configured: Boolean(this.monitorClient) },
      },
    });
  }

  exactProductRef(product, errorCode = 'PRICING_PRODUCTREF_INVALID') {
    if (!isObject(product) || typeof product.productId !== 'string') {
      throw new AuthorityError(errorCode, 'Request requires one exact ProductRef', 422);
    }
    const entry = this.catalogIndex.byId.get(product.productId);
    if (!entry || snapshotContract.stableJson(entry.ref) !== snapshotContract.stableJson(product)) {
      throw new AuthorityError(errorCode, 'ProductRef does not exactly match the Tracker catalog', 422);
    }
    return entry.ref;
  }

  async pricingReadiness() {
    if (!this.pricingClient) throw new AuthorityError('PRICING_DEPENDENCY_NOT_CONFIGURED', 'Pricing Analyzer API is not configured', 503);
    try {
      return await this.pricingClient.readiness();
    } catch (_error) {
      throw new AuthorityError('PRICING_DEPENDENCY_UNAVAILABLE', 'Pricing Analyzer API is unavailable', 503, { retryable: true });
    }
  }

  async priceProduct(request) {
    if (!isObject(request) || request.schema !== 'tcg.collection-pricing-request/v1' ||
        Object.keys(request).some((field) => !['schema', 'requestId', 'product', 'options'].includes(field))) {
      throw new AuthorityError('PRICING_REQUEST_INVALID', 'Collection pricing request is invalid', 422);
    }
    if (!this.pricingClient) throw new AuthorityError('PRICING_DEPENDENCY_NOT_CONFIGURED', 'Pricing Analyzer API is not configured', 503);
    const product = this.exactProductRef(request.product);
    const requestId = String(request.requestId || 'collection-' + this.now().toString(36));
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) {
      throw new AuthorityError('PRICING_REQUEST_INVALID', 'Pricing requestId is invalid', 422);
    }
    const options = isObject(request.options) ? request.options : {};
    if (Object.keys(options).some((field) => !['includeActive', 'includeRecentSales', 'includePackOut'].includes(field))) {
      throw new AuthorityError('PRICING_REQUEST_INVALID', 'Pricing options are invalid', 422);
    }
    try {
      return await this.pricingClient.priceProduct(product, options, requestId);
    } catch (error) {
      throw new AuthorityError('PRICING_DEPENDENCY_UNAVAILABLE', 'Pricing Analyzer API request failed safely', 503,
        safePricingErrorDetails(error));
    }
  }

  normalizeMonitorPreferences(input) {
    const value = isObject(input) ? input : {};
    const digest = isObject(value.dailyDigest) ? value.dailyDigest : {};
    return {
      enabled: value.enabled !== false,
      maxMarketRatio: value.maxMarketRatio == null ? 0.8 : value.maxMarketRatio,
      buyAnywayMaxMarketRatio: value.buyAnywayMaxMarketRatio == null ? null : value.buyAnywayMaxMarketRatio,
      loosePackMaxMarketRatio: value.loosePackMaxMarketRatio == null ? null : value.loosePackMaxMarketRatio,
      minimumConfidence: value.minimumConfidence || 'medium',
      sources: Array.isArray(value.sources) ? value.sources : ['ebay', 'tcgplayer', 'heritage', 'store'],
      includeOptional: value.includeOptional === true,
      instantFixedPriceEmail: value.instantFixedPriceEmail !== false,
      dailyDigest: { enabled: digest.enabled !== false, time: digest.time || '07:00', timezone: digest.timezone || 'America/Chicago' },
    };
  }

  monitorOwnershipPolicy(response) {
    const authority = isObject(response && response.authority) ? response.authority : {};
    const cache = isObject(response && response.cache) ? response.cache : {};
    const authoritative = authority.state === 'fresh' && authority.consumerStatus === 'AUTHORITATIVE' &&
      cache.mode === 'snapshot-refresh' && cache.eligibleForMutation === true;
    return {
      schema: 'tcg.collection-ownership-policy/v1',
      snapshotRevision: response.revision,
      consumerStatus: authoritative ? 'AUTHORITATIVE' : 'CONDITIONAL',
      reviewOnly: !authoritative,
      mayInferOwnership: authoritative,
      eligibleForAction: authoritative,
      degradedReasonCodes: [...new Set(Array.isArray(authority.degradedReasonCodes)
        ? authority.degradedReasonCodes.filter((code) => typeof code === 'string' && code.length <= 80)
        : [])].slice(0, 20),
      verifiedAt: response.generatedAt,
      oldestSourceAt: typeof authority.oldestSourceAt === 'string' ? authority.oldestSourceAt : null,
      maxAgeMs: Number.isInteger(authority.maxAgeMs) && authority.maxAgeMs >= 0 ? authority.maxAgeMs : null,
    };
  }

  async monitorSync(request) {
    if (!isObject(request) || request.schema !== 'tcg.collection-monitor-sync-request/v1' ||
        Object.keys(request).some((field) => !['schema', 'preferences'].includes(field))) {
      throw new AuthorityError('MONITOR_PREFERENCES_INVALID', 'Monitor sync request is invalid', 422);
    }
    if (!this.monitorClient || !this.pricingContracts) {
      throw new AuthorityError('MONITOR_DEPENDENCY_NOT_CONFIGURED', 'Pricing Analyzer monitor API is not configured', 503);
    }
    const response = await this.snapshot({ allowFallback: false });
    const requestedPreferences = this.normalizeMonitorPreferences(request.preferences);
    const ownershipPolicy = this.monitorOwnershipPolicy(response);
    // A complete conditional snapshot is useful replacement evidence, but it
    // must never create actionable targets on a monitor that predates the
    // explicit ownershipPolicy field. Disabling the effective subscription is
    // the backwards-compatible fail-closed gate.
    const preferences = ownershipPolicy.eligibleForAction ? requestedPreferences : {
      ...requestedPreferences,
      enabled: false,
      instantFixedPriceEmail: false,
      dailyDigest: { ...requestedPreferences.dailyDigest, enabled: false },
    };
    const collection = {
      schema: response.snapshot.schema,
      namespace: response.snapshot.namespace,
      products: response.snapshot.products,
    };
    const revisionPolicy = { ...ownershipPolicy };
    delete revisionPolicy.verifiedAt;
    delete revisionPolicy.oldestSourceAt;
    const revision = 'sha256:' + snapshotContract.revisionFor({ preferences, collection, ownershipPolicy: revisionPolicy });
    const cacheKey = this.derivedCache.monitorKey(response.revision, preferences, ownershipPolicy);
    let cachedSubscription = this.derivedCache.getMonitorSubscription(cacheKey);
    let subscription = cachedSubscription && cachedSubscription.value;
    if (!subscription) {
      subscription = {
        schema: 'tcg.collection-monitor-subscription/v1',
        namespace: collection.namespace,
        revision,
        generatedAt: new Date(this.now()).toISOString(),
        preferences,
        collection,
        ownershipPolicy,
      };
    }
    const checked = this.pricingContracts.validateMonitorSubscription(subscription);
    if (!checked || checked.ok !== true) {
      throw new AuthorityError('MONITOR_PREFERENCES_INVALID', 'Monitor preferences did not pass Pricing Analyzer validation', 422);
    }
    const validatedSubscription = { ...checked.value, ownershipPolicy };
    if (!cachedSubscription) cachedSubscription = this.derivedCache.putMonitorSubscription(cacheKey, validatedSubscription);
    try {
      const outgoingSubscription = {
        ...cachedSubscription.value,
        generatedAt: new Date(this.now()).toISOString(),
        ownershipPolicy,
      };
      const result = await this.monitorClient.syncCollection(outgoingSubscription);
      if (!result || result.accepted !== true || result.revision !== outgoingSubscription.revision ||
          result.productCount !== snapshotContract.EXPECTED_PRODUCT_COUNT ||
          (!ownershipPolicy.eligibleForAction && result.activeTargetCount !== 0)) {
        throw new AuthorityError('MONITOR_POLICY_NOT_ENFORCED', 'Monitor did not retain the complete fail-closed collection subscription', 503);
      }
      return {
        ...result,
        ownershipPolicy,
        requestedMonitorEnabled: requestedPreferences.enabled,
        effectiveMonitorEnabled: preferences.enabled,
        authorityCache: cachedSubscription.cache,
      };
    } catch (_error) {
      if (_error instanceof AuthorityError) throw _error;
      throw new AuthorityError('MONITOR_DEPENDENCY_UNAVAILABLE', 'Pricing Analyzer monitor API is unavailable', 503, { retryable: true });
    }
  }

  validateReceipt(request) {
    if (!isObject(request) || request.schema !== 'tcg.collection-receipt-operation/v1') {
      throw new AuthorityError('RECEIPT_SCHEMA_INVALID', 'Receipt operation schema is invalid', 422);
    }
    const allowedRequestFields = ['schema', 'idempotencyKey', 'expectedSnapshotRevision', 'product', 'quantity', 'deliveredAt', 'evidence'];
    if (Object.keys(request).some((field) => !allowedRequestFields.includes(field))) {
      throw new AuthorityError('RECEIPT_SCHEMA_INVALID', 'Receipt operation contains unsupported fields', 422);
    }
    if (typeof request.idempotencyKey !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(request.idempotencyKey)) {
      throw new AuthorityError('IDEMPOTENCY_KEY_INVALID', 'Receipt idempotency key is invalid', 422);
    }
    if (typeof request.expectedSnapshotRevision !== 'string' || !/^[0-9a-f]{64}$/.test(request.expectedSnapshotRevision)) {
      throw new AuthorityError('EXPECTED_REVISION_INVALID', 'Expected snapshot revision is invalid', 422);
    }
    if (!Number.isInteger(request.quantity) || request.quantity < 1 || request.quantity > 100) {
      throw new AuthorityError('RECEIPT_QUANTITY_INVALID', 'Receipt quantity must be an integer from 1 through 100', 422);
    }
    const deliveredMs = Date.parse(request.deliveredAt);
    if (typeof request.deliveredAt !== 'string' || !Number.isFinite(deliveredMs) || deliveredMs > this.now() + 5 * 60 * 1000) {
      throw new AuthorityError('DELIVERED_AT_INVALID', 'Delivered timestamp is invalid', 422);
    }
    if (!isObject(request.evidence) || Object.keys(request.evidence).some((field) => !['type', 'referenceId'].includes(field)) ||
        !['provider-message', 'order', 'manual-receipt'].includes(request.evidence.type) ||
        typeof request.evidence.referenceId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/.test(request.evidence.referenceId)) {
      throw new AuthorityError('EVIDENCE_REFERENCE_INVALID', 'Receipt evidence reference is invalid', 422);
    }
    if (!isObject(request.product) || typeof request.product.productId !== 'string') {
      throw new AuthorityError('PRODUCTREF_EXACT_IDENTITY_REQUIRED', 'Receipt requires one exact ProductRef', 422);
    }
    const entry = this.catalogIndex.byId.get(request.product.productId);
    if (!entry || snapshotContract.stableJson(entry.ref) !== snapshotContract.stableJson(request.product)) {
      throw new AuthorityError('PRODUCTREF_EXACT_IDENTITY_REQUIRED', 'Receipt ProductRef does not exactly match the Tracker catalog', 422);
    }
    return entry;
  }

  applyExactReceipt(payload, entry, quantity) {
    const next = state.emptyState(payload);
    if (Object.prototype.hasOwnProperty.call(entry.product, 'slotOrdinal')) {
      const slotIndex = entry.product.slotOrdinal;
      const checkKey = state.keyFor(entry.checklist.id, entry.item, slotIndex);
      const extraKey = state.slotExtraKeyFor(entry.checklist.id, entry.item, slotIndex);
      for (let index = 0; index < quantity; index += 1) {
        const ordered = Number(next.ordered[extraKey] || 0);
        if (ordered <= 1) delete next.ordered[extraKey]; else next.ordered[extraKey] = ordered - 1;
        if (!next.checks[checkKey]) next.checks[checkKey] = true;
        else next.extras[extraKey] = Number(next.extras[extraKey] || 0) + 1;
      }
      return { ...payload, ...next };
    }
    const before = state.describe(next, entry);
    const targetOwned = before.owned + quantity;
    const targetOrdered = Math.max(0, before.ordered - quantity);
    return { ...payload, ...state.setQuantities(next, entry, { owned: targetOwned, ordered: targetOrdered }) };
  }

  async receiptOperation(request) {
    const run = async () => {
      const entry = this.validateReceipt(request);
      const bodyHash = snapshotContract.revisionFor(request);
      const prior = this.ledger.operations[request.idempotencyKey];
      if (prior) {
        if (prior.bodyHash !== bodyHash) throw new AuthorityError('RECEIPT_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different receipt', 409);
        return { ...clone(prior.result), idempotentReplay: true };
      }
      const before = await this.snapshot({ allowFallback: false });
      if (before.revision !== request.expectedSnapshotRevision) {
        throw new AuthorityError('COLLECTION_REVISION_CONFLICT', 'Collection snapshot revision is stale', 409, { currentRevision: before.revision });
      }
      const lane = entry.checklist.id;
      const current = await this.store.readLane(lane);
      const nextPayload = this.applyExactReceipt(current.payload, entry, request.quantity);
      nextPayload.updatedAt = new Date(this.now()).toISOString();
      nextPayload.lastReceiptOperation = {
        schema: 'tcg.collection-receipt-applied/v1',
        idempotencyKey: request.idempotencyKey,
        productId: request.product.productId,
        quantity: request.quantity,
        deliveredAt: request.deliveredAt,
        evidence: clone(request.evidence),
      };
      await this.store.writeLane(lane, nextPayload, current.upstreamRevision);
      const after = await this.snapshot({ allowFallback: false });
      const result = {
        schema: 'tcg.collection-receipt-operation-response/v1',
        applied: true,
        idempotentReplay: false,
        operation: clone(nextPayload.lastReceiptOperation),
        snapshot: after,
      };
      this.ledger.operations[request.idempotencyKey] = { bodyHash, result };
      const keys = Object.keys(this.ledger.operations);
      for (const key of keys.slice(0, Math.max(0, keys.length - 128))) delete this.ledger.operations[key];
      atomicJsonWrite(this.ledgerPath, this.ledger);
      return clone(result);
    };
    const resultPromise = this.operationLock.then(run, run);
    this.operationLock = resultPromise.then(() => undefined, () => undefined);
    return resultPromise;
  }

  async repair(options = {}) {
    const diagnostic = await this.store.diagnose();
    if (!options.apply) return { ...diagnostic, applyRequired: diagnostic.lanes.some((lane) => lane.state !== 'valid') };
    const sourcePayloads = options.sourcePayloads || {};
    for (const lane of diagnostic.lanes) {
      if (lane.state === 'missing' && !sourcePayloads[lane.lane]) {
        throw new AuthorityError('REPAIR_SOURCE_REQUIRED', 'Verified source data is required before creating a missing collection lane', 422,
          { failedLanes: [lane.lane] });
      }
      if (lane.state === 'invalid') throw new AuthorityError('REPAIR_UNSAFE_SCHEMA', 'Invalid collection lane requires manual source recovery', 422, { failedLanes: [lane.lane] });
    }
    const changed = [];
    for (const laneStatus of diagnostic.lanes) {
      if (laneStatus.state === 'valid') continue;
      let payload;
      let expectedRevision = null;
      let create = false;
      if (laneStatus.state === 'missing') {
        payload = clone(sourcePayloads[laneStatus.lane]);
        create = true;
      } else {
        const current = await this.store.readLane(laneStatus.lane, { allowLegacyDefaults: true });
        payload = clone(current.payload);
        expectedRevision = current.upstreamRevision;
      }
      payload.checklist = payload.checklist || laneStatus.lane;
      if (payload.checklist !== laneStatus.lane) throw new AuthorityError('REPAIR_SOURCE_MISMATCH', 'Repair source checklist identity does not match', 422, { failedLanes: [laneStatus.lane] });
      for (const field of OPTIONAL_OBJECT_FIELDS) if (payload[field] === undefined) payload[field] = {};
      payload.keyVersion = payload.keyVersion || 2;
      payload.updatedAt = payload.updatedAt || new Date(this.now()).toISOString();
      this.store.validatePayload(laneStatus.lane, payload);
      await this.store.writeLane(laneStatus.lane, payload, expectedRevision, { create });
      changed.push(laneStatus.lane);
    }
    const snapshot = await this.snapshot({ allowFallback: false });
    return { schema: 'tcg.collection-gist-repair-result/v1', applied: true, changed, verifiedRevision: snapshot.revision, checklistCount: 7 };
  }
}

module.exports = {
  SERVICE_VERSION, OPTIONAL_OBJECT_FIELDS, AuthorityError, safeErrorBody,
  retryableStatus, retryAfterMs, GitHubGistStore, CollectionAuthority,
  atomicJsonWrite,
};
