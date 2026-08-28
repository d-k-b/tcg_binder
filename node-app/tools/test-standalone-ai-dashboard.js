#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const authorSource = fs.readFileSync(path.join(root, 'browser-extension', 'collection-author-bridge.js'), 'utf8');
const identifySource = fs.readFileSync(path.join(root, 'browser-extension', 'identify-bridge.js'), 'utf8');

assert.match(html, /id="aiSettingsItem"/);
assert.match(html, /id="aiSettingsModal"/);
assert.match(html, /id="dashboardOpenAIKey" type="password"/);
assert.match(html, /id="dashboardOpenAIRemember" type="checkbox" checked/,
  'Remember on this device must default on');
assert.match(html, /const DASHBOARD_OPENAI_SETTINGS_KEY='tcgDashboardOpenAI_v1'/);
assert.match(html, /hasDashboardOpenAI\(\)[\s\S]{0,500}TCGCatalogAuthor\.authorCollection/,
  'New Collection must support a direct standalone OpenAI request with catalog discovery');
assert.match(html, /hasDashboardOpenAI\(\)[\s\S]{0,700}TCGProductIdentify\.identifyProduct/,
  'photo identification must support a direct standalone OpenAI request');
assert.ok(html.includes(authorSource), 'the generated app must embed the validated author client exactly');
assert.ok(html.includes(identifySource), 'the generated app must embed the validated photo client exactly');
assert.match(html, /The resized photo is sent to OpenAI through either this device's standalone AI setting or the installed Tracker extension/);
assert.match(html, /never included in Gists, exports, URLs, or diagnostics/);
assert.match(html, /JSON\.stringify\(state,null,2\)/, 'progress export must remain state-only');
assert.doesNotMatch(html, /state\.(?:dashboardOpenAI|openAIKey|apiKey)/,
  'the OpenAI key must not enter collection state');
assert.doesNotMatch(html, /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/,
  'no real-looking OpenAI key may be embedded');

const start = html.indexOf('function newDashboardSafetyId()');
const end = html.indexOf('const pricingPending=new Map()', start);
assert.ok(start > 0 && end > start, 'standalone settings implementation must be extractable');
const storageMap = new Map();
const localStorage = {
  getItem: key => storageMap.has(key) ? storageMap.get(key) : null,
  setItem: (key, value) => storageMap.set(key, String(value)),
  removeItem: key => storageMap.delete(key)
};
const sandbox = {
  localStorage,
  crypto: { randomUUID: () => '12345678-1234-1234-1234-123456789abc' },
  boundedText: (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '',
  pricingError: (code, message) => Object.assign(new Error(message), { code }),
  pricingConsumerOrigin: '',
  document: { querySelector: () => null, getElementById: () => null },
  setTimeout: () => {},
  Date,
  JSON,
  Math
};
vm.createContext(sandbox);
vm.runInContext(`const DASHBOARD_OPENAI_SETTINGS_KEY='tcgDashboardOpenAI_v1';\n` +
  `const DASHBOARD_OPENAI_SETTINGS_SCHEMA='tcg.dashboard-openai-settings/v1';\n` +
  html.slice(start, end) +
  `\nglobalThis.__settingsTest={persistDashboardOpenAI,forgetDashboardOpenAI,hasDashboardOpenAI,get:()=>dashboardOpenAI};`, sandbox);

const api = sandbox.__settingsTest;
const fakeKey = 'sk-test-standalone-only-not-a-real-key';
api.persistDashboardOpenAI(fakeKey, true);
assert.strictEqual(api.hasDashboardOpenAI(), true);
assert.strictEqual(api.get().remembered, true);
assert.deepStrictEqual([...storageMap.keys()], ['tcgDashboardOpenAI_v1'],
  'remembered key must use one separate localStorage namespace');
const stored = JSON.parse(storageMap.get('tcgDashboardOpenAI_v1'));
assert.strictEqual(stored.schema, 'tcg.dashboard-openai-settings/v1');
assert.strictEqual(stored.apiKey, fakeKey);

api.persistDashboardOpenAI(fakeKey, false);
assert.strictEqual(api.hasDashboardOpenAI(), true, 'session-only key must remain usable in memory');
assert.strictEqual(api.get().remembered, false);
assert.strictEqual(storageMap.size, 0, 'session-only mode must remove persistent key data');

api.forgetDashboardOpenAI();
assert.strictEqual(api.hasDashboardOpenAI(), false);
assert.strictEqual(storageMap.size, 0);

const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');

console.log('standalone AI dashboard tests: device-local key settings, remember/session/forget behavior, state and Gist isolation, direct author/photo clients, and generated parity passing');
