#!/usr/bin/env node
'use strict';

// Exercises the exact monitor-preference helpers and browser Gist pull/push code
// embedded in the generated dashboard. No network or real credential is used.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const helperStart = html.indexOf("const MONITOR_SOURCE_ORDER=");
const helperEnd = html.indexOf('function migrateState', helperStart);
const gistStart = html.indexOf('const BUILD=', helperEnd);
const gistEnd = html.indexOf('function timeAgo', gistStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart && gistStart > helperEnd && gistEnd > gistStart,
  'generated dashboard monitor/Gist sources must exist');
const source = html.slice(helperStart, helperEnd) + '\n' + html.slice(gistStart, gistEnd);

const collectorKey = 'collector|v2|0123456789abcdef';
const collectorExtra = 'collector|extra|fedcba9876543210';
const wrapperKey1 = 'packs|wrapper-art|4ED-1';
const wrapperKey2 = 'packs|wrapper-art|4ED-2';
let gistStore = {
  gist1: {
    description: 'MTG Binder · MTG Collector Booster Boxes',
    files: {
      'mtg-binder-collector.json': { content: JSON.stringify({
        checklist: 'collector', title: 'MTG Collector Booster Boxes', keyVersion: 2,
        checks: { [collectorKey]: true }, extras: { [collectorExtra]: 2 },
        ordered: { [collectorExtra]: 1 },
        legacyChecksV1: { 'collector|0|0|0': true },
        monitorPreferences: {
          enabled: true, maxMarketRatio: 0.72, minimumConfidence: 'high',
          sources: ['store', 'ebay'], includeOptional: true, instantFixedPriceEmail: false,
          dailyDigest: { enabled: true, time: '08:30', timezone: 'America/Chicago' },
        },
        monitorPreferencesUpdatedAt: '2026-08-09T12:00:00.000Z',
      }) },
    },
  },
  gist2: {
    description: 'MTG Binder · MTG Booster Packs',
    files: {
      'mtg-binder-packs.json': { content: JSON.stringify({
        checklist: 'packs', title: 'MTG Booster Packs', keyVersion: 2,
        checks: {}, extras: {}, ordered: {}, legacyChecksV1: {}, wrapperArts: { [wrapperKey1]: true },
        orderedWrapperArts: { [wrapperKey1]: 2 },
      }) },
    },
  },
};
let calls = [];

function fakeFetch(url, options = {}) {
  const method = options.method || 'GET';
  calls.push(method + ' ' + String(url));
  const response = (body, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404,
    json: () => Promise.resolve(body), text: () => Promise.resolve('') });
  if (String(url).includes('/gists?per_page=100')) {
    return response(Object.entries(gistStore).map(([id, gist]) => ({ id, files: gist.files })));
  }
  const match = /\/gists\/([^/?]+)$/.exec(String(url));
  if (match && method === 'GET') return response(gistStore[match[1]] || {}, !!gistStore[match[1]]);
  if (match && method === 'PATCH') {
    const body = JSON.parse(options.body);
    gistStore[match[1]] = { description: body.description,
      files: Object.assign({}, gistStore[match[1]].files, body.files) };
    return response({ id: match[1] });
  }
  if (String(url).endsWith('/gists') && method === 'POST') return response({ id: 'unexpected' });
  return response({}, false);
}

function createContext() {
  const local = new Map([['mtgBinder_gh', JSON.stringify({ token: 'fake-test-token', ids: {}, snap: {}, last: null })]]);
  const effects = { saves: 0, hints: 0 };
  const state = {
    checks: { [collectorKey]: true }, extras: { [collectorExtra]: 2 },
    ordered: {}, wrapperArts: {}, orderedWrapperArts: {},
    legacyChecksV1: { 'collector|0|0|0': true },
    monitorPreferences: {
      enabled: true, maxMarketRatio: 0.8, minimumConfidence: 'medium',
      sources: ['ebay', 'tcgplayer', 'heritage', 'store'], includeOptional: false,
      instantFixedPriceEmail: true,
      dailyDigest: { enabled: true, time: '07:00', timezone: 'America/Chicago' },
    },
    monitorPreferencesUpdatedAt: null,
  };
  const context = vm.createContext({
    console, Date, JSON, Object, Number, Array, Set, Promise,
    fetch: fakeFetch, state, ghDirty: false,
    localStorage: {
      getItem: key => local.has(key) ? local.get(key) : null,
      setItem: (key, value) => local.set(key, String(value)),
      removeItem: key => local.delete(key),
    },
    DATA: { checklists: [
      { id: 'collector', title: 'MTG Collector Booster Boxes' },
      { id: 'packs', title: 'MTG Booster Packs' },
    ] },
    document: { getElementById: () => null },
    migrateChecks: checks => ({ checks: checks || {}, legacy: {}, unknown: {}, migrated: 0 }),
    migrateState: value => value,
    save: () => { effects.saves += 1; },
    noteMonitorCollectionChange: () => { effects.hints += 1; },
    paintSync: () => {},
  });
  vm.runInContext(source, context);
  return { context, state, effects };
}

