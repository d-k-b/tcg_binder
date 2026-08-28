#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vendor = fs.readFileSync(path.join(root, 'generators', 'vendor', 'tcg-comps-2.43.42', 'tcg-pricing-rest-client.js'), 'utf8');

assert.ok(html.includes(vendor), 'generated dashboard must embed the exact reviewed browser REST client');
assert.match(html, /id="pricingSettingsItem"/);
assert.match(html, /id="dashboardPricingBaseUrl" type="url"/);
assert.match(html, /id="dashboardPricingAccessToken" type="password"/);
assert.match(html, /id="dashboardPricingRemember" type="checkbox" checked/);
assert.match(html, /id="pricingSettingsTest"/);
assert.match(html, /Save &amp; test/);
assert.match(html, /https:\/\/gogo\.tail903ec0\.ts\.net/);
assert.match(html, /Read-only pricing access key/);
assert.match(html, /never included in Gists, exports, URLs, or diagnostics/);
assert.match(html, /const priceReady=pricingAvailable\(\);/,
  'row refresh controls must use the active REST-or-extension transport gate');
assert.match(html, /priceRefresh\.disabled=!priceReady\|\|pricingBatch\.running\|\|priceStatus==='loading'/,
  'configured standalone REST must enable compact row refresh controls');
assert.doesNotMatch(html, /priceRefresh\.disabled=!pricingConsumerOrigin/,
  'row refresh controls must not remain extension-only');
assert.doesNotMatch(html, /tcg_price_[A-Za-z0-9_-]{32,}/, 'no real-looking REST token may be embedded');
assert.match(html, /JSON\.stringify\(state,null,2\)/, 'progress export must remain state-only');
assert.doesNotMatch(html, /state\.(?:dashboardPricing|pricingAccessToken|pricingRestToken)/,
  'pricing credentials must not enter collection state');

const start = html.indexOf('function loadDashboardPricing()');
const end = html.indexOf('function dashboardAIError(', start);
assert.ok(start > 0 && end > start, 'standalone pricing settings implementation must be extractable');
const storage = new Map();
const clientConfigs = [];
let readinessResult = { apiVersion: 1, schema: 'tcg.pricing-rest-readiness/v1', ready: true,
  authenticated: true, providerAvailable: true, providerVersion: '2.43.42' };
const sandbox = {
  localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
  TCGPricingRestClient: { normalizeBaseUrl: value => {
    const url = new URL(String(value));
    if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new TypeError('plain HTTP is permitted only for loopback; use HTTPS otherwise');
    return url.toString().replace(/\/$/, '');
  }, createClient: config => { clientConfigs.push(config); return { readiness: async () => readinessResult }; } },
  pricingError: (code, message) => Object.assign(new Error(message), { code }),
  pricingConsumerOrigin: '', boundedText: (value, max) => String(value || '').slice(0, max),
  document: { getElementById: () => null }, setTimeout: () => {}, URL, JSON, Date
};
vm.createContext(sandbox);
vm.runInContext(`const DASHBOARD_PRICING_SETTINGS_KEY='tcgDashboardPricingRest_v1';\n` +
  `const DASHBOARD_PRICING_SETTINGS_SCHEMA='tcg.dashboard-pricing-rest-settings/v1';\n` +
  `const DASHBOARD_PRICING_DEFAULT_URL='https://gogo.tail903ec0.ts.net';\n` +
  `const PRICING_READINESS_SCHEMA='tcg.pricing-rest-readiness/v1';\n` +
  `const PRICING_TIMEOUT_MS=20000;\n` +
  html.slice(start, end) +
  `\nglobalThis.__pricingSettingsTest={persistDashboardPricing,forgetDashboardPricing,hasDashboardPricing,pricingTransport,testConnection:testDashboardPricingConnection,get:()=>dashboardPricing};`, sandbox);

