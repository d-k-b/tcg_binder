#!/usr/bin/env node
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vendor = fs.readFileSync(path.join(root, 'generators', 'vendor', 'tcg-comps-2.43.45', 'tcg-pricing-rest-client.js'), 'utf8');

assert.strictEqual(crypto.createHash('sha256').update(vendor).digest('hex'),
  '9abeefcf13c29c109d7dbfcae88f5c0dae09a60f50f764332fb3cbca743ea87c',
  'vendored browser REST client must match the exact reviewed TCG Comps 2.43.45 artifact');
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
  authenticated: true, providerAvailable: true, providerVersion: '2.43.45', browserAgentAvailable: true,
  browserAgentLastSeenAt: '2026-08-29T18:00:00.000Z', browserPriceRoute: '/v1/browser-price' };
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
  `const BROWSER_PRICE_ROUTE='/v1/browser-price';\n` +
  `const PRICING_TIMEOUT_MS=20000;\n` +
  html.slice(start, end) +
  `\nglobalThis.__pricingSettingsTest={persistDashboardPricing,forgetDashboardPricing,hasDashboardPricing,pricingTransport,testConnection:testDashboardPricingConnection,get:()=>dashboardPricing};`, sandbox);

const api = sandbox.__pricingSettingsTest;
const endpoint = 'https://pricing.example.test';
const key = 'tcg_price_test_0123456789abcdef0123456789abcdef';
const product = { schema: 'tcg.product/v1', productId: 'mtg:vis:visions:booster:display:en', game: 'mtg',
  setCode: 'VIS', setName: 'Visions', productName: 'Visions Booster Display', productType: 'booster',
  unit: 'display', language: 'en', variant: null };
(async () => {
const browserFetchCalls = [];
const browserClientSandbox = {
  URL, AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    browserFetchCalls.push({ url, options });
    const body = options.body ? JSON.parse(options.body) : null;
    if (String(url).endsWith('/v1/browser-price') && options.method === 'POST') return { ok: true, status: 202, json: async () => ({
      apiVersion: 1, schema: 'tcg.browser-price-job/v1', requestId: body.requestId, jobId: 'browser-job-1', status: 'queued', productId: product.productId
    }) };
    if (String(url).endsWith('/v1/browser-price/browser-job-1')) return { ok: true, status: 200, json: async () => ({
      apiVersion: 1, schema: 'tcg.browser-price-job/v1', requestId: 'dashboard-browser-comps', jobId: 'browser-job-1', status: 'complete', productId: product.productId,
      result: { apiVersion: 1, schema: 'tcg.valuation/v1', product, observedAt: '2026-08-29T18:00:20.000Z', market: { value: 700, confidence: 'high' },
        lowestAsk: { landedPrice: 690 }, browserExecution: { schema: 'tcg.browser-comp-evidence/v1', mode: 'interactive-extension' } }
    }) };
    if (String(url).endsWith('/v1/diagnostics')) return { ok: true, status: 200, json: async () => ({ apiVersion: 1,
      schema: 'tcg.pricing-diagnostics/v1', requestId: body.requestId, productId: product.productId,
      marketState: 'market-pending', latestSales: {}, analyzerHandoff: {}, retryBackoff: {} }) };
    return { ok: true, status: 200, json: async () => ({ apiVersion: 1,
      schema: 'tcg.pricing-rest-readiness/v1', ready: true, authenticated: true,
      providerAvailable: true, providerVersion: '2.43.45', browserAgentAvailable: true,
      browserAgentLastSeenAt: '2026-08-29T18:00:00.000Z', browserPriceRoute: '/v1/browser-price' }) };
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
const defaultFetchDiagnostics = await defaultFetchClient.diagnostics(product, { requestId: 'dashboard-diagnostics' });
assert.strictEqual(defaultFetchDiagnostics.marketState, 'market-pending');
assert.strictEqual(browserFetchCalls[1].url, endpoint + '/v1/diagnostics');
assert.strictEqual(JSON.parse(browserFetchCalls[1].options.body).target.productId, product.productId);
const browserValuation = await defaultFetchClient.priceViaBrowser(product, {
  includeActive: true, includePackOut: true, requestId: 'dashboard-browser-comps', pollIntervalMs: 250, browserTimeoutMs: 30000
});
assert.strictEqual(browserValuation.product.productId, product.productId);
assert.strictEqual(browserValuation.browserExecution.mode, 'interactive-extension');
assert.strictEqual(browserFetchCalls[2].url, endpoint + '/v1/browser-price');
assert.strictEqual(browserFetchCalls[2].options.method, 'POST');
assert.deepStrictEqual(JSON.parse(browserFetchCalls[2].options.body).options, { includeActive: true, includePackOut: true });
assert.strictEqual(browserFetchCalls[3].url, endpoint + '/v1/browser-price/browser-job-1');
const mismatchClient = browserClientSandbox.TCGPricingRestClient.createClient({ baseUrl: endpoint, accessToken: key,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ apiVersion: 1,
    schema: 'tcg.pricing-diagnostics/v1', requestId: 'wrong-request', productId: product.productId,
    marketState: 'market-pending' }) }) });
await assert.rejects(() => mismatchClient.diagnostics(product, { requestId: 'expected-request' }), /mismatched requestId/,
  'the exact browser client must fail closed on diagnostics request correlation');

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
assert.deepStrictEqual(JSON.parse(JSON.stringify(readiness)), { providerVersion: '2.43.45', browserAgentAvailable: true,
  browserAgentLastSeenAt: '2026-08-29T18:00:00.000Z', browserPriceRoute: '/v1/browser-price' });
assert.deepStrictEqual({ baseUrl: clientConfigs[0].baseUrl, accessToken: clientConfigs[0].accessToken, timeoutMs: clientConfigs[0].timeoutMs },
  { baseUrl: endpoint, accessToken: key, timeoutMs: 20000 }, 'readiness must use only the entered endpoint and dedicated REST key');
readinessResult = { apiVersion: 1, schema: 'tcg.pricing-rest-readiness/v1', ready: true,
  authenticated: true, providerAvailable: true, providerVersion: '2.43.45', browserAgentAvailable: 'yes',
  browserAgentLastSeenAt: 'not-a-date', browserPriceRoute: 'https://attacker.example/browser-price?token=secret' };
assert.deepStrictEqual(JSON.parse(JSON.stringify(await api.testConnection(endpoint, key))), {
  providerVersion: '2.43.45', browserAgentAvailable: null, browserAgentLastSeenAt: null, browserPriceRoute: null
}, 'readiness must allowlist and bound browser-agent fields without retaining arbitrary route content');
readinessResult = { apiVersion: 1, schema: 'tcg.pricing-rest-readiness/v1', ready: false,
  authenticated: true, providerAvailable: false, providerVersion: '2.43.45' };
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

console.log('standalone pricing dashboard tests: exact 2.43.45 client, default browser fetch, bounded readiness, manual browser-job polling, diagnostics, row refresh, separate device-local key, remember/session/forget, HTTPS, state isolation, and generated parity passing');
})().catch(error => { console.error(error); process.exit(1); });
