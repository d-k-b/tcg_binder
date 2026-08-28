#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /id="copyDebugBtn"/);
assert.match(html, /tcg\.dashboard-debug\/v1/);
assert.match(html, /Debug report copied/);

const start = html.indexOf('function buildDebugReport()');
const end = html.indexOf('/* Reconnect automatically', start);
assert.ok(start > 0 && end > start, 'debug implementation must be extractable');
const excerpt = html.slice(start, end);
for (const forbidden of ['tokenLength', 'gistIds:', 'user:gh.user', 'activeKeyShapes', 'keyMigration:state.keyMigration', 'authorMessages.map']) {
  assert.ok(!excerpt.includes(forbidden), `debug implementation must exclude ${forbidden}`);
}

let copied = '', toastMessage = '';
const storage = new Map([['mtgBinder_gh', JSON.stringify({ token: 'github-secret', user: 'private-user', ids: { packs: 'private-gist-id' } })]]);
const sandbox = {
  window: { innerWidth: 390, innerHeight: 844, devicePixelRatio: 3 },
  location: { protocol: 'https:', origin: 'https://example.test', pathname: '/tracker/' },
  navigator: { onLine: true, userAgent: 'Test Browser', clipboard: { writeText: async value => { copied = value; } } },
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  document: { createElement: () => { throw new Error('clipboard fallback should not run'); }, body: {} },
  console, JSON, Date, Math,
  GH_KEY: 'mtgBinder_gh', BUILD: 'test-build', pricingConsumerOrigin: '',
  state: { checks: { secretKey: true }, extras: { secretExtraKey: 2 }, ordered: { secretOrderedKey: 1 }, wrapperArts: { secretWrapperKey: 3 },
    orderedWrapperArts: { secretOrderedWrapperKey: 1 }, legacyChecksV1: { legacySecret: true }, ui: { hideDone: false },
    collectionLibrary: { collections: [{ lifecycle: 'draft' }, { lifecycle: 'live' }], recovery: [] } },
  active: 'packs', titleFor: () => 'Booster Packs', BUILTIN_CHECKLIST_IDS: new Set(['packs']),
  gh: { token: 'github-secret', ids: { packs: 'private-gist-id' }, busy: false, last: null }, ghBootState: 'ok', ghBootMsg: '', ghDirty: false,
  boundedText: (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '',
  hasDashboardOpenAI: () => true, dashboardOpenAI: { apiKey: 'openai-secret', remembered: true },
  hasDashboardPricing: () => true, dashboardPricing: { baseUrl: 'https://private-pricing.example', accessToken: 'pricing-secret', remembered: true },
  pricingTransport: () => 'rest',
  authorMessages: [{ role: 'user', text: 'private chat prompt' }], authorLastResult: { kind: 'catalog_import' }, authorBusy: false,
  monitorSyncStatus: { state: 'synced', monitorConfigured: true, productCount: 686, activeTargetCount: 12 },
  pricingStates: new Map(), pricingBatch: { running: false }, toast: message => { toastMessage = message; }
};
sandbox.runtimeDiagnostics = [{ at: '2026-08-23T00:00:00.000Z', area: 'test', name: 'TypeError', message: 'Safe render failure' }];
sandbox.window.parent = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(excerpt + '\nglobalThis.__debugTest={buildDebugReport,copyDebugReport};', sandbox);
const report = sandbox.__debugTest.buildDebugReport();
const serialized = JSON.stringify(report);
assert.strictEqual(report.schema, 'tcg.dashboard-debug/v1');
assert.strictEqual(report.viewport.width, 390);
assert.strictEqual(report.collection.checkedBoxes, 1);
assert.strictEqual(report.collection.customDraftCount, 1);
assert.strictEqual(report.ai.standaloneConfigured, true);
assert.strictEqual(report.diagnostics.recentErrors[0].message, 'Safe render failure');
for (const secret of ['github-secret', 'private-user', 'private-gist-id', 'openai-secret', 'pricing-secret', 'private-pricing.example', 'secretKey', 'legacySecret', 'private chat prompt']) {
  assert.ok(!serialized.includes(secret), `debug report must redact ${secret}`);
}

(async () => {
  await sandbox.__debugTest.copyDebugReport();
  assert.strictEqual(JSON.parse(copied).schema, 'tcg.dashboard-debug/v1');
  assert.match(toastMessage, /Debug report copied/);
  console.log('debug dashboard tests: one-click clipboard report, useful counts, and credential, identity, Gist, progress-key, and chat-content exclusion passing');
})().catch(error => { console.error(error); process.exitCode = 1; });