(async () => {
  const first = createContext();
  await vm.runInContext('ghPull(false)', first.context);
  assert.strictEqual(first.state.monitorPreferences.maxMarketRatio, 0.72,
    'Gist pull must restore monitor preferences');
  assert.deepStrictEqual(Array.from(first.state.monitorPreferences.sources), ['ebay', 'store'],
    'Gist pull must restore normalized canonical source order');
  assert.strictEqual(first.state.monitorPreferencesUpdatedAt, '2026-08-09T12:00:00.000Z');
  assert.strictEqual(first.state.checks[collectorKey], true, 'Gist pull must preserve checklist keys');
  assert.strictEqual(first.state.extras[collectorExtra], 2, 'Gist pull must preserve extra quantities');
  assert.strictEqual(first.state.ordered[collectorExtra], 1, 'Gist pull must restore ordered product quantities');
  assert.strictEqual(first.state.legacyChecksV1['collector|0|0|0'], true, 'Gist pull must preserve legacy recovery keys');
  assert.strictEqual(first.state.wrapperArts[wrapperKey1], 1,
    'Gist pull must migrate legacy wrapper booleans to quantity one');
  assert.strictEqual(first.state.orderedWrapperArts[wrapperKey1], 2,
    'Gist pull must restore ordered wrapper quantities');
  assert.strictEqual(first.effects.saves, 1, 'restoring Gist preferences must persist the merged dashboard state once');
  assert.strictEqual(first.effects.hints, 1, 'restoring changed Gist state must schedule a fresh monitor sync');

  const firstConnect = createContext();
  vm.runInContext(`state.monitorPreferences=normalizeMonitorPreferences({enabled:true,maxMarketRatio:.6,
    minimumConfidence:'high',sources:['ebay'],includeOptional:false,instantFixedPriceEmail:true,
    dailyDigest:{enabled:true,time:'06:45',timezone:'America/Chicago'}});
    state.monitorPreferencesUpdatedAt='2026-08-09T14:00:00.000Z';
    state.ordered={${JSON.stringify(collectorExtra)}:3};
    state.wrapperArts={${JSON.stringify(wrapperKey2)}:3};
    state.orderedWrapperArts={${JSON.stringify(wrapperKey2)}:4};`, firstConnect.context);
  await vm.runInContext('ghPull(true)', firstConnect.context);
  assert.strictEqual(firstConnect.state.monitorPreferences.maxMarketRatio, 0.6,
    'first connect must preserve newer local monitor preferences instead of overwriting them');
  assert.strictEqual(vm.runInContext('ghDirty', firstConnect.context), true,
    'newer local first-connect preferences must remain queued for Gist sync');
  assert.strictEqual(firstConnect.state.wrapperArts[wrapperKey1], 1);
  assert.strictEqual(firstConnect.state.wrapperArts[wrapperKey2], 3,
    'first connect must union local and remote wrapper quantities');
  assert.strictEqual(firstConnect.state.ordered[collectorExtra], 3,
    'first connect must preserve the newer local ordered quantity');
  assert.strictEqual(firstConnect.state.orderedWrapperArts[wrapperKey1], 2);
  assert.strictEqual(firstConnect.state.orderedWrapperArts[wrapperKey2], 4,
    'first connect must union local and remote ordered wrapper quantities');

  vm.runInContext(`state.monitorPreferences=normalizeMonitorPreferences({enabled:false,maxMarketRatio:.65,
    minimumConfidence:'medium',sources:['heritage','tcgplayer'],includeOptional:false,
    instantFixedPriceEmail:true,dailyDigest:{enabled:false,time:'09:15',timezone:'America/Chicago'}});
    state.monitorPreferencesUpdatedAt='2026-08-09T13:00:00.000Z';
    state.ordered={${JSON.stringify(collectorExtra)}:3};
    state.wrapperArts={${JSON.stringify(wrapperKey2)}:3};
    state.orderedWrapperArts={${JSON.stringify(wrapperKey2)}:4};`, first.context);
  calls = [];
  await vm.runInContext('ghPush(false)', first.context);
  assert.ok(calls.some(call => call.startsWith('PATCH ')), 'a preference-only edit must patch the canonical collector Gist');
  const payload = JSON.parse(gistStore.gist1.files['mtg-binder-collector.json'].content);
  assert.strictEqual(payload.monitorPreferences.maxMarketRatio, 0.65);
  assert.deepStrictEqual(payload.monitorPreferences.sources, ['tcgplayer', 'heritage']);
  assert.strictEqual(payload.monitorPreferencesUpdatedAt, '2026-08-09T13:00:00.000Z');
  assert.strictEqual(payload.checks[collectorKey], true, 'preference push must preserve v2 ownership keys');
  assert.strictEqual(payload.extras[collectorExtra], 2, 'preference push must preserve quantities/extras');
  assert.strictEqual(payload.ordered[collectorExtra], 3, 'preference push must preserve ordered quantities');
  assert.strictEqual(payload.legacyChecksV1['collector|0|0|0'], true, 'preference push must preserve legacy recovery data');
  assert.doesNotMatch(JSON.stringify(payload), /fake-test-token|provider|capability|apiToken/i,
    'Gist monitor payload must contain no GitHub or provider credentials');
  const packsPayload = JSON.parse(gistStore.gist2.files['mtg-binder-packs.json'].content);
  assert.deepStrictEqual(packsPayload.wrapperArts, { [wrapperKey2]: 3 },
    'packs Gist push must round-trip wrapper quantities and remove zero-count fronts');
  assert.deepStrictEqual(packsPayload.orderedWrapperArts, { [wrapperKey2]: 4 },
    'packs Gist push must round-trip ordered wrapper quantities');
  assert.doesNotMatch(JSON.stringify(packsPayload), /fake-test-token|provider|capability|apiToken/i,
    'wrapper-art Gist payload must contain no GitHub or provider credentials');

  const second = createContext();
  await vm.runInContext('ghPull(false)', second.context);
  assert.strictEqual(second.state.monitorPreferences.maxMarketRatio, 0.65,
    'a fresh dashboard pull must round-trip the pushed monitor preferences');
  assert.deepStrictEqual(Array.from(second.state.monitorPreferences.sources), ['tcgplayer', 'heritage']);
  assert.strictEqual(second.state.monitorPreferences.dailyDigest.time, '09:15');
  assert.strictEqual(second.state.checks[collectorKey], true);
  assert.strictEqual(second.state.extras[collectorExtra], 2);
  assert.strictEqual(second.state.ordered[collectorExtra], 3);
  assert.strictEqual(second.state.wrapperArts[wrapperKey2], 3);
  assert.strictEqual(second.state.orderedWrapperArts[wrapperKey2], 4);
  assert.strictEqual(second.state.wrapperArts[wrapperKey1], undefined);

  const oldPacksPayload = JSON.parse(gistStore.gist2.files['mtg-binder-packs.json'].content);
  delete oldPacksPayload.wrapperArts;
  delete oldPacksPayload.orderedWrapperArts;
  gistStore.gist2.files['mtg-binder-packs.json'].content = JSON.stringify(oldPacksPayload);
  const oldRemote = createContext();
  oldRemote.state.wrapperArts[wrapperKey1] = 2;
  oldRemote.state.ordered[collectorExtra] = 5;
  oldRemote.state.orderedWrapperArts[wrapperKey1] = 6;
  const oldCollectorPayload = JSON.parse(gistStore.gist1.files['mtg-binder-collector.json'].content);
  delete oldCollectorPayload.ordered;
  gistStore.gist1.files['mtg-binder-collector.json'].content = JSON.stringify(oldCollectorPayload);
  await vm.runInContext('ghPull(false)', oldRemote.context);
  assert.strictEqual(oldRemote.state.wrapperArts[wrapperKey1], 2,
    'an older packs Gist without wrapperArts must not delete local wrapper ownership');
  assert.strictEqual(vm.runInContext('ghDirty', oldRemote.context), true,
    'older packs Gist omission must queue a backward-compatible wrapper-art payload');
  assert.strictEqual(oldRemote.state.ordered[collectorExtra], 5,
    'an older checklist Gist without ordered must not delete local incoming quantities');
  assert.strictEqual(oldRemote.state.orderedWrapperArts[wrapperKey1], 6,
    'an older packs Gist without orderedWrapperArts must not delete local incoming wrapper quantities');

  console.log('dashboard Gist tests: monitor preferences plus owned/ordered product and wrapper pull/push/legacy preservation passing');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
