#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vendor = fs.readFileSync(path.join(root, 'generators', 'vendor', 'tcg-comps-2.43.38', 'tcg-pricing-rest-client.js'), 'utf8');

assert.ok(html.includes(vendor), 'generated dashboard must embed the exact reviewed browser REST client');
assert.match(html, /id="pricingSettingsItem"/);
assert.match(html, /id="dashboardPricingBaseUrl" type="url"/);
assert.match(html, /id="dashboardPricingAccessToken" type="password"/);
assert.match(html, /id="dashboardPricingRemember" type="checkbox" checked/);
assert.match(html, /Read-only pricing access key/);
assert.match(html, /never included in Gists, exports, URLs, or diagnostics/);
assert.doesNotMatch(html, /tcg_price_[A-Za-z0-9_-]{32,}/, 'no real-looking REST token may be embedded');
assert.match(html, /JSON\.stringify\(state,null,2\)/, 'progress export must remain state-only');
assert.doesNotMatch(html, /state\.(?:dashboardPricing|pricingAccessToken|pricingRestToken)/,
  'pricing credentials must not enter collection state');

const start = html.indexOf('function loadDashboardPricing()');
const end = html.indexOf('function dashboardAIError(', start);
assert.ok(start > 0 && end > start, 'standalone pricing settings implementation must be extractable');
const storage = new Map();
const sandbox = {
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  TCGPricingRestClient: { normalizeBaseUrl: value => {
    const url = new URL(String(value));
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new TypeError('plain HTTP is permitted only for loopback; use HTTPS otherwise');
    return url.toString().replace(/\/$/, '');
  } },
  pricingError: (code, message) => Object.assign(new Error(message), { code }),
  pricingConsumerOrigin: '', document: { getElementById: () => null }, setTimeout: () => {}, URL, JSON, Date
};
vm.createContext(sandbox);
vm.runInContext(`const DASHBOARD_PRICING_SETTINGS_KEY='tcgDashboardPricingRest_v1';\n` +
  `const DASHBOARD_PRICING_SETTINGS_SCHEMA='tcg.dashboard-pricing-rest-settings/v1';\n` +
  html.slice(start, end) +
  `\nglobalThis.__pricingSettingsTest={persistDashboardPricing,forgetDashboardPricing,hasDashboardPricing,pricingTransport,get:()=>dashboardPricing};`, sandbox);

const api = sandbox.__pricingSettingsTest;
const endpoint = 'https://pricing.example.test';
const key = 'tcg_price_test_0123456789abcdef0123456789abcdef';
api.persistDashboardPricing(endpoint, key, true);
assert.strictEqual(api.hasDashboardPricing(), true);
assert.strictEqual(api.pricingTransport(), 'rest');
assert.strictEqual(api.get().remembered, true);
assert.deepStrictEqual([...storage.keys()], ['tcgDashboardPricingRest_v1']);
const stored = JSON.parse(storage.get('tcgDashboardPricingRest_v1'));
assert.deepStrictEqual({ schema: stored.schema, baseUrl: stored.baseUrl, accessToken: stored.accessToken }, {
  schema: 'tcg.dashboard-pricing-rest-settings/v1', baseUrl: endpoint, accessToken: key
});

api.persistDashboardPricing(endpoint, key, false);
assert.strictEqual(api.hasDashboardPricing(), true, 'session-only pricing must remain usable in memory');
assert.strictEqual(api.get().remembered, false);
assert.strictEqual(storage.size, 0, 'session-only mode must remove persistent pricing credentials');
assert.throws(() => api.persistDashboardPricing('http://pricing.example.test', key, true), /HTTPS/);
assert.throws(() => api.persistDashboardPricing(endpoint, 'short', true), /complete read-only pricing access key/);

api.forgetDashboardPricing();
assert.strictEqual(api.hasDashboardPricing(), false);
assert.strictEqual(storage.size, 0);

const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');

console.log('standalone pricing dashboard tests: exact client, separate device-local key, remember/session/forget, HTTPS, state isolation, and generated parity passing');
