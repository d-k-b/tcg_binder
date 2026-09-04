'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const snapshotContract = require('./collection-snapshot');

const CACHE_SCHEMA = 'tcg.collection-derived-cache/v1';
const CACHE_STATUS_SCHEMA = 'tcg.collection-derived-cache-status/v1';
const DEFAULT_READINESS_TTL_MS = 30 * 1000;
const DEFAULT_SNAPSHOT_FALLBACK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_MONITOR_ENTRIES = 4;
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function isObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

function iso(nowMs) { return new Date(nowMs).toISOString(); }

function ageMs(savedAt, nowMs) {
  const savedMs = Date.parse(savedAt);
  return Number.isFinite(savedMs) ? Math.max(0, nowMs - savedMs) : Infinity;
}

function emptyCache() {
  return { schema: CACHE_SCHEMA, version: 1, updatedAt: null, readiness: null, snapshot: null, monitorSubscriptions: {} };
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(filePath), 0o700);
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

class CollectionDerivedCache {
  constructor(options = {}) {
    this.filePath = options.filePath;
    this.now = options.now || (() => Date.now());
    this.readinessTtlMs = Number.isFinite(options.readinessTtlMs) ? options.readinessTtlMs : DEFAULT_READINESS_TTL_MS;
    this.snapshotFallbackTtlMs = Number.isFinite(options.snapshotFallbackTtlMs) ? options.snapshotFallbackTtlMs : DEFAULT_SNAPSHOT_FALLBACK_TTL_MS;
    this.maxMonitorEntries = Number.isInteger(options.maxMonitorEntries) ? options.maxMonitorEntries : DEFAULT_MAX_MONITOR_ENTRIES;
    this.maxBytes = Number.isInteger(options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES;
    this.value = this.load();
  }

  load() {
    try {
      if (fs.statSync(this.filePath).size > this.maxBytes) return emptyCache();
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!isObject(parsed) || parsed.schema !== CACHE_SCHEMA || parsed.version !== 1) return emptyCache();
      return { ...emptyCache(), ...parsed, monitorSubscriptions: isObject(parsed.monitorSubscriptions) ? parsed.monitorSubscriptions : {} };
    } catch (_error) {
      return emptyCache();
    }
  }

  persist() {
    try {
      this.value.updatedAt = iso(this.now());
      const ordered = Object.entries(this.value.monitorSubscriptions || {})
        .sort((left, right) => Date.parse(right[1].savedAt || 0) - Date.parse(left[1].savedAt || 0));
      this.value.monitorSubscriptions = Object.fromEntries(ordered.slice(0, Math.max(0, this.maxMonitorEntries)));
      while (Buffer.byteLength(JSON.stringify(this.value), 'utf8') > this.maxBytes && Object.keys(this.value.monitorSubscriptions).length) {
        const oldest = Object.keys(this.value.monitorSubscriptions).at(-1);
        delete this.value.monitorSubscriptions[oldest];
      }
      if (Buffer.byteLength(JSON.stringify(this.value), 'utf8') > this.maxBytes) return false;
      atomicWrite(this.filePath, this.value);
      return true;
    } catch (_error) {
      return false;
    }
  }

  status(mode, savedAt, extra = {}) {
    return {
      schema: CACHE_STATUS_SCHEMA,
      mode,
      savedAt,
      ageMs: ageMs(savedAt, this.now()),
      ...extra,
    };
  }

  getReadiness() {
    const entry = this.value.readiness;
    if (!isObject(entry) || !isObject(entry.value) || ageMs(entry.savedAt, this.now()) > this.readinessTtlMs) return null;
    return { ...clone(entry.value), cache: this.status('readiness-hit', entry.savedAt, { maxAgeMs: this.readinessTtlMs }) };
  }

  putReadiness(value) {
    const savedAt = iso(this.now());
    this.value.readiness = { savedAt, value: clone(value) };
    this.persist();
    return { ...clone(value), cache: this.status('readiness-refresh', savedAt, { maxAgeMs: this.readinessTtlMs }) };
  }

  putSnapshot(response) {
    try { snapshotContract.validateSnapshotResponse(response); } catch (_error) { return response; }
    const savedAt = iso(this.now());
    this.value.snapshot = { savedAt, revision: response.revision, value: clone(response) };
    this.persist();
    return { ...response, cache: this.status('snapshot-refresh', savedAt, { revision: response.revision, eligibleForMutation: true }) };
  }

  getSnapshotFallback() {
    const entry = this.value.snapshot;
    if (!isObject(entry) || !isObject(entry.value) || ageMs(entry.savedAt, this.now()) > this.snapshotFallbackTtlMs) return null;
    try { snapshotContract.validateSnapshotResponse(entry.value); } catch (_error) { return null; }
    const response = clone(entry.value);
    const degradedReasonCodes = [...new Set([...(response.authority.degradedReasonCodes || []), 'COLLECTION_SNAPSHOT_CACHE_FALLBACK'])].sort();
    response.generatedAt = iso(this.now());
    response.authority = { ...response.authority, state: 'stale', consumerStatus: 'CONDITIONAL', degradedReasonCodes };
    response.snapshot = { ...response.snapshot, generatedAt: response.generatedAt, authority: clone(response.authority) };
    response.cache = this.status('complete-snapshot-fallback', entry.savedAt, {
      maxAgeMs: this.snapshotFallbackTtlMs,
      revision: response.revision,
      eligibleForMutation: false,
    });
    return response;
  }

  monitorKey(snapshotRevision, preferences, ownershipPolicy = null) {
    const revisionPolicy = ownershipPolicy && typeof ownershipPolicy === 'object' ? { ...ownershipPolicy } : ownershipPolicy;
    if (revisionPolicy) {
      delete revisionPolicy.verifiedAt;
      delete revisionPolicy.oldestSourceAt;
    }
    return snapshotContract.revisionFor({ snapshotRevision, preferences, ownershipPolicy: revisionPolicy });
  }

  getMonitorSubscription(key) {
    const entry = (this.value.monitorSubscriptions || {})[key];
    if (!isObject(entry) || !isObject(entry.value)) return null;
    return { value: clone(entry.value), cache: this.status('monitor-subscription-hit', entry.savedAt, { key }) };
  }

  putMonitorSubscription(key, subscription) {
    const savedAt = iso(this.now());
    this.value.monitorSubscriptions[key] = { savedAt, value: clone(subscription) };
    this.persist();
    return { value: clone(subscription), cache: this.status('monitor-subscription-refresh', savedAt, { key }) };
  }
}

module.exports = {
  CACHE_SCHEMA, CACHE_STATUS_SCHEMA, DEFAULT_READINESS_TTL_MS, DEFAULT_SNAPSHOT_FALLBACK_TTL_MS,
  DEFAULT_MAX_MONITOR_ENTRIES, DEFAULT_MAX_BYTES, CollectionDerivedCache,
};
