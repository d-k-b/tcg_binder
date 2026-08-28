#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const binderData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'binder_data.json'), 'utf8'));
const begin = html.indexOf('/* ---- TCG Comps pricing bridge ----');
const endMarker = '/* ---- end TCG Comps pricing bridge ---- */';
const end = html.indexOf(endMarker, begin);
assert.ok(begin >= 0 && end > begin, 'generated pricing bridge section must exist');
const source = html.slice(begin, end + endMarker.length);

function nodeText(node) {
  if (!node || typeof node !== 'object') return '';
  return String(node.textContent || '') + (node.childNodes || []).map(nodeText).join('');
}

function findNodes(node, predicate, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (predicate(node)) found.push(node);
  (node.childNodes || []).forEach(child => findNodes(child, predicate, found));
  return found;
}

function createContext(search, initialData = { checklists: [] }, options = {}) {
  const posted = [];
  const listeners = {};
  const notices = [];
  const ownership = { slots: Object.create(null), groupExtras: Object.create(null), persistWrites: 0 };
  const slotId = (checklistId, item, slotIndex) => [checklistId, item.code || item.name, slotIndex].join('|');
  const groupId = (checklistId, item, group) => [checklistId, item.code || item.name, group].join('|');
  const displayGroupFor = (item, slot) => item.slots.length > 1 && item.slots.every(candidate => /^Kid\s+\d+$/i.test(candidate.g || candidate.l || ''))
    ? 'Copies' : (slot.g || slot.l || '');
  const groupedSlots = item => {
    const groups = [];
    item.slots.forEach((slot, slotIndex) => {
      const name = displayGroupFor(item, slot);
      let group = groups.find(candidate => candidate.n === name);
      if (!group) { group = { n: name, k: slot.k || name, items: [] }; groups.push(group); }
      group.items.push({ sl: slot, si: slotIndex });
    });
    return groups;
  };
  const slotQuantity = (checklistId, item, slotIndex) => Number(ownership.slots[slotId(checklistId, item, slotIndex)] || 0);
  const ownedForGroup = (checklistId, item, group) => group.items.reduce((total, entry) => total + slotQuantity(checklistId, item, entry.si), 0)
    + Number(ownership.groupExtras[groupId(checklistId, item, group.k || group.n)] || 0);
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  const window = {
    parent,
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
  };
  const monitorDefaults = { enabled: true, maxMarketRatio: 0.8, minimumConfidence: 'medium',
    sources: ['ebay', 'tcgplayer', 'heritage', 'store'], includeOptional: false,
    instantFixedPriceEmail: true,
    dailyDigest: { enabled: true, time: '07:00', timezone: 'America/Chicago' } };
  const normalizeMonitorPreferences = input => JSON.parse(JSON.stringify(input || monitorDefaults));
  const storage = new Map();
  if (options.restSettings) storage.set('tcgDashboardPricingRest_v1', JSON.stringify(options.restSettings));
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const restCalls = [];
  const makeNode = tagName => ({
    tagName: String(tagName || '').toUpperCase(), childNodes: [], textContent: '', className: '',
    appendChild(node) { this.childNodes.push(node); return node; },
    setAttribute(name, value) { this[name] = String(value); },
  });
  const document = {
    getElementById: () => null,
    createElement: makeNode,
    createTextNode: value => ({ nodeType: 3, textContent: String(value), childNodes: [] }),
  };
  const TCGPricingRestClient = {
    normalizeBaseUrl: value => String(value || '').replace(/\/$/, ''),
    createClient: config => ({ priceProduct: async (target, priceOptions) => {
      restCalls.push({ config, target, options: priceOptions });
      if (options.restError) throw Object.assign(new Error(options.restError.message), { code: options.restError.code });
      return options.restResult || { apiVersion: 1, schema: 'tcg.valuation/v1', requestId: priceOptions.requestId,
        product: target, observedAt: new Date().toISOString(), market: { value: 123, confidence: 'high' }, lowestAsk: null };
    } })
  };
  const hash = value => {
    let h = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index++) {
      h ^= BigInt(value.charCodeAt(index));
      h = BigInt.asUintN(64, h * 0x100000001b3n);
    }
    return h.toString(16).padStart(16, '0');
  };
  const context = vm.createContext({
    console, window, location: { search }, URL, URLSearchParams, Map, Date, localStorage, TCGPricingRestClient,
    setTimeout, clearTimeout,
    contentHash: hash, normalizeMonitorPreferences,
    state: { monitorPreferences: JSON.parse(JSON.stringify(monitorDefaults)) },
    renderContent: () => {},
    closeMenus: () => {},
    toast: message => notices.push(message),
    slotRequired: slot => slot.r !== false,
    groupedSlots,
    groupTarget: group => group.items.filter(entry => entry.sl.r !== false).length,
    slotQuantity,
    ownedForGroup,
    itemComplete: (checklistId, item) => !!item.complete,
    DATA: initialData, WRAPPER_ART_CATALOG: { sets: [{ setCode: 'TST', setName: 'Test Set', artworks: [
      { id: 'TST-1', label: 'Art 1', imageUrl: '', imageStatus: 'pending' },
    ] }] }, active: '',
    save: () => { ownership.persistWrites += 1; },
    document,
  });
  vm.runInContext(source, context);
  return {
    context, parent, posted, notices, ownership, slotId, groupId, storage, restCalls,
    listener: () => event => (listeners.message || []).forEach(listener => listener(event)),
  };
}

