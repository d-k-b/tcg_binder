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
  const storage = options.storage || new Map();
  if (options.restSettings) storage.set('tcgDashboardPricingRest_v1', JSON.stringify(options.restSettings));
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const restCalls = [];
  const makeNode = tagName => ({
    tagName: String(tagName || '').toUpperCase(), childNodes: [], textContent: '', className: '',
    appendChild(node) { this.childNodes.push(node); return node; },
    setAttribute(name, value) { this[name] = String(value); },
    classList: { add() {}, toggle() {} },
  });
  const document = {
    getElementById: () => null,
    createElement: makeNode,
    createTextNode: value => ({ nodeType: 3, textContent: String(value), childNodes: [] }),
  };
  const TCGPricingRestClient = {
    normalizeBaseUrl: value => String(value || '').replace(/\/$/, ''),
    createClient: config => ({ priceProduct: async (target, priceOptions) => {
      restCalls.push({ kind: 'priceProduct', config, target, options: priceOptions });
      if (options.restError) throw Object.assign(new Error(options.restError.message), { code: options.restError.code });
      return options.restResult || { apiVersion: 1, schema: 'tcg.valuation/v1', requestId: priceOptions.requestId,
        product: target, observedAt: new Date().toISOString(), market: { value: 123, confidence: 'high' }, lowestAsk: null };
    }, diagnostics: async (target, diagnosticsOptions) => {
      restCalls.push({ kind: 'diagnostics', config, target, options: diagnosticsOptions });
      if (options.diagnosticsError) throw Object.assign(new Error(options.diagnosticsError.message), { code: options.diagnosticsError.code });
      return options.diagnosticsResult || { apiVersion: 1, schema: 'tcg.pricing-diagnostics/v1',
        requestId: diagnosticsOptions.requestId, productId: target.productId, checkedAt: new Date().toISOString(),
        marketState: 'market-pending', latestSales: {}, analyzerHandoff: {}, retryBackoff: {} };
    }, priceViaBrowser: async (target, browserOptions) => {
      restCalls.push({ kind: 'browserPrice', config, target, options: browserOptions });
      if (options.browserError) throw Object.assign(new Error(options.browserError.message || 'raw provider detail must not survive'), { code: options.browserError.code });
      return options.browserResult || { apiVersion: 1, schema: 'tcg.valuation/v1', requestId: browserOptions.requestId,
        product: target, observedAt: new Date().toISOString(), market: { value: 125, confidence: 'high' }, lowestAsk: null,
        browserExecution: { schema: 'tcg.browser-comp-evidence/v1', mode: 'interactive-extension', completedAt: new Date().toISOString() } };
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
  assert.strictEqual(snapshotEntries.length, 688, 'snapshot must atomically include all 688 Tracker products');
  assert.strictEqual(new Set(snapshotEntries.map(([productId]) => productId)).size, 688, 'snapshot ProductRefs must be unique');
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
  assert.strictEqual(Object.keys(firstSubscription.collection.products).length, 688,
    'monitor subscription must atomically carry all 688 collection ProductRefs');
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
    productCount: 688, activeTargetCount: 321, monitorConfigured: true,
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
  const cacheStorage = new Map();
  const cacheData = { checklists: [{ id: 'cache-test', eras: [{ items: [{ name: 'Cached product', code: 'WOE', slots: [],
    pricingProducts: [{ label: 'Cached exact product', ref: product }] }] }] }] };
  const cacheWriter = createContext('', cacheData, { storage: cacheStorage });
  cacheWriter.context.cacheProduct = product;
  cacheWriter.context.cacheLive = {
    apiVersion: 1, schema: 'tcg.valuation/v1', requestId: 'must-not-persist', engineVersion: '2.43.54', product,
    observedAt: new Date().toISOString(), market: { value: 123, confidence: 'high', method: 'theil-sen-recent-sales',
      sampleSize: 12, monthlyTrendPct: 2.2, stability: { trendUsed: true, sourceSpreadPct: 2.5, trendDeltaPct: 1.86,
        jackknife: { spreadPct: 4.34, rawRows: ['never'] }, trendProjection: 999999, compSetHash: 'private-hash' } },
    lowestAsk: { landedPrice: 119, url: 'https://example.com/ask', rawEvidence: 'must-not-persist' },
    lowestAuction: { landedPrice: 90, currentBid: 82, shippingKnown: true, shipping: 8,
      endTime: '2099-08-29T20:00:00.000Z', bidCount: 4, uniqueBidderCount: 3, url: 'https://example.com/auction',
      verificationReason: 'raw provider detail must not persist' },
    sources: { tcgplayer: { catalogReferenceMarket: { value: 987654.32, verified: false }, raw: 'must-not-persist' } },
    recentSales: [{ price: 123, raw: 'must-not-persist' }], verifiedAsks: [{ landedPrice: 119 }],
  };
  vm.runInContext("cacheState=Object.assign({},interpretPriceResponse(cacheProduct,cacheLive));pricingStates.set(cacheProduct.productId,cacheState);cachePricingState(cacheProduct,cacheState)", cacheWriter.context);
  const pricingCacheRaw = cacheStorage.get('tcgDashboardPricingCache_v1');
  assert.ok(pricingCacheRaw, 'a successful exact valuation must create the separate device-local pricing cache');
  const pricingCache = JSON.parse(pricingCacheRaw);
  assert.strictEqual(pricingCache.schema, 'tcg.dashboard-pricing-cache/v1');
  assert.deepStrictEqual(Object.keys(pricingCache.products), [product.productId]);
  assert.strictEqual(pricingCache.products[product.productId].valuation.market.value, 123);
  assert.strictEqual(pricingCache.products[product.productId].valuation.lowestAsk.landedPrice, 119);
  assert.strictEqual(pricingCache.products[product.productId].valuation.lowestAuction.landedPrice, 90);
  assert.deepStrictEqual(pricingCache.products[product.productId].valuation.sources,
    { tcgplayer: { catalogReferenceMarket: { available: true } } },
    'the cache may retain only the existence of a review-only catalog reference, never its amount');
  assert.doesNotMatch(pricingCacheRaw, /must-not-persist|987654|999999|private-hash|requestId|recentSales|verifiedAsks|rawEvidence|verificationReason|trendProjection|compSetHash/,
    'device pricing cache must exclude raw provider evidence, review-only values, held-out projections, and request details');
  assert.doesNotMatch(pricingCacheRaw, /accessToken|Bearer|ghp_|checklist\|v2|checks|extras|ordered|legacyChecks|gist|diagnostics|watch/i,
    'device pricing cache must exclude credentials, collection/Gist state, diagnostics, and watches');
  assert.strictEqual(cacheWriter.ownership.persistWrites, 0, 'saving pricing must not persist collection state');

  const cacheReader = createContext('?pricingConsumerOrigin=' + encodeURIComponent(origin), cacheData, { storage: cacheStorage });
  cacheReader.context.cacheProduct = product;
  const reloadedPrice = JSON.parse(JSON.stringify(vm.runInContext('pricingStates.get(cacheProduct.productId)', cacheReader.context)));
  assert.strictEqual(reloadedPrice.status, 'success');
  assert.strictEqual(reloadedPrice.cachedOnDevice, true);
  assert.strictEqual(reloadedPrice.valuation.product.productId, product.productId);
  assert.strictEqual(reloadedPrice.valuation.market.value, 123);
  assert.strictEqual(reloadedPrice.valuation.lowestAsk.landedPrice, 119);
  assert.strictEqual(vm.runInContext('pricingCanWatch(pricingStates.get(cacheProduct.productId),cacheProduct)', cacheReader.context), false,
    'a locally reloaded price must not enable privileged extension watches until a live exact response succeeds in this page session');
  const cachedCardText = nodeText(vm.runInContext("renderPricingList([{label:'Cached product',ref:cacheProduct}])", cacheReader.context));
  assert.ok(cachedCardText.includes('Saved live refresh:'), 'reloaded values must be labeled as saved device-local observations');
  assert.ok(cachedCardText.includes('Live value: $123.00') && cachedCardText.includes('Buy Now low: $119.00'),
    'Market and Buy Now values must survive a full page-context reload');
  const cachedHeader = JSON.parse(JSON.stringify(vm.runInContext("pricingItemMarketSummary({pricingProducts:[{label:'Cached product',ref:cacheProduct}]})", cacheReader.context)));
  assert.strictEqual(cachedHeader.text, '$123.00', 'the compact row headline must use the reloaded verified Market instead of its static fallback');
  assert.strictEqual(cacheReader.ownership.persistWrites, 0, 'loading pricing must not persist or mutate collection state');

  assert.strictEqual(vm.runInContext('interpretPriceResponse(testProduct,live).status', bridge.context), 'success');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'NO_VERIFIED_PRICE',message:'none'}}).status`, bridge.context), 'unavailable');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'UNAUTHORIZED',message:'denied'}}).status`, bridge.context), 'error');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,{apiVersion:2}).code`, bridge.context), 'UNSUPPORTED_VERSION');
  assert.strictEqual(vm.runInContext(`interpretPriceResponse(testProduct,Object.assign({},live,{product:Object.assign({},testProduct,{productId:'wrong'})})).code`, bridge.context), 'PRODUCT_MISMATCH');
  assert.strictEqual(vm.runInContext(`pricingCanWatch(interpretPriceResponse(testProduct,live),testProduct)`, bridge.context), true,
    'exact successful pricing must enable watch controls');
  assert.strictEqual(vm.runInContext(`pricingCanWatch(interpretPriceResponse(testProduct,{apiVersion:1,error:{code:'NO_VERIFIED_PRICE'}}),testProduct)`, bridge.context), false,
    'no-price responses must not enable watch controls');
  bridge.context.pendingOnly = {
    ...bridge.context.live, market: null, lowestAsk: null, marketPending: true,
    sources: { tcgplayer: { catalogReferenceMarket: { value: 987654.32, verified: false, actionable: false } } },
  };
  bridge.context.pendingAsk = {
    ...bridge.context.pendingOnly, lowestAsk: { landedPrice: 119, url: 'https://example.com/ask' },
  };
  assert.strictEqual(vm.runInContext('interpretPriceResponse(testProduct,pendingOnly).status', bridge.context), 'pending',
    'an exact marketPending-only valuation must remain a distinct non-error state');
  assert.strictEqual(vm.runInContext('interpretPriceResponse(testProduct,pendingAsk).status', bridge.context), 'success',
    'a verified Buy Now ask must remain usable while recent-sale Market is pending');
  assert.strictEqual(vm.runInContext('pricingCanWatch(interpretPriceResponse(testProduct,pendingOnly),testProduct)', bridge.context), false,
    'marketPending and a catalog reference alone must never enable watches');
  assert.strictEqual(vm.runInContext('pricingCanWatch(interpretPriceResponse(testProduct,pendingAsk),testProduct)', bridge.context), true,
    'the extension watch may use a finite verified Buy Now landed price while Market remains pending');
  assert.strictEqual(vm.runInContext('pricingCanWatch(interpretPriceResponse(testProduct,Object.assign({},live,{lowestAsk:null})),testProduct)', bridge.context), false,
    'watch eligibility must require a finite verified Buy Now landed price');
  assert.strictEqual(vm.runInContext("pricingCanWatch(interpretPriceResponse(testProduct,Object.assign({},live,{cache:{mode:'stale-fallback'}})),testProduct)", bridge.context), false,
    'stale fallback must never enable watch controls');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,pendingOnly)))", bridge.context);
  const pendingOnlyNode = vm.runInContext("renderPricingList([{label:'Pending product',ref:testProduct}])", bridge.context);
  const pendingOnlyText = nodeText(pendingOnlyNode);
  assert.ok(pendingOnlyText.includes('Market pending'));
  assert.ok(pendingOnlyText.includes('Live source refresh completed; verified recent-sale Market is still pending.'),
    'a successful refresh with no verified recent-sale Market must say that live refresh completed');
  assert.ok(pendingOnlyText.includes('unverified catalog reference'));
  assert.ok(!pendingOnlyText.includes('$987,654.32') && !pendingOnlyText.includes('987654.32'),
    'review-only catalogReferenceMarket amounts must never be rendered');
  assert.ok(!pendingOnlyText.includes('Live value: Unavailable'),
    'Market pending must not masquerade as a failed Live value');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,pendingAsk)))", bridge.context);
  const pendingAskText = nodeText(vm.runInContext("renderPricingList([{label:'Pending with ask',ref:testProduct}])", bridge.context));
  assert.ok(pendingAskText.includes('Market pending') && pendingAskText.includes('Buy Now low: $119.00'),
    'Market pending plus a verified ask must render both states separately');

  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,live)))", bridge.context);
  bridge.context.headerItem = { value: '~$450', pricingProducts: [
    { label: 'Exact Booster Display', staticValue: '~$450', ref: product },
  ] };
  const headerMarket = JSON.parse(JSON.stringify(vm.runInContext('pricingItemMarketSummary(headerItem)', bridge.context)));
  assert.strictEqual(headerMarket.text, '$123.00',
    'a fresh exact Analyzer Market must replace the static value in the compact row summary');
  assert.strictEqual(headerMarket.freshness.state, 'fresh');
  assert.ok(headerMarket.title.includes('Market fresh ·') && headerMarket.title.includes('Exact Booster Display'),
    'the compact live value must identify its freshness and exact priced product in its tooltip');
  assert.match(html, /const headlinePrice=pricingItemMarketSummary\(it\)/,
    'generated row rendering must consume the live Market summary instead of always rendering it.value');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,Object.assign({},live,{cache:{mode:'stale-fallback'}}))))", bridge.context);
  const staleHeader = JSON.parse(JSON.stringify(vm.runInContext('pricingItemMarketSummary(headerItem)', bridge.context)));
  assert.strictEqual(staleHeader.text, '$123.00');
  assert.strictEqual(staleHeader.freshness.state, 'stale',
    'a cached Analyzer Market may remain visible only with an explicit stale red state');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,pendingOnly)))", bridge.context);
  assert.strictEqual(vm.runInContext('pricingItemMarketSummary(headerItem)', bridge.context), null,
    'Market-pending responses must leave the row header fallback unchanged');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,live)))", bridge.context);
  bridge.context.secondProduct = Object.assign({}, product, { productId: product.productId + ':second', productName: 'Second display' });
  bridge.context.multiHeaderItem = { pricingProducts: [
    { label: 'First display', staticValue: null, ref: product },
    { label: 'Second display', staticValue: null, ref: bridge.context.secondProduct },
  ] };
  vm.runInContext("pricingStates.set(secondProduct.productId,Object.assign({},interpretPriceResponse(secondProduct,Object.assign({},live,{product:secondProduct,market:{value:175,confidence:'high'}}))))", bridge.context);
  const headerRange = JSON.parse(JSON.stringify(vm.runInContext('pricingItemMarketSummary(multiHeaderItem)', bridge.context)));
  assert.strictEqual(headerRange.text, '$123.00–$175.00',
    'rows with several refreshed products and no primary static product must show a truthful compact Market range');
  assert.ok(headerRange.title.includes('2 refreshed products'));

  bridge.context.freshnessNow = Date.parse('2026-08-29T12:00:00.000Z');
  bridge.context.stableTrend = Object.assign({}, bridge.context.live, {
    observedAt: '2026-08-09T12:00:00.000Z',
    market: { value: 123, method: 'theil-sen-recent-sales', monthlyTrendPct: 2.2, sampleSize: 12, confidence: 'high', stability: {
      trendUsed: true, sourceSpreadPct: 2.5, trendDeltaPct: 1.86, jackknife: { spreadPct: 4.34 },
      trendProjection: 999999.99, compSetHash: 'never-render-this', suppressionReasons: ['raw provider reason'],
    } },
  });
  const stableFreshness = JSON.parse(JSON.stringify(vm.runInContext('pricingFreshness(stableTrend,freshnessNow)', bridge.context)));
  assert.deepStrictEqual({ state: stableFreshness.state, monthlyRiskPct: stableFreshness.monthlyRiskPct, basis: stableFreshness.basis,
    sampleText: stableFreshness.sampleText },
    { state: 'fresh', monthlyRiskPct: 4.34, basis: 'Stable recent-sales trend', sampleText: '12 verified sales' },
    'a stable trend must remain green for weeks using the largest bounded drift signal');
  assert.deepStrictEqual({ target: stableFreshness.targetText, green: stableFreshness.greenText, red: stableFreshness.redText },
    { target: '28d', green: '35d', red: '55d' },
    'the stable evidence must expose useful 4%, 5%, and 8% horizons rather than an arbitrary short TTL');
  assert.doesNotMatch(JSON.stringify(stableFreshness), /999999|never-render-this|raw provider reason|trendProjection|compSetHash|suppressionReasons/,
    'freshness output must exclude held-out dollars and raw stability internals');
  bridge.context.volatileMarket = Object.assign({}, bridge.context.stableTrend, {
    observedAt: '2026-08-09T12:00:00.000Z',
    market: Object.assign({}, bridge.context.stableTrend.market, { method: 'venue-balanced-median', stability: {
      trendUsed: false, sourceSpreadPct: 18, trendDeltaPct: 14, jackknife: { spreadPct: 11 }, trendProjection: 888888.88,
    } }),
  });
  const volatileFreshness = JSON.parse(JSON.stringify(vm.runInContext('pricingFreshness(volatileMarket,freshnessNow)', bridge.context)));
  assert.strictEqual(volatileFreshness.state, 'stale');
  assert.strictEqual(volatileFreshness.monthlyRiskPct, 18,
    'volatile evidence must use its largest bounded spread as the conservative monthly drift signal');
  assert.deepStrictEqual({ target: volatileFreshness.targetText, green: volatileFreshness.greenText, red: volatileFreshness.redText },
    { target: '7d', green: '8d', red: '13d' },
    'volatile evidence must age materially sooner than stable evidence, but in days rather than hours');
  assert.strictEqual(volatileFreshness.trendHeldOut, 'Trend held out by stability checks · 14% difference.');
  bridge.context.consensusMarket = Object.assign({}, bridge.context.stableTrend, {
    observedAt: '2026-08-28T06:00:00.000Z',
    market: Object.assign({}, bridge.context.stableTrend.market, { method: 'venue-balanced-median', stability: {
      trendUsed: false, sourceSpreadPct: 5, trendDeltaPct: 6, jackknife: { spreadPct: 5 },
    } }),
  });
  const consensusFreshness = JSON.parse(JSON.stringify(vm.runInContext('pricingFreshness(consensusMarket,freshnessNow)', bridge.context)));
  assert.deepStrictEqual({ state: consensusFreshness.state, monthlyRiskPct: consensusFreshness.monthlyRiskPct, basis: consensusFreshness.basis },
    { state: 'fresh', monthlyRiskPct: 6, basis: 'Stable venue consensus' });
  bridge.context.medianMarket = Object.assign({}, bridge.context.stableTrend, {
    observedAt: '2026-07-29T12:00:00.000Z',
    market: { value: 123, method: 'median-recent-sales', sampleSize: 8, confidence: 'high' },
  });
  const medianFreshness = JSON.parse(JSON.stringify(vm.runInContext('pricingFreshness(medianMarket,freshnessNow)', bridge.context)));
  assert.deepStrictEqual({ state: medianFreshness.state, monthlyRiskPct: medianFreshness.monthlyRiskPct, basis: medianFreshness.basis },
    { state: 'aging', monthlyRiskPct: 5, basis: 'Recent-sales median' });
  bridge.context.malformedStability = Object.assign({}, bridge.context.medianMarket, {
    market: { value: 123, method: 'unknown-provider-text', sampleSize: 9999, confidence: 'unexpected', stability: {
      trendUsed: true, sourceSpreadPct: 'secret', trendDeltaPct: -1, jackknife: { spreadPct: 5000 }, arbitrary: 'do-not-render',
    } },
  });
  const malformedFreshness = JSON.parse(JSON.stringify(vm.runInContext('pricingFreshness(malformedStability,freshnessNow)', bridge.context)));
  assert.strictEqual(malformedFreshness.monthlyRiskPct, 8);
  assert.strictEqual(malformedFreshness.basis, '');
  assert.strictEqual(malformedFreshness.sampleText, '');
  assert.doesNotMatch(JSON.stringify(malformedFreshness), /unknown-provider-text|secret|do-not-render/,
    'malformed or unknown stability data must be ignored rather than echoed');

  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,stableTrend)))", bridge.context);
  const stableCardText = nodeText(vm.runInContext("renderPricingList([{label:'Stable product',ref:testProduct}])", bridge.context));
  assert.ok(stableCardText.includes('Market basis: Stable recent-sales trend'));
  assert.ok(stableCardText.includes('Evidence: 12 verified sales'));
  assert.ok(stableCardText.includes('Freshness: Market fresh'));
  assert.ok(stableCardText.includes('4% horizon: 28d after refresh'));
  assert.ok(stableCardText.includes('Drift signal: 4.3% / month'));
  assert.ok(stableCardText.includes('Color thresholds: Green <5% · red ≥8%'));
  assert.ok(!stableCardText.includes('$999,999.99') && !stableCardText.includes('never-render-this') && !stableCardText.includes('raw provider reason'));
  vm.runInContext('schedulePricingFreshnessRepaint()', bridge.context);
  assert.strictEqual(vm.runInContext('pricingFreshnessTimer!==null', bridge.context), true,
    'a visible non-stale Market must schedule its next green/amber/red transition while the page stays open');
  vm.runInContext('clearTimeout(pricingFreshnessTimer);pricingFreshnessTimer=null', bridge.context);
  assert.doesNotMatch(vm.runInContext('pricingCanWatch.toString()', bridge.context), /stability|trendProjection|freshness/i,
    'freshness evidence must not change watch eligibility');
  assert.doesNotMatch(vm.runInContext('watchRule.toString()+buildMonitorSubscription.toString()', bridge.context), /stability|trendProjection|freshness/i,
    'freshness evidence must not enter watch thresholds or monitor subscriptions');
  assert.doesNotMatch(JSON.stringify(bridge.context.state), /never-render-this|999999|trendProjection|freshness/i,
    'freshness evidence must remain outside persisted dashboard and Gist state');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,live)))", bridge.context);
  const liveResultText = nodeText(vm.runInContext("renderPricingList([{label:'Fresh live product',ref:testProduct}])", bridge.context));
  assert.ok(liveResultText.includes('Live sources refreshed:'),
    'current results must label the provider observation as a live-source refresh');
  assert.ok(!liveResultText.includes('Cached observation:'),
    'current results must not use the stale-fallback timestamp label');
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,Object.assign({},live,{cache:{mode:'stale-fallback'}}))))", bridge.context);
  const staleResultText = nodeText(vm.runInContext("renderPricingList([{label:'Stale product',ref:testProduct}])", bridge.context));
  assert.ok(staleResultText.includes('Cached observation:'),
    'stale-fallback results must identify their timestamp as a cached observation');
  assert.ok(!staleResultText.includes('Live sources refreshed:'),
    'stale-fallback results must never be labeled as freshly checked');

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
  assert.strictEqual(vm.runInContext('pricingStates.get(testProduct.productId).message', bridge.context),
    'Refreshing verified sales and live asks…',
    'the in-flight state must explain that current verified sales and asks are being refreshed');
  const refreshRequest = bridge.posted[1].message;
  assert.strictEqual(refreshRequest.options.includeActive, true);
  assert.strictEqual(refreshRequest.options.includeRecentSales, true);
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

  const browserResult = {
    ...bridge.context.live, requestId: 'provider-browser-result',
    browserExecution: {
      schema: 'tcg.browser-comp-evidence/v1', mode: 'interactive-extension', jobId: 'browser-secret-job-id',
      requestedAt: '2026-08-29T18:00:00.000Z', startedAt: '2026-08-29T18:00:01.000Z', completedAt: '2026-08-29T18:00:20.000Z',
      sources: { point130: { count: 8, rawEvidence: 'must-not-survive' }, usableComps: 12 }, unexpected: 'must-not-survive'
    }
  };
  const browserRest = createContext('', { checklists: [] }, { restSettings, browserResult });
  browserRest.context.testProduct = product;
  browserRest.context.browserResult = browserResult;
  vm.runInContext(`dashboardPricingReadiness={status:'ready',message:'',browserAgentAvailable:true,browserAgentLastSeenAt:'2026-08-29T18:00:00.000Z',browserPriceRoute:'/v1/browser-price'}`, browserRest.context);
  const browserReady = JSON.parse(JSON.stringify(vm.runInContext('browserCompsAvailability()', browserRest.context)));
  assert.strictEqual(browserReady.enabled, true);
  assert.ok(browserReady.message.includes('browser agent is online'));
  let browserRendered = vm.runInContext("renderPricingList([{label:'Browser product',ref:testProduct}])", browserRest.context);
  let browserButtons = findNodes(browserRendered, node => node.tagName === 'BUTTON' && node.textContent === 'Run full browser comps');
  assert.strictEqual(browserButtons.length, 1, 'expanded REST pricing must expose one secondary manual browser action');
  assert.strictEqual(browserRest.restCalls.length, 0, 'rendering must never start browser pricing automatically');
  const firstBrowserRun = browserButtons[0].onclick();
  const duplicateBrowserRun = browserButtons[0].onclick();
  assert.strictEqual(browserRest.restCalls.length, 1, 'one direct click must submit exactly one browser pricing request');
  assert.strictEqual(vm.runInContext('pricingStates.get(testProduct.productId).browserBusy', browserRest.context), true,
    'the row must retain a distinct slower browser-pricing busy state');
  assert.strictEqual(await duplicateBrowserRun, false, 'a second click while pending must be gated');
  assert.strictEqual(await firstBrowserRun, true);
  assert.strictEqual(browserRest.restCalls[0].kind, 'browserPrice');
  assert.strictEqual(browserRest.restCalls[0].target.productId, product.productId);
  assert.deepStrictEqual({ includeActive: browserRest.restCalls[0].options.includeActive, includePackOut: browserRest.restCalls[0].options.includePackOut },
    { includeActive: true, includePackOut: true });
  assert.ok(browserRest.restCalls[0].options.requestId.startsWith('tracker-browser-'));
  const browserState = JSON.parse(JSON.stringify(vm.runInContext('pricingStates.get(testProduct.productId)', browserRest.context)));
  assert.strictEqual(browserState.status, 'success');
  assert.strictEqual(vm.runInContext('pricingCanWatch(pricingStates.get(testProduct.productId),testProduct)', browserRest.context), false,
    'manual browser comps must not create or enable extension-owned watch controls');
  assert.deepStrictEqual(browserState.browserSource, {
    schema: 'tcg.browser-comp-evidence/v1', mode: 'interactive-extension', completedAt: '2026-08-29T18:00:20.000Z'
  }, 'only bounded browser provenance may enter memory-only row state');
  assert.deepStrictEqual(browserState.valuation.browserExecution, browserState.browserSource,
    'raw browser evidence and job metadata must be stripped before rendering');
  assert.doesNotMatch(JSON.stringify(browserState), /browser-secret-job-id|must-not-survive|rawEvidence|usableComps/);
  assert.ok(!JSON.stringify(browserState).includes(restSettings.accessToken));
  browserRendered = vm.runInContext("renderPricingList([{label:'Browser product',ref:testProduct}])", browserRest.context);
  const browserText = nodeText(browserRendered);
  assert.ok(browserText.includes('Full browser comps'));
  assert.ok(browserText.includes('Full browser comps refreshed:'));

  const browserVariants = [
    ['api version', { ...browserResult, apiVersion: '1' }, 'UNSUPPORTED_VERSION'],
    ['valuation schema', { ...browserResult, schema: 'tcg.other/v1' }, 'PRODUCT_MISMATCH'],
    ['ProductRef', { ...browserResult, product: { ...product, productId: 'mtg:wrong:product:display:en' } }, 'PRODUCT_MISMATCH'],
    ['provenance schema', { ...browserResult, browserExecution: { ...browserResult.browserExecution, schema: 'tcg.other/v1' } }, 'INVALID_BROWSER_PROVENANCE'],
    ['provenance mode', { ...browserResult, browserExecution: { ...browserResult.browserExecution, mode: 'headless' } }, 'INVALID_BROWSER_PROVENANCE'],
  ];
  browserVariants.forEach(([label, result, code]) => {
    browserRest.context.invalidBrowserResult = result;
    assert.strictEqual(vm.runInContext('interpretBrowserPriceResponse(testProduct,invalidBrowserResult).code', browserRest.context), code,
      'full browser comps must fail closed on wrong ' + label);
  });
  vm.runInContext(`dashboardPricingReadiness={status:'ready',message:'',browserAgentAvailable:false,browserAgentLastSeenAt:'2026-08-29T17:00:00.000Z',browserPriceRoute:'/v1/browser-price'}`, browserRest.context);
  const browserOffline = JSON.parse(JSON.stringify(vm.runInContext('browserCompsAvailability()', browserRest.context)));
  assert.strictEqual(browserOffline.enabled, false);
  assert.ok(browserOffline.message.includes('offline') && browserOffline.message.includes('Last seen'));
  vm.runInContext(`dashboardPricingReadiness={status:'ready',message:'',browserAgentAvailable:true,browserAgentLastSeenAt:null,browserPriceRoute:null}`, browserRest.context);
  assert.strictEqual(vm.runInContext('browserCompsAvailability().enabled', browserRest.context), false,
    'missing or rejected browserPriceRoute readiness must disable the manual route');

  const extensionBrowserUi = vm.runInContext("renderPricingList([{label:'Extension product',ref:testProduct}])", bridge.context);
  const extensionBrowserButton = findNodes(extensionBrowserUi, node => node.tagName === 'BUTTON' && node.textContent === 'Run full browser comps');
  assert.strictEqual(extensionBrowserButton.length, 1);
  assert.strictEqual(extensionBrowserButton[0].disabled, true, 'extension-only transport must not invent a browser-pricing bridge');
  assert.ok(nodeText(extensionBrowserUi).includes('Configure Pricing REST to run full browser comps.'));

  for (const errorCode of ['BROWSER_AGENT_OFFLINE', 'BROWSER_JOB_TIMEOUT', 'BROWSER_QUEUE_FULL', 'BROWSER_QUEUE_UNAVAILABLE',
    'BROWSER_JOB_NOT_FOUND', 'BROWSER_ANALYSIS_FAILED']) {
    const failedBrowser = createContext('', { checklists: [] }, { restSettings,
      browserError: { code: errorCode, message: 'Bearer secret raw provider failure must not survive' } });
    failedBrowser.context.testProduct = product;
    failedBrowser.context.priorValuation = bridge.context.live;
    vm.runInContext("pricingStates.set(testProduct.productId,{status:'success',valuation:priorValuation,marker:'preserve-me'})", failedBrowser.context);
    assert.strictEqual(await vm.runInContext('refreshFullBrowserComps(testProduct)', failedBrowser.context), false);
    const failedState = JSON.parse(JSON.stringify(vm.runInContext('pricingStates.get(testProduct.productId)', failedBrowser.context)));
    assert.strictEqual(failedState.status, 'success', errorCode + ' must preserve prior valuation status');
    assert.strictEqual(failedState.marker, 'preserve-me');
    assert.strictEqual(failedState.valuation.product.productId, product.productId);
    assert.strictEqual(failedState.browserErrorCode, errorCode);
    assert.ok(failedState.browserMessage.includes('previous price is unchanged'));
    assert.doesNotMatch(failedState.browserMessage, /Bearer|secret|raw provider/i);
    assert.deepStrictEqual(failedBrowser.restCalls.map(call => call.kind), ['browserPrice'],
      errorCode + ' must not fall back to headless priceProduct');
  }

  assert.doesNotMatch(vm.runInContext('refreshPrice.toString()', browserRest.context), /priceViaBrowser|browserPricingRequest/,
    'ordinary row refresh must remain on priceProduct');
  assert.doesNotMatch(vm.runInContext('startPricingRefresh.toString()', browserRest.context), /priceViaBrowser|browserPricingRequest|refreshFullBrowserComps/,
    'batch refresh must never invoke full browser comps');
  assert.doesNotMatch(vm.runInContext('runWatchAction.toString()', browserRest.context), /priceViaBrowser|browserPricingRequest|refreshFullBrowserComps/,
    'watch actions must never invoke full browser comps');
  assert.doesNotMatch(html, /set(?:Interval|Timeout)\([^)]*refreshFullBrowserComps/,
    'timers must never invoke full browser comps');

  const diagnosticsResult = {
    apiVersion: 1, schema: 'tcg.pricing-diagnostics/v1', requestId: 'provider-correlated', productId: product.productId,
    checkedAt: '2026-08-28T19:00:00.000Z', marketState: 'market-pending',
    latestSales: { endpointStatus: 'error', httpStatus: 403, recentSaleCount: 0,
      lastSuccessAt: null, fallbackReason: 'Latest-sales HTTP 403', warnings: ['Latest-sales HTTP 403'] },
    analyzerHandoff: { status: 'missing', observedAt: null, cacheAgeMs: null, expiresAt: null, recentSaleCount: 0 },
    retryBackoff: { state: 'not-scheduled', nextRetryAt: null, reason: 'Direct Analyzer action required' },
    accessToken: restSettings.accessToken, rawProviderResponse: { secret: 'must-not-survive' },
  };
  const diagnosticsRest = createContext('', { checklists: [] }, { restSettings, restResult: bridge.context.pendingOnly, diagnosticsResult });
  diagnosticsRest.context.testProduct = product;
  diagnosticsRest.context.pendingOnly = bridge.context.pendingOnly;
  vm.runInContext("pricingStates.set(testProduct.productId,Object.assign({},interpretPriceResponse(testProduct,pendingOnly)))", diagnosticsRest.context);
  const beforeDiagnostics = vm.runInContext("renderPricingList([{label:'Pending product',ref:testProduct}])", diagnosticsRest.context);
  const sourceButtons = findNodes(beforeDiagnostics, node => node.tagName === 'BUTTON' && node.textContent === 'Check source health');
  assert.strictEqual(sourceButtons.length, 1, 'pending REST results must offer one explicit source-health action');
  assert.strictEqual(diagnosticsRest.restCalls.length, 0, 'diagnostics must never run automatically while rendering');
  await sourceButtons[0].onclick();
  assert.strictEqual(diagnosticsRest.restCalls.length, 1);
  assert.strictEqual(diagnosticsRest.restCalls[0].kind, 'diagnostics');
  assert.strictEqual(diagnosticsRest.restCalls[0].target.productId, product.productId);
  assert.ok(diagnosticsRest.restCalls[0].options.requestId.startsWith('tracker-'),
    'diagnostics must use a bounded caller-correlated requestId');
  const safeDiagnostics = JSON.parse(JSON.stringify(vm.runInContext('pricingStates.get(testProduct.productId).diagnostics', diagnosticsRest.context)));
  assert.deepStrictEqual(Object.keys(safeDiagnostics).sort(),
    ['analyzerHandoff', 'checkedAt', 'latestSales', 'marketState', 'productId', 'retryBackoff', 'schema']);
  assert.doesNotMatch(JSON.stringify(safeDiagnostics), /must-not-survive|tcg_price_test|accessToken|rawProviderResponse/i,
    'rendered/copied diagnostics must retain only the credential-safe allowlist');
  const diagnosticsRendered = vm.runInContext("renderPricingList([{label:'Pending product',ref:testProduct}])", diagnosticsRest.context);
  const diagnosticsText = nodeText(diagnosticsRendered);
  assert.ok(diagnosticsText.includes('Latest sales: error (HTTP 403)'));
  assert.ok(diagnosticsText.includes('Copy source health'));

  await assert.rejects(() => vm.runInContext("pricingRequest('diagnostics',{target:testProduct})", bridge.context), /standalone Pricing REST/,
    'the extension bridge must not invent a diagnostics method');
  const mismatchDiagnostics = createContext('', { checklists: [] }, { restSettings,
    diagnosticsResult: { ...diagnosticsResult, productId: 'mtg:wrong:product:display:en' } });
  mismatchDiagnostics.context.testProduct = product;
  await assert.rejects(() => vm.runInContext('refreshPricingDiagnostics(testProduct)', mismatchDiagnostics.context), /did not match this exact product/,
    'diagnostics with a wrong ProductRef must fail closed');

  assert.doesNotMatch(html, /tcgCompsApiToken|apiToken\s*:/, 'generated dashboard must contain no extension pricing capability token field');
  assert.match(html, /id="pricingSettingsModal"/);
  assert.match(html, /id="dashboardPricingAccessToken" type="password"/);
  assert.match(html, /tcgDashboardPricingRest_v1/);
  assert.match(html, /Live value/);
  assert.match(html, /Buy Now low/);
  assert.match(html, /Current auction bid/);
  assert.match(html, /Current bid — provisional; not the final sale price\./);
  assert.match(html, /Market pending/);
  assert.match(html, /Refreshing verified sales and live asks…/);
  assert.match(html, /Live sources refreshed/);
  assert.match(html, /Cached observation/);
  assert.match(html, /cached verified history only supplements the result/);
  assert.match(html, /Check source health/);
  assert.match(html, /tcg\.pricing-diagnostics\/v1/);
  assert.match(html, /Run full browser comps/);
  assert.match(html, /Running full browser comps…/);
  assert.match(html, /tcg\.browser-comp-evidence\/v1/);
  assert.match(html, /interactive-extension/);
  assert.match(html, /Configure Pricing REST to run full browser comps/);
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
  console.log('pricing dashboard tests: exact bridges, deterministic 688-product subscription, sanitized reload-safe device cache, adaptive evidence-based freshness, explicit full-browser comps, Market pending, Buy Now/watch isolation, and provisional auction presentation passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