const api = sandbox.__pricingSettingsTest;
const endpoint = 'https://pricing.example.test';
const key = 'tcg_price_test_0123456789abcdef0123456789abcdef';
(async () => {
const browserFetchCalls = [];
const browserClientSandbox = {
  URL, AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    browserFetchCalls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ apiVersion: 1,
      schema: 'tcg.pricing-rest-readiness/v1', ready: true, authenticated: true,
      providerAvailable: true, providerVersion: '2.43.42' }) };
  }
};
vm.createContext(browserClientSandbox);
vm.runInContext(vendor, browserClientSandbox);
const defaultFetchClient = browserClientSandbox.TCGPricingRestClient.createClient({ baseUrl: endpoint, accessToken: key });
const defaultFetchReadiness = await defaultFetchClient.readiness();
assert.strictEqual(defaultFetchReadiness.ready, true,
  'the browser artifact must use the browser-global fetch when fetchImpl is omitted');
assert.strictEqual(browserFetchCalls.length, 1);
assert.strictEqual(browserFetchCalls[0].url, endpoint + '/v1/readiness');
assert.strictEqual(browserFetchCalls[0].options.headers.Authorization, 'Bearer ' + key);

assert.strictEqual(api.get().baseUrl, 'https://gogo.tail903ec0.ts.net', 'new devices must receive the deployed non-secret base URL');
assert.strictEqual(api.hasDashboardPricing(), false, 'a prefilled endpoint without a key must not enable pricing');
api.persistDashboardPricing(endpoint, key, true);
assert.strictEqual(api.hasDashboardPricing(), true);
assert.strictEqual(api.pricingTransport(), 'rest');
assert.strictEqual(api.get().remembered, true);
assert.deepStrictEqual([...storage.keys()], ['tcgDashboardPricingRest_v1']);
const stored = JSON.parse(storage.get('tcgDashboardPricingRest_v1'));
assert.deepStrictEqual({ schema: stored.schema, baseUrl: stored.baseUrl, accessToken: stored.accessToken }, {
  schema: 'tcg.dashboard-pricing-rest-settings/v1', baseUrl: endpoint, accessToken: key
});
const readiness = await api.testConnection(endpoint, key);
assert.deepStrictEqual(JSON.parse(JSON.stringify(readiness)), { providerVersion: '2.43.42' });
assert.deepStrictEqual({ baseUrl: clientConfigs[0].baseUrl, accessToken: clientConfigs[0].accessToken, timeoutMs: clientConfigs[0].timeoutMs },
  { baseUrl: endpoint, accessToken: key, timeoutMs: 20000 }, 'readiness must use only the entered endpoint and dedicated REST key');
readinessResult = { apiVersion: 1, schema: 'tcg.pricing-rest-readiness/v1', ready: false,
  authenticated: true, providerAvailable: false, providerVersion: '2.43.42' };
await assert.rejects(() => api.testConnection(endpoint, key), /not ready/,
  'authenticated readiness must fail closed when the canonical authority is unavailable');

api.persistDashboardPricing(endpoint, key, false);
assert.strictEqual(api.hasDashboardPricing(), true, 'session-only pricing must remain usable in memory');
assert.strictEqual(api.get().remembered, false);
assert.strictEqual(storage.size, 0, 'session-only mode must remove persistent pricing credentials');
assert.throws(() => api.persistDashboardPricing('http://pricing.example.test', key, true), /HTTPS/);
assert.throws(() => api.persistDashboardPricing(endpoint, 'short', true), /complete read-only pricing access key/);

api.forgetDashboardPricing();
assert.strictEqual(api.hasDashboardPricing(), false);
assert.strictEqual(storage.size, 0);
assert.strictEqual(api.get().baseUrl, 'https://gogo.tail903ec0.ts.net', 'forgetting the secret must retain only the public endpoint default');

const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');

console.log('standalone pricing dashboard tests: exact 2.43.42 client, default browser fetch, readiness, row refresh, separate device-local key, remember/session/forget, HTTPS, state isolation, and generated parity passing');
})().catch(error => { console.error(error); process.exit(1); });