const product = {
  schema: 'tcg.product/v1', productId: 'mtg:woe:wilds-of-eldraine:prerelease-kit:kit:en',
  game: 'mtg', setCode: 'WOE', setName: 'Wilds of Eldraine',
  productName: 'Wilds of Eldraine Prerelease Pack', productType: 'prerelease_kit',
  unit: 'kit', language: 'en', variant: null,
};

(async () => {
  const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bridge = createContext('?pricingConsumerOrigin=' + encodeURIComponent(origin));
  const pending = vm.runInContext(`pricingRequest('priceProduct',{target:${JSON.stringify(product)}})`, bridge.context);
  assert.strictEqual(bridge.posted.length, 1, 'dashboard must post exactly one request');
  assert.strictEqual(bridge.posted[0].origin, origin, 'dashboard must use the exact extension target origin');
  assert.notStrictEqual(bridge.posted[0].origin, '*', 'wildcard target origins are forbidden');

  const request = bridge.posted[0].message;
  const response = { channel: 'tcg-pricing/v1', type: 'priceProductResult', requestId: request.requestId, result: { ok: true } };
  bridge.listener()({ origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: bridge.parent, data: response });
  assert.strictEqual(vm.runInContext('pricingPending.size', bridge.context), 1, 'wrong origins must be ignored');
  bridge.listener()({ origin, source: {}, data: response });
  assert.strictEqual(vm.runInContext('pricingPending.size', bridge.context), 1, 'wrong frames must be ignored');
  bridge.listener()({ origin, source: bridge.parent, data: response });
  assert.deepStrictEqual(await pending, { ok: true }, 'exact origin and exact parent frame may resolve the request');

  const snapshotBridge = createContext('?pricingConsumerOrigin=' + encodeURIComponent(origin), binderData);
  const snapshotMessage = { channel: 'tcg-collection/v1', type: 'collectionSnapshot', requestId: 'collection-1' };
  snapshotBridge.listener()({ origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: snapshotBridge.parent, data: snapshotMessage });
  snapshotBridge.listener()({ origin, source: {}, data: snapshotMessage });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...snapshotMessage, channel: 'tcg-pricing/v1' } });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...snapshotMessage, type: 'wrongType' } });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...snapshotMessage, requestId: '' } });
  assert.strictEqual(snapshotBridge.posted.length, 0, 'wrong origin, frame, channel, type, and requestId must be ignored');
  const ownershipBefore = JSON.stringify(snapshotBridge.ownership);
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: snapshotMessage });
  assert.strictEqual(snapshotBridge.posted.length, 1, 'an exact collection request must receive one response');
  assert.strictEqual(snapshotBridge.posted[0].origin, origin, 'collection responses must use the exact extension origin');
  assert.notStrictEqual(snapshotBridge.posted[0].origin, '*', 'collection responses must never use a wildcard origin');
  const snapshotResponse = snapshotBridge.posted[0].message;
  assert.strictEqual(snapshotResponse.channel, 'tcg-collection/v1');
  assert.strictEqual(snapshotResponse.type, 'collectionSnapshotResult');
  assert.strictEqual(snapshotResponse.requestId, snapshotMessage.requestId);
  assert.ok(snapshotResponse.result && !snapshotResponse.error, 'valid catalog must return a snapshot result');
  const snapshot = JSON.parse(JSON.stringify(snapshotResponse.result));
  const snapshotEntries = Object.entries(snapshot.products);
  assert.strictEqual(snapshot.schema, 'tcg.collection-snapshot/v2');
  assert.strictEqual(snapshot.namespace, 'collection-tracker');
  assert.strictEqual(snapshotEntries.length, 686, 'snapshot must atomically include all 686 Tracker products');
  assert.strictEqual(new Set(snapshotEntries.map(([productId]) => productId)).size, 686, 'snapshot ProductRefs must be unique');
  snapshotEntries.forEach(([productId, entry]) => {
    assert.deepStrictEqual(Object.keys(entry).sort(), ['missing', 'owned', 'product', 'requirement', 'status', 'target']);
    assert.deepStrictEqual(Object.keys(entry.product).sort(),
      ['game', 'language', 'productId', 'productName', 'productType', 'schema', 'setCode', 'setName', 'unit', 'variant']);
    assert.strictEqual(entry.product.schema, 'tcg.product/v1');
    assert.strictEqual(entry.product.productId, productId);
    assert.ok(entry.product.game && entry.product.setName && entry.product.productName && entry.product.productType && entry.product.unit && entry.product.language,
      productId + ' must carry a full ProductRef');
    assert.ok(Number.isInteger(entry.target) && Number.isInteger(entry.owned) && Number.isInteger(entry.missing));
  });
  assert.deepStrictEqual(Object.keys(snapshot).sort(), ['namespace', 'products', 'schema']);
  const snapshotJson = JSON.stringify(snapshot);
  assert.doesNotMatch(snapshotJson, /checklist\|v2|ghp_|"(?:checks|extras|legacyChecksV1|legacyChecks|keyVersion|github|gist|gistId|apiToken|capability|watch|valuation|pricingStates|price)"\s*:/i,
    'collection snapshots must contain ProductRefs and ownership counts only');
  assert.strictEqual(JSON.stringify(snapshotBridge.ownership), ownershipBefore, 'snapshot generation must not mutate ownership state');
  assert.strictEqual(snapshotBridge.ownership.persistWrites, 0, 'snapshot generation must not persist state');

  const firstSubscription = JSON.parse(JSON.stringify(vm.runInContext('buildMonitorSubscription()', snapshotBridge.context)));
  const repeatSubscription = JSON.parse(JSON.stringify(vm.runInContext('buildMonitorSubscription()', snapshotBridge.context)));
  assert.strictEqual(firstSubscription.schema, 'tcg.collection-monitor-subscription/v1');
  assert.strictEqual(firstSubscription.namespace, 'collection-tracker');
  assert.deepStrictEqual(firstSubscription.preferences, {
    enabled: true, maxMarketRatio: 0.8, minimumConfidence: 'medium',
    sources: ['ebay', 'tcgplayer', 'heritage', 'store'], includeOptional: false,
    instantFixedPriceEmail: true,
    dailyDigest: { enabled: true, time: '07:00', timezone: 'America/Chicago' },
  }, 'monitor subscription must use the conservative contract defaults');
  assert.strictEqual(firstSubscription.revision, repeatSubscription.revision,
    'generatedAt alone must not change the deterministic monitor revision');
  assert.ok(/^[0-9a-f]{16}$/.test(firstSubscription.revision), 'monitor revision must be a stable content hash');
  assert.ok(!Number.isNaN(Date.parse(firstSubscription.generatedAt)), 'monitor bundle must carry a valid generatedAt timestamp');
  assert.strictEqual(Object.keys(firstSubscription.collection.products).length, 686,
    'monitor subscription must atomically carry all 686 collection ProductRefs');
  assert.deepStrictEqual(firstSubscription.collection, snapshot,
    'monitor subscription must reuse the authoritative collection snapshot schema and ownership mapping');
  const monitorJson = JSON.stringify(firstSubscription);
  assert.doesNotMatch(monitorJson, /checklist\|v2|ghp_|"(?:checks|extras|legacyChecksV1|legacyChecks|keyVersion|github|gist|gistId|apiToken|capability|watch|valuation|pricingStates|price|email|token)"\s*:/i,
    'monitor subscriptions must contain no collection keys, Gist/GitHub/provider credentials, pricing, watches, or email');
  assert.strictEqual(JSON.stringify(snapshotBridge.ownership), ownershipBefore,
    'monitor subscription generation must not mutate ownership');
  assert.strictEqual(snapshotBridge.ownership.persistWrites, 0,
    'monitor subscription generation must not persist state');

  const monitorRequest = { channel: 'tcg-collection-monitor/v1', type: 'monitorSubscription', requestId: 'monitor-1' };
  const postedBeforeMonitor = snapshotBridge.posted.length;
  snapshotBridge.listener()({ origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: snapshotBridge.parent, data: monitorRequest });
  snapshotBridge.listener()({ origin, source: {}, data: monitorRequest });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...monitorRequest, channel: 'tcg-collection/v1' } });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...monitorRequest, type: 'wrongType' } });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...monitorRequest, requestId: '' } });
  assert.strictEqual(snapshotBridge.posted.length, postedBeforeMonitor,
    'monitor bundle requests with a wrong origin, frame, channel, type, or requestId must be ignored');
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: monitorRequest });
  const monitorResponse = snapshotBridge.posted.at(-1);
  assert.strictEqual(monitorResponse.origin, origin, 'monitor bundle responses must use the exact extension origin');
  assert.deepStrictEqual({ channel: monitorResponse.message.channel, type: monitorResponse.message.type,
    requestId: monitorResponse.message.requestId, schema: monitorResponse.message.result.schema }, {
    channel: 'tcg-collection-monitor/v1', type: 'monitorSubscriptionResult', requestId: 'monitor-1',
    schema: 'tcg.collection-monitor-subscription/v1',
  }, 'exact monitor requests must receive the versioned subscription result envelope');

  const catalogRecords = [];
  binderData.checklists.forEach(checklist => checklist.eras.forEach(era => era.items.forEach(item =>
    (item.pricingProducts || []).forEach(record => catalogRecords.push({ checklist, item, record })))));
  const groupForRecord = catalogRecord => {
    const { item, record } = catalogRecord;
    const copies = item.slots.length > 1 && item.slots.every(slot => /^Kid\s+\d+$/i.test(slot.g || slot.l || ''));
    const groupName = slot => copies ? 'Copies' : (slot.g || slot.l || '');
    return item.slots.map((slot, slotIndex) => ({ slot, slotIndex })).filter(entry => groupName(entry.slot) === record.slotGroup);
  };
  const required = catalogRecords.find(candidate => candidate.checklist.id === 'collector');
  const optional = catalogRecords.find(candidate => !Object.prototype.hasOwnProperty.call(candidate.record, 'slotOrdinal') &&
    groupForRecord(candidate).length && groupForRecord(candidate).every(entry => entry.slot.r === false));
  const pack = catalogRecords.find(candidate => candidate.checklist.id === 'packs' && candidate.record.slotGroup === 'Booster');
  const lorcana = catalogRecords.find(candidate => candidate.checklist.id === 'lorcana' && candidate.record.slotGroup === 'Copies');
  const prerelease = catalogRecords.find(candidate => candidate.checklist.id === 'prerelease' && Number.isInteger(candidate.record.slotOrdinal));
  assert.ok(required && optional && pack && lorcana && prerelease, 'catalog fixtures for every ownership mode must exist');
  const firstEntry = catalogRecord => snapshot.products[catalogRecord.record.ref.productId];
  assert.deepStrictEqual({ target: firstEntry(required).target, owned: firstEntry(required).owned, missing: firstEntry(required).missing,
    requirement: firstEntry(required).requirement, status: firstEntry(required).status },
  { target: 1, owned: 0, missing: 1, requirement: 'required', status: 'missing' }, 'required unowned products must be missing');
  assert.deepStrictEqual({ target: firstEntry(optional).target, owned: firstEntry(optional).owned, missing: firstEntry(optional).missing,
    requirement: firstEntry(optional).requirement, status: firstEntry(optional).status },
  { target: 0, owned: 0, missing: 0, requirement: 'optional', status: 'target' }, 'optional unowned products must remain targets');
  assert.strictEqual(firstEntry(pack).target, 2, 'MTG booster pack products must retain target two');
  assert.strictEqual(firstEntry(lorcana).target, 2, 'Lorcana Copies products must retain target two');
  assert.strictEqual(firstEntry(prerelease).target, 1, 'named prerelease variants must map to one exact required slot');

  const setSlotQuantity = (catalogRecord, slotIndex, quantity) => {
    snapshotBridge.ownership.slots[snapshotBridge.slotId(catalogRecord.checklist.id, catalogRecord.item, slotIndex)] = quantity;
  };
  setSlotQuantity(required, groupForRecord(required)[0].slotIndex, 1);
  const optionalSlot = groupForRecord(optional)[0];
  setSlotQuantity(optional, optionalSlot.slotIndex, 1);
  snapshotBridge.ownership.groupExtras[snapshotBridge.groupId(optional.checklist.id, optional.item,
    optionalSlot.slot.k || optional.record.slotGroup)] = 1;
  const packSlots = groupForRecord(pack);
  setSlotQuantity(pack, packSlots[0].slotIndex, 1);
  setSlotQuantity(pack, packSlots[1].slotIndex, 1);
  snapshotBridge.ownership.groupExtras[snapshotBridge.groupId(pack.checklist.id, pack.item,
    packSlots[0].slot.k || pack.record.slotGroup)] = 2;
  groupForRecord(lorcana).forEach(entry => setSlotQuantity(lorcana, entry.slotIndex, 1));
  setSlotQuantity(prerelease, prerelease.record.slotOrdinal, 3);
  const changedSnapshot = JSON.parse(JSON.stringify(vm.runInContext('buildCollectionSnapshot()', snapshotBridge.context)));
  const changedEntry = catalogRecord => changedSnapshot.products[catalogRecord.record.ref.productId];
  assert.deepStrictEqual({ target: changedEntry(required).target, owned: changedEntry(required).owned, missing: changedEntry(required).missing,
    requirement: changedEntry(required).requirement, status: changedEntry(required).status },
  { target: 1, owned: 1, missing: 0, requirement: 'required', status: 'owned' }, 'required owned products must be owned');
  assert.deepStrictEqual({ target: changedEntry(optional).target, owned: changedEntry(optional).owned, missing: changedEntry(optional).missing,
    requirement: changedEntry(optional).requirement, status: changedEntry(optional).status },
  { target: 0, owned: 2, missing: 0, requirement: 'optional', status: 'owned' }, 'optional ownership must retain quantities above zero');
  assert.strictEqual(changedEntry(pack).owned, 4, 'pack quantities above target must remain represented');
  assert.strictEqual(changedEntry(pack).missing, 0);
  assert.strictEqual(changedEntry(lorcana).owned, 2, 'Lorcana Copies must sum both child slots');
  assert.strictEqual(changedEntry(prerelease).owned, 3, 'named prerelease duplicates must remain on their exact variant');
  assert.strictEqual(changedEntry(prerelease).missing, 0);
  assert.strictEqual(snapshotBridge.ownership.persistWrites, 0, 'updated snapshot reads must remain persistence-free');
  assert.strictEqual(firstEntry(required).owned, 0, 'previous snapshots must remain immutable after ownership changes');
  const collectionResponsesBefore=snapshotBridge.posted.filter(entry=>entry.message.type==='collectionSnapshotResult').length;
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...snapshotMessage, requestId: 'collection-2' } });
  const collectionResponses=snapshotBridge.posted.filter(entry=>entry.message.type==='collectionSnapshotResult');
  assert.strictEqual(collectionResponses.length, collectionResponsesBefore+1,
    'a later collection request must receive exactly one newly computed snapshot despite concurrent monitor traffic');
  const refreshedSnapshot = collectionResponses.at(-1).message.result;
  assert.strictEqual(refreshedSnapshot.products[prerelease.record.ref.productId].owned, 3,
    'request-time snapshots must observe named-variant quantity changes');
  assert.strictEqual(refreshedSnapshot.products[optional.record.ref.productId].owned, 2,
    'request-time snapshots must observe optional inventory changes');

  const ownershipChangedSubscription = JSON.parse(JSON.stringify(vm.runInContext('buildMonitorSubscription()', snapshotBridge.context)));
  assert.notStrictEqual(ownershipChangedSubscription.revision, firstSubscription.revision,
    'an ownership quantity change must create a new monitor subscription revision');
  const ownershipRevision = ownershipChangedSubscription.revision;
  vm.runInContext(`state.monitorPreferences=Object.assign({},state.monitorPreferences,{includeOptional:true})`, snapshotBridge.context);
  const preferenceChangedSubscription = JSON.parse(JSON.stringify(vm.runInContext('buildMonitorSubscription()', snapshotBridge.context)));
  assert.notStrictEqual(preferenceChangedSubscription.revision, ownershipRevision,
    'a normalized preference change must create a new monitor subscription revision');
  assert.strictEqual(preferenceChangedSubscription.preferences.includeOptional, true);
  assert.strictEqual(snapshotBridge.ownership.persistWrites, 0,
    'ownership and preference revision builds must remain read-only');

  const statusRequest = { channel: 'tcg-collection-monitor/v1', type: 'monitorSyncStatus', requestId: 'status-1', status: {
    schema: 'tcg.collection-monitor-sync-status/v1', state: 'synced', revision: preferenceChangedSubscription.revision,
    productCount: 686, activeTargetCount: 321, monitorConfigured: true,
    syncedAt: '2026-08-09T12:00:01.000Z', message: 'Monitor accepted the current collection.', errorCode: null,
  } };
  const postedBeforeStatus = snapshotBridge.posted.length;
  snapshotBridge.listener()({ origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', source: snapshotBridge.parent, data: statusRequest });
  snapshotBridge.listener()({ origin, source: {}, data: statusRequest });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...statusRequest, requestId: '' } });
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...statusRequest,
    status: { ...statusRequest.status, schema: 'wrong' } } });
  assert.strictEqual(snapshotBridge.posted.length, postedBeforeStatus,
    'wrong-origin/frame/requestId/schema monitor statuses must be ignored and unacknowledged');
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: statusRequest });
  const statusResponse = snapshotBridge.posted.at(-1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(statusResponse.message)), {
    channel: 'tcg-collection-monitor/v1', type: 'monitorSyncStatusResult', requestId: 'status-1',
    result: { schema: 'tcg.collection-monitor-sync-status-ack/v1', accepted: true },
  }, 'valid memory-only monitor status must receive the exact versioned acknowledgement');
  assert.strictEqual(statusResponse.origin, origin, 'monitor status acknowledgement must target the exact extension origin');
  assert.strictEqual(vm.runInContext('monitorSyncStatus.state', snapshotBridge.context), 'synced');
  assert.strictEqual(vm.runInContext('monitorSyncStatus.activeTargetCount', snapshotBridge.context), 321);
  assert.strictEqual(snapshotBridge.ownership.persistWrites, 0, 'painting monitor status must never persist dashboard state');

  const postedBeforeHint = snapshotBridge.posted.length;
  vm.runInContext('scheduleMonitorStateChanged();scheduleMonitorStateChanged()', snapshotBridge.context);
  await new Promise(resolve => setTimeout(resolve, 425));
  const hints = snapshotBridge.posted.slice(postedBeforeHint);
  assert.strictEqual(hints.length, 1, 'rapid state changes must debounce to one monitorStateChanged hint');
  assert.strictEqual(hints[0].origin, origin, 'monitor state-change hints must use the exact extension origin');
  assert.deepStrictEqual(Object.keys(hints[0].message).sort(), ['channel', 'requestId', 'type']);
  assert.strictEqual(hints[0].message.channel, 'tcg-collection-monitor/v1');
  assert.strictEqual(hints[0].message.type, 'monitorStateChanged');
  assert.ok(/^monitor-change-/.test(hints[0].message.requestId));
  assert.doesNotMatch(JSON.stringify(hints[0].message), /products|preferences|checklist|credential|token|gist/i,
    'state-change hints must contain no snapshot, preferences, keys, or credentials');

  snapshotBridge.context.invalidCatalog = { checklists: [{ id: 'bad', eras: [{ items: [{ name: 'Bad', code: 'BAD', slots: [{ g: 'Display' }],
    pricingProducts: [{ slotGroup: 'Missing group', ref: product }] }] }] }] };
  vm.runInContext('DATA=invalidCatalog', snapshotBridge.context);
  assert.throws(() => vm.runInContext('buildCollectionSnapshot()', snapshotBridge.context), /maps to 0 ownership groups/,
    'unmapped pricing products must fail loudly instead of disappearing');

  bridge.context.testProduct = product;
  bridge.context.live = {
    apiVersion: 1, schema: 'tcg.valuation/v1', engineVersion: '2.43.40', product,
    observedAt: new Date().toISOString(), market: { value: 123, confidence: 'high' },
    lowestAsk: { landedPrice: 119, url: 'https://example.com/ask' },
    lowestAuction: {
      source: 'ebay', listingId: 'auction-1', title: 'Exact sealed auction',
      price: 82, currentBid: 82, shipping: 8, shippingKnown: true,
      landedPrice: 90, url: 'https://example.com/auction', confidence: 'high',
      verified: true, verifiedBy: 'ai', verificationReason: 'Exact sealed product',
      bidCount: 4, uniqueBidderCount: 3, endTime: '2026-08-29T20:00:00.000Z',
      buyingOptions: ['AUCTION'],
    },
  };
  assert.strictEqual(vm.runInContext('interpretPriceResponse(testProduct,live).status', bridge.context), 'success');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'NO_VERIFIED_PRICE',message:'none'}}).status`, bridge.context), 'unavailable');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'UNAUTHORIZED',message:'denied'}}).status`, bridge.context), 'error');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:2}).code`, bridge.context), 'UNSUPPORTED_VERSION');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,Object.assign({},live,{product:Object.assign({},testProduct,{productId:'wrong'})})).code`, bridge.context), 'PRODUCT_MISMATCH');
  assert.strictEqual(vm.runInContext(`pricingCanWatch(interpretPriceResponse(testProduct,live),testProduct)`, bridge.context), true,
    'exact successful pricing must enable watch controls');
  assert.strictEqual(vm.runInContext(`pricingCanWatch(interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'NO_VERIFIED_PRICE'}}),testProduct)`, bridge.context), false,
    'no-price responses must not enable watch controls');

  const auctionView = JSON.parse(JSON.stringify(vm.runInContext('pricingAuctionView(live)', bridge.context)));
  assert.deepStrictEqual(auctionView, {
    landedPrice: 90, currentBid: 82, shipping: 8, endTime: '2026-08-29T20:00:00.000Z',
    bidCount: 4, uniqueBidderCount: 3, url: 'https://example.com/auction',
  }, 'provider-qualified auction fields must remain a separate, display-only view');
  const auctionNode = vm.runInContext('renderPricingAuction(live)', bridge.context);
  assert.strictEqual(auctionNode.className, 'priceauction');
  const auctionText = nodeText(auctionNode);
  ['Current auction bid', 'Landed price:', '$90.00', 'Current bid:', '$82.00', 'Known shipping:', '$8.00',
    'Ends:', 'Bids:', '4', 'Unique bidders:', '3', 'Current bid — provisional; not the final sale price.']
    .forEach(label => assert.ok(auctionText.includes(label), 'auction block must render ' + label));
  const auctionLinks = findNodes(auctionNode, node => node.tagName === 'A');
  assert.strictEqual(auctionLinks.length, 1);
  assert.strictEqual(auctionLinks[0].href, 'https://example.com/auction');
  assert.strictEqual(auctionLinks[0].rel, 'noopener noreferrer');

  assert.strictEqual(vm.runInContext(`renderPricingAuction(Object.assign({},live,{lowestAuction:null}))`, bridge.context), null,
    'null lowestAuction must omit the optional block without becoming an error');
  assert.strictEqual(vm.runInContext(`renderPricingAuction(Object.assign({},live,{lowestAuction:null,verifiedAuctions:[live.lowestAuction]}))`, bridge.context), null,
    'verified auction candidates alone must never enter the qualified auction presentation');
  const sparseAuction = vm.runInContext(`renderPricingAuction(Object.assign({},live,{lowestAuction:{landedPrice:75,currentBid:null,shippingKnown:false,endTime:null,bidCount:null,uniqueBidderCount:null,url:null}}))`, bridge.context);
  assert.ok(nodeText(sparseAuction).includes('Landed price: $75.00'));
  assert.ok(!nodeText(sparseAuction).includes('Current bid:'), 'missing optional auction fields must not display as zero');
  const unsafeAuction = vm.runInContext(`renderPricingAuction(Object.assign({},live,{lowestAuction:Object.assign({},live.lowestAuction,{url:'http://unsafe.example/auction'})}))`, bridge.context);
  assert.strictEqual(findNodes(unsafeAuction, node => node.tagName === 'A').length, 0,
    'unsafe auction URLs must render no listing link');
  assert.strictEqual(vm.runInContext(`renderPricingAuction(Object.assign({},live,{cache:{mode:'stale-fallback'}}))`, bridge.context), null,
    'stale-fallback valuations must suppress auction presentation');
  assert.strictEqual(vm.runInContext(`pricingIsStale(Object.assign({},live,{cache:{mode:'stale-fallback'}}))`, bridge.context), true,
    'stale-fallback valuations must be labeled stale explicitly');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext(`watchRule(testProduct,99.5).threshold`, bridge.context))),
    { maxLandedPrice: 99.5, maxUnitPrice: null, maxMarketRatio: null },
    'auction data must not change verified Buy Now watch thresholds');
  assert.doesNotMatch(vm.runInContext('watchRule.toString()', bridge.context), /lowestAuction|verifiedAuctions|currentBid/,
    'auction fields must never enter watch eligibility or watch rules');

  vm.runInContext(`pricingStates.set('other-product',{status:'success',marker:'unchanged'})`, bridge.context);
  const refresh = vm.runInContext('refreshPrice(testProduct)', bridge.context);
  const refreshRequest = bridge.posted[1].message;
  bridge.listener()({ origin, source: bridge.parent, data: {
    channel: 'tcg-pricing/v1', type: 'priceProductResult', requestId: refreshRequest.requestId,
    result: bridge.context.live,
  } });
  await refresh;
  assert.strictEqual(vm.runInContext('pricingStates.get(testProduct.productId).status', bridge.context), 'success');
  assert.strictEqual(vm.runInContext(`pricingStates.get('other-product').marker`, bridge.context), 'unchanged',
    'a successful response must update only the requested product');

  const batchProduct = { ...product, productId: 'mtg:woe:wilds-of-eldraine:set-booster:pack:en',
    productName: 'Wilds of Eldraine Set Booster Pack', productType: 'set_booster', unit: 'pack' };
  const bonusProduct = { ...product, productId: 'mtg:woe:wilds-of-eldraine:theme-booster:display:en',
    productName: 'Wilds of Eldraine Theme Booster Display', productType: 'theme_booster', unit: 'display' };
  const batchBridge = createContext('?pricingConsumerOrigin=' + encodeURIComponent(origin));
  batchBridge.context.testChecklist = { id: 'test', eras: [{ items: [
    { name: 'Incomplete', complete: false, slots: [{ r: true }], pricingProducts: [{ ref: product }] },
    { name: 'Complete', complete: true, slots: [{ r: true }], pricingProducts: [{ ref: batchProduct }] },
    { name: 'Bonus only', complete: false, slots: [{ r: false }], pricingProducts: [{ ref: bonusProduct }] },
  ] }] };
  vm.runInContext(`DATA={checklists:[testChecklist]};active='test'`, batchBridge.context);
  const unfinishedBatch = vm.runInContext(`startPricingRefresh('unfinished')`, batchBridge.context);
  assert.deepStrictEqual(batchBridge.posted.map(entry => entry.message.target.productId), [product.productId],
    'unfinished refresh must exclude completed and bonus-only rows');
  const unfinishedRequest = batchBridge.posted[0].message;
  batchBridge.listener()({ origin, source: batchBridge.parent, data: {
    channel: 'tcg-pricing/v1', type: 'priceProductResult', requestId: unfinishedRequest.requestId,
    result: { ...bridge.context.live, product },
  } });
  assert.strictEqual(await unfinishedBatch, true, 'unfinished refresh must finish successfully');

  const allBridge = createContext('?pricingConsumerOrigin=' + encodeURIComponent(origin));
  allBridge.context.testChecklist = batchBridge.context.testChecklist;
  vm.runInContext(`DATA={checklists:[testChecklist]};active='test'`, allBridge.context);
  const allBatch = vm.runInContext(`startPricingRefresh('all')`, allBridge.context);
  assert.deepStrictEqual(allBridge.posted.map(entry => entry.message.target.productId).sort(),
    [product.productId, batchProduct.productId, bonusProduct.productId].sort(),
    'all refresh must include every priced row, including complete and bonus-only rows');
  for (const entry of allBridge.posted) {
    allBridge.listener()({ origin, source: allBridge.parent, data: {
      channel: 'tcg-pricing/v1', type: 'priceProductResult', requestId: entry.message.requestId,
      result: { ...bridge.context.live, product: entry.message.target },
    } });
  }
  assert.strictEqual(await allBatch, true, 'all-item refresh must finish successfully');

  const unavailableBatch = createContext('');
  unavailableBatch.context.testChecklist = batchBridge.context.testChecklist;
  vm.runInContext(`DATA={checklists:[testChecklist]};active='test'`, unavailableBatch.context);
  assert.strictEqual(await vm.runInContext(`startPricingRefresh('all')`, unavailableBatch.context), false,
    'batch refresh must remain unavailable outside the paired extension');
  assert.strictEqual(unavailableBatch.posted.length, 0, 'missing-extension batch must send no requests');

  const standalone = createContext('');
  assert.strictEqual(vm.runInContext('pricingDefaultState().code', standalone.context), 'PRICING_NOT_CONFIGURED');
  assert.strictEqual(vm.runInContext('pricingConsumerOrigin', standalone.context), '', 'full-page dashboard must not invent a consumer origin');
  vm.runInContext('emitMonitorStateChanged()', standalone.context);
  assert.strictEqual(standalone.posted.length, 0, 'standalone dashboards must never emit monitor bridge messages');

  const restSettings = { schema: 'tcg.dashboard-pricing-rest-settings/v1', baseUrl: 'https://pricing.example.test',
    accessToken: 'tcg_price_test_0123456789abcdef0123456789abcdef', savedAt: '2026-08-28T12:00:00.000Z' };
  const rest = createContext('', { checklists: [] }, { restSettings, restResult: bridge.context.live });
  assert.strictEqual(vm.runInContext('pricingTransport()', rest.context), 'rest');
  const restValuation = await vm.runInContext(`pricingRequest('priceProduct',{target:${JSON.stringify(product)},options:{includeActive:true,includeRecentSales:true,userInitiated:true,include130point:true}})`, rest.context);
  assert.strictEqual(restValuation.product.productId, product.productId);
  assert.strictEqual(rest.posted.length, 0, 'REST pricing must not leak its key through postMessage');
  assert.strictEqual(rest.restCalls.length, 1);
  assert.strictEqual(rest.restCalls[0].config.accessToken, restSettings.accessToken);
  assert.strictEqual(rest.restCalls[0].options.requestId.startsWith('tracker-'), true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(vm.runInContext(`pricingAuctionView(${JSON.stringify(restValuation)})`, rest.context))), auctionView,
    'standalone REST and extension bridge valuations must expose identical additive auction fields');
  assert.strictEqual(vm.runInContext(`pricingCanWatch(interpretPriceResponse(${JSON.stringify(product)},${JSON.stringify(restValuation)}),${JSON.stringify(product)})`, rest.context), false,
    'REST-only pricing must not expose extension-owned watch controls');
  const exportedState = JSON.stringify(vm.runInContext('state', rest.context));
  assert.ok(!exportedState.includes(restSettings.accessToken), 'REST access keys must remain outside collection state');

  assert.doesNotMatch(html, /tcgCompsApiToken|apiToken\s*:/, 'generated dashboard must contain no extension pricing capability token field');
  assert.match(html, /id="pricingSettingsModal"/);
  assert.match(html, /id="dashboardPricingAccessToken" type="password"/);
  assert.match(html, /tcgDashboardPricingRest_v1/);
  assert.match(html, /Live value/);
  assert.match(html, /Buy Now low/);
  assert.match(html, /Current auction bid/);
  assert.match(html, /Current bid — provisional; not the final sale price\./);
  assert.match(html, /Alert when verified Buy Now landed price ≤ \$/);
  assert.match(html, /className='priceauction'/, 'qualified auctions must render as a separate compact block');
  assert.match(html, /Confidence/);
  assert.match(html, /Static fallback/);
  assert.match(html, /id="priceRefreshBtn"/, 'toolbar refresh menu must be generated');
  assert.match(html, /rowpricebtn/, 'each priced row must generate a refresh icon');
  assert.match(html, /PRICING_BATCH_CONCURRENCY=4/, 'bulk refresh must use a bounded queue');
  assert.match(html, /id="monitorModal"/, 'generator must emit the monitoring preferences dialog');
  assert.match(html, /id="monitorDiscount"/, 'monitoring UI must expose the Market discount threshold');
  assert.match(html, /data-monitor-source="ebay"/, 'monitoring UI must expose the contract source choices');
  assert.match(html, /@media\(max-width:480px\)[\s\S]*\.monitor-grid\{grid-template-columns:1fr\}/,
    'monitoring preferences must collapse to one column at narrow side-panel widths');
  console.log('pricing dashboard tests: exact bridges, deterministic 686-product subscription, Buy Now/watch isolation, and provisional auction presentation passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
