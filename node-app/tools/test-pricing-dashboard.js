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

function createContext(search, initialData = { checklists: [] }) {
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
  const context = vm.createContext({
    console, window, location: { search }, URL, URLSearchParams, Map, Date,
    setTimeout, clearTimeout,
    contentHash: value => '0123456789abcdef',
    renderContent: () => {},
    closeMenus: () => {},
    toast: message => notices.push(message),
    slotRequired: slot => slot.r !== false,
    groupedSlots,
    groupTarget: group => group.items.filter(entry => entry.sl.r !== false).length,
    slotQuantity,
    ownedForGroup,
    itemComplete: (checklistId, item) => !!item.complete,
    DATA: initialData, active: '',
    save: () => { ownership.persistWrites += 1; },
    document: { getElementById: () => null },
  });
  vm.runInContext(source, context);
  return {
    context, parent, posted, notices, ownership, slotId, groupId,
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
  snapshotBridge.listener()({ origin, source: snapshotBridge.parent, data: { ...snapshotMessage, requestId: 'collection-2' } });
  assert.strictEqual(snapshotBridge.posted.length, 2, 'a later request must receive a newly computed snapshot');
  const refreshedSnapshot = snapshotBridge.posted[1].message.result;
  assert.strictEqual(refreshedSnapshot.products[prerelease.record.ref.productId].owned, 3,
    'request-time snapshots must observe named-variant quantity changes');
  assert.strictEqual(refreshedSnapshot.products[optional.record.ref.productId].owned, 2,
    'request-time snapshots must observe optional inventory changes');

  snapshotBridge.context.invalidCatalog = { checklists: [{ id: 'bad', eras: [{ items: [{ name: 'Bad', code: 'BAD', slots: [{ g: 'Display' }],
    pricingProducts: [{ slotGroup: 'Missing group', ref: product }] }] }] }] };
  vm.runInContext('DATA=invalidCatalog', snapshotBridge.context);
  assert.throws(() => vm.runInContext('buildCollectionSnapshot()', snapshotBridge.context), /maps to 0 ownership groups/,
    'unmapped pricing products must fail loudly instead of disappearing');

  bridge.context.testProduct = product;
  bridge.context.live = {
    apiVersion: 1, schema: 'tcg.valuation/v1', engineVersion: '2.34.0', product,
    observedAt: new Date().toISOString(), market: { value: 123, confidence: 'high' },
    lowestAsk: { landedPrice: 119, url: 'https://example.com/ask' },
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
  assert.strictEqual(vm.runInContext('pricingDefaultState().code', standalone.context), 'MISSING_EXTENSION');
  assert.strictEqual(vm.runInContext('pricingConsumerOrigin', standalone.context), '', 'full-page dashboard must not invent a consumer origin');

  assert.doesNotMatch(html, /tcgCompsApiToken|apiToken\s*:/, 'generated dashboard must contain no pricing capability token field');
  assert.match(html, /Live value/);
  assert.match(html, /Lowest verified ask/);
  assert.match(html, /Confidence/);
  assert.match(html, /Static fallback/);
  assert.match(html, /id="priceRefreshBtn"/, 'toolbar refresh menu must be generated');
  assert.match(html, /rowpricebtn/, 'each priced row must generate a refresh icon');
  assert.match(html, /PRICING_BATCH_CONCURRENCY=4/, 'bulk refresh must use a bounded queue');
  console.log('pricing dashboard tests: exact pricing bridge, 686-product collection snapshot, batch scopes, and watch gate passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
