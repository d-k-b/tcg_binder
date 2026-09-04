'use strict';

const crypto = require('crypto');
const stateKeys = require('./collection-state');

const SCHEMA = 'tcg.collection-snapshot/v2';
const RESPONSE_SCHEMA = 'tcg.collection-snapshot-response/v1';
const EXPECTED_LANES = Object.freeze([
  'collector', 'boxes', 'packs', 'prerelease', 'lorcana', 'lorcana_pre', 'lorcana_coll',
]);
const EXPECTED_PRODUCT_COUNT = 688;

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function revisionFor(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function positiveQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 0;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateProductRef(ref) {
  if (!isObject(ref) || ref.schema !== 'tcg.product/v1') throw new Error('catalog ProductRef has an unsupported schema');
  for (const key of ['productId', 'game', 'setCode', 'setName', 'productName', 'productType', 'unit', 'language']) {
    if (typeof ref[key] !== 'string' || !ref[key].trim()) throw new Error('catalog ProductRef is missing ' + key);
  }
}

function groupsFor(item) {
  return stateKeys.groupSlots(item);
}

function slotQuantity(payload, lane, item, slotIndex) {
  const checkKey = stateKeys.keyFor(lane, item, slotIndex);
  const extraKey = stateKeys.slotExtraKeyFor(lane, item, slotIndex);
  return (payload.checks[checkKey] ? 1 : 0) + positiveQuantity(payload.extras[extraKey]);
}

function groupRecord(payload, checklist, item, record) {
  if (Object.prototype.hasOwnProperty.call(record, 'slotOrdinal')) {
    const slotIndex = record.slotOrdinal;
    if (!Number.isInteger(slotIndex) || !item.slots[slotIndex]) {
      throw new Error(record.ref.productId + ' has an invalid slotOrdinal');
    }
    return {
      target: item.slots[slotIndex].r === false ? 0 : 1,
      owned: slotQuantity(payload, checklist.id, item, slotIndex),
      identitySemantics: 'exact-slot-variant',
    };
  }
  const requested = stateKeys.norm(record.slotGroup || record.label);
  const groups = groupsFor(item);
  const matches = groups.filter((group) => stateKeys.norm(group.name) === requested || stateKeys.norm(group.key) === requested);
  if (matches.length !== 1) throw new Error(record.ref.productId + ' must map to exactly one slot group');
  const group = matches[0];
  const target = group.slots.filter(({ slot }) => slot.r !== false).length;
  let owned;
  if (checklist.progressMode === 'distinct_variants') {
    owned = group.slots.reduce((total, member) => total + slotQuantity(payload, checklist.id, item, member.slotIndex), 0);
  } else {
    const checked = group.slots.filter((member) => payload.checks[stateKeys.keyFor(checklist.id, item, member.slotIndex)]).length;
    owned = checked + positiveQuantity(payload.extras[stateKeys.groupKeyFor(checklist.id, item, group.key)]);
  }
  return {
    target,
    owned,
    identitySemantics: checklist.id === 'packs' ? 'loose-pack-group' : 'exact-product-group',
  };
}

function wrapperArtSummary(payloads) {
  const packs = payloads.packs;
  const owned = Object.values(packs.wrapperArts || {}).reduce((total, value) => total + positiveQuantity(value), 0);
  const ordered = Object.values(packs.orderedWrapperArts || {}).reduce((total, value) => total + positiveQuantity(value), 0);
  return {
    requirement: 'optional',
    affectsRequiredProgress: false,
    ownershipSource: 'packs.wrapperArts',
    owned,
    ordered,
    note: 'Wrapper-art inventory is independent from loose-pack and sealed-display requirements.',
  };
}

function buildSnapshot(catalog, laneRecords, options = {}) {
  if (!catalog || !Array.isArray(catalog.checklists)) throw new Error('invalid Tracker catalog');
  const payloads = {};
  const sourceLanes = [];
  for (const lane of EXPECTED_LANES) {
    const record = laneRecords.find((candidate) => candidate.lane === lane);
    if (!record || !isObject(record.payload)) throw new Error('complete lane payload missing for ' + lane);
    payloads[lane] = record.payload;
    const contentUpdatedAt = record.payload.updatedAt;
    const verifiedAt = record.verifiedAt || record.sourceReadAt || contentUpdatedAt;
    sourceLanes.push({
      lane,
      // `updatedAt` is retained for older consumers, but it is content-edit
      // metadata and must not be used as source-read freshness.
      updatedAt: contentUpdatedAt,
      contentUpdatedAt,
      verifiedAt,
      verificationMethod: record.verificationMethod || 'payload-content-timestamp-fallback',
      stateRevision: record.stateRevision,
    });
  }
  const products = {};
  const lanes = {};
  for (const lane of EXPECTED_LANES) lanes[lane] = { required: 0, owned: 0, missing: 0, productCount: 0 };
  for (const checklist of catalog.checklists) {
    if (!EXPECTED_LANES.includes(checklist.id)) continue;
    const payload = payloads[checklist.id];
    for (const era of checklist.eras || []) {
      for (const item of era.items || []) {
        for (const record of item.pricingProducts || []) {
          validateProductRef(record.ref);
          if (products[record.ref.productId]) throw new Error('duplicate ProductRef ' + record.ref.productId);
          const counts = groupRecord(payload, checklist, item, record);
          const target = counts.target;
          const owned = counts.owned;
          const missing = Math.max(target - owned, 0);
          const requirement = target > 0 ? 'required' : 'optional';
          products[record.ref.productId] = {
            product: JSON.parse(JSON.stringify(record.ref)),
            lane: checklist.id,
            target,
            owned,
            missing,
            requirement,
            status: missing > 0 ? 'missing' : (owned > 0 ? 'owned' : 'target'),
            identitySemantics: counts.identitySemantics,
          };
          const summary = lanes[checklist.id];
          summary.productCount += 1;
          if (requirement === 'required') {
            summary.required += target;
            summary.owned += Math.min(target, owned);
            summary.missing += missing;
          }
        }
      }
    }
  }
  if (Object.keys(products).length !== EXPECTED_PRODUCT_COUNT) {
    throw new Error('catalog must contain exactly ' + EXPECTED_PRODUCT_COUNT + ' ProductRefs');
  }
  const snapshotCore = {
    schema: SCHEMA,
    namespace: 'collection-tracker',
    source: {
      type: 'private-gist-authority',
      completeness: 'all-seven-lanes',
      lanes: sourceLanes,
    },
    lanes,
    wrapperArt: wrapperArtSummary(payloads),
    products,
  };
  // A new authenticated observation of unchanged source content must not churn
  // the collection revision. Verification time is provenance, not collection
  // state, so omit it from the stable revision material.
  const revision = revisionFor({
    ...snapshotCore,
    source: {
      ...snapshotCore.source,
      lanes: sourceLanes.map(({ verifiedAt: _verifiedAt, ...lane }) => lane),
    },
  });
  const generatedAt = options.generatedAt || new Date().toISOString();
  const oldestVerifiedAt = sourceLanes.map((lane) => Date.parse(lane.verifiedAt)).reduce((oldest, value) => Math.min(oldest, value), Infinity);
  const oldestContentUpdatedAt = sourceLanes.map((lane) => Date.parse(lane.contentUpdatedAt)).reduce((oldest, value) => Math.min(oldest, value), Infinity);
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 24 * 60 * 60 * 1000;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const stale = !Number.isFinite(oldestVerifiedAt) || nowMs - oldestVerifiedAt > maxAgeMs;
  const authority = {
    state: stale ? 'stale' : 'fresh',
    consumerStatus: stale ? 'CONDITIONAL' : 'AUTHORITATIVE',
    degradedReasonCodes: stale ? ['COLLECTION_SNAPSHOT_STALE'] : [],
    oldestSourceAt: Number.isFinite(oldestVerifiedAt) ? new Date(oldestVerifiedAt).toISOString() : null,
    oldestVerifiedAt: Number.isFinite(oldestVerifiedAt) ? new Date(oldestVerifiedAt).toISOString() : null,
    oldestContentUpdatedAt: Number.isFinite(oldestContentUpdatedAt) ? new Date(oldestContentUpdatedAt).toISOString() : null,
    maxAgeMs,
  };
  return {
    schema: RESPONSE_SCHEMA,
    generatedAt,
    revision,
    authority,
    snapshot: { ...snapshotCore, generatedAt, revision, authority },
  };
}

function validateSnapshotResponse(response) {
  if (!isObject(response) || response.schema !== RESPONSE_SCHEMA) throw new Error('unsupported snapshot response schema');
  if (!isObject(response.snapshot) || response.snapshot.schema !== SCHEMA) throw new Error('unsupported collection snapshot schema');
  if (response.snapshot.revision !== response.revision || !/^[0-9a-f]{64}$/.test(response.revision || '')) {
    throw new Error('invalid collection snapshot revision');
  }
  if (!isObject(response.snapshot.products) || Object.keys(response.snapshot.products).length !== EXPECTED_PRODUCT_COUNT) {
    throw new Error('incomplete collection snapshot ProductRef catalog');
  }
  for (const lane of EXPECTED_LANES) if (!isObject(response.snapshot.lanes[lane])) throw new Error('collection snapshot lane missing: ' + lane);
  if (!['AUTHORITATIVE', 'CONDITIONAL'].includes(response.authority && response.authority.consumerStatus)) {
    throw new Error('invalid collection authority status');
  }
  return response;
}

module.exports = {
  SCHEMA, RESPONSE_SCHEMA, EXPECTED_LANES, EXPECTED_PRODUCT_COUNT,
  stableJson, revisionFor, buildSnapshot, validateSnapshotResponse,
};
