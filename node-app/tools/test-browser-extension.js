'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

assert.strictEqual(manifest.manifest_version, 3, 'extension must use Manifest V3');
assert.strictEqual(manifest.version, '1.2.1', 'copyable page-check diagnostics must bump the tracker extension version');
assert.strictEqual(manifest.side_panel.default_path, 'sidepanel.html');
assert.deepStrictEqual(manifest.permissions.slice().sort(), ['sidePanel', 'storage']);
assert.ok(!manifest.host_permissions, 'launcher should not request host permissions');

const csp = manifest.content_security_policy.extension_pages;
assert.match(csp, /script-src 'self'/);
assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\/\/.*script-src/);
assert.match(csp, /frame-src https:\/\/d-k-b\.github\.io/);

const referenced = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
for (const relativePath of new Set(referenced)) {
  assert.ok(fs.existsSync(path.join(EXT, relativePath)), `missing manifest asset: ${relativePath}`);
}

const html = fs.readFileSync(path.join(EXT, 'sidepanel.html'), 'utf8');
assert.match(html, /<script src="sidepanel\.js"><\/script>/);
const vendorScripts = [
  'vendor/tcg-comps-2.40.0/pricing-contracts.js',
  'vendor/tcg-comps-2.40.0/pricing-client.js',
  'vendor/tcg-comps-2.40.0/pricing-bridge.js',
];
let priorScript = -1;
for (const script of vendorScripts) {
  assert.ok(fs.existsSync(path.join(EXT, script)), `missing vendored provider script: ${script}`);
  const offset = html.indexOf(`<script src="${script}"></script>`);
  assert.ok(offset > priorScript, `provider scripts must load in contract/client/bridge order: ${script}`);
  priorScript = offset;
}
assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inline scripts are forbidden in MV3 extension pages');
assert.doesNotMatch(html, /\son(?:click|load|error)=/i, 'inline event handlers are forbidden');

const panelJs = fs.readFileSync(path.join(EXT, 'sidepanel.js'), 'utf8');
const workerJs = fs.readFileSync(path.join(EXT, 'background.js'), 'utf8');
for (const source of [panelJs, workerJs]) {
  assert.match(source, /https:\/\/d-k-b\.github\.io\/tcg_binder\//);
}
assert.match(workerJs, /openPanelOnActionClick:\s*true/);
assert.match(panelJs, /chrome\.tabs\.create/);
assert.match(panelJs, /extensionRefresh/);
assert.match(panelJs, /localStorage\.getItem\('dashboardUrl'\)/, 'local HTTP preview should work without extension APIs');
assert.match(panelJs, /chrome\.storage\.local\.get\(\[PRICING_EXTENSION_KEY, PRICING_TOKEN_KEY\]\)/,
  'pairing credentials must load from extension-local storage');
assert.match(panelJs, /chrome\.storage\.local\.set\(\{[\s\S]*\[PRICING_TOKEN_KEY\]/,
  'pairing credentials must save to extension-local storage');
assert.doesNotMatch(panelJs, /localStorage\.(?:getItem|setItem)\([^\n]*PRICING_TOKEN_KEY/,
  'the pricing capability token must never use page localStorage');
assert.match(panelJs, /allowedOrigins:\s*\[origin\]/, 'bridge must allow only the configured dashboard origin');
assert.match(panelJs, /frame:\s*dashboard/, 'bridge must bind requests to the exact dashboard frame');
assert.match(panelJs, /pricingConsumerOrigin/, 'dashboard receives only the non-secret consumer origin');
assert.doesNotMatch(panelJs, /searchParams\.set\([^\n]*(?:apiToken|PRICING_TOKEN_KEY)/,
  'the capability token must never enter the iframe URL');
assert.match(panelJs, /API v1 is compatible/, 'provider release differences must be explained as API-compatible');
assert.doesNotMatch(panelJs, /versionNote\s*\?\s*['"]error['"]\s*:\s*['"]ok['"]/,
  'an API-compatible provider release difference must not render as an error');
assert.match(html, /id="scanPage"/, 'the side panel must expose a direct page-decoration button');
assert.match(html, /id="copyPageScanDiagnostics"[^>]*hidden/,
  'page-check diagnostics copy control must stay hidden until an error occurs');
assert.match(panelJs, /COLLECTION_SNAPSHOT_SCHEMA\s*=\s*'tcg\.collection-snapshot\/v2'/,
  'the Tracker must require the canonical ProductRef collection snapshot');
assert.match(panelJs, /COLLECTION_RESULT_SCHEMA\s*=\s*'tcg\.collection-decoration-result\/v2'/,
  'the Tracker must require the corrected canonical result schema');
assert.match(panelJs, /decorateCollectionPage\(snapshot, \{ observe: true, userInitiated: true \}\)/,
  'page decoration must be a direct user-initiated provider call');
assert.strictEqual((panelJs.match(/userInitiated:\s*true/g) || []).length, 1,
  'only the direct page-decoration button may assert a user action');
assert.doesNotMatch(panelJs, /targetTabId/, 'the provider should select the active tab without new Tracker tab permissions');
assert.match(panelJs, /event\.origin !== pending\.targetOrigin/,
  'collection snapshots must reject responses from a different origin');
assert.match(panelJs, /event\.source !== dashboard\.contentWindow/,
  'collection snapshots must reject responses from a different frame');
assert.doesNotMatch(panelJs, /querySelectorAll|MutationObserver|pricing\.page\.decorateCollection/,
  'the Tracker must not duplicate provider page discovery or the raw external envelope');
assert.match(panelJs, /DASHBOARD_SNAPSHOT_TIMEOUT/,
  'a dashboard snapshot timeout must have a copyable diagnostic code');
assert.match(panelJs, /Failure stage:/,
  'page-check diagnostics must identify whether failure occurred in the dashboard or provider stage');
assert.match(panelJs, /navigator\?\.clipboard\?\.writeText/,
  'the error icon must copy diagnostics through the clipboard API');
assert.match(panelJs, /document\.execCommand\('copy'\)/,
  'clipboard copying must have a side-panel-compatible fallback');
assert.match(panelJs, /text\.split\(capabilityToken\)\.join\('\[REDACTED\]'\)/,
  'diagnostic text must redact the stored capability token if an upstream error echoes it');
assert.match(panelJs, /The capability token is intentionally excluded\./,
  'copied diagnostics must explicitly confirm the credential boundary');
assert.doesNotMatch(panelJs, /['"]Capability token:\s*['"]\s*\+/,
  'copied diagnostics must never append the capability token');

const expectedHashes = {
  'pricing-contracts.js': '68dff912a54f855a742bba49ec536ee64a8a9fb9fda67c7d198aa91fbde7aea4',
  'pricing-client.js': '1e1557772c0609cdc081167e50dc4531570c2b9d3cdd10f52a3d06f29cb320a4',
  'pricing-bridge.js': '740544aa8d059d2e69521c4fcdc68200da6fc9df08a6aebddb14d36b7aa8e74b',
};
for (const [file, expected] of Object.entries(expectedHashes)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(EXT, 'vendor', 'tcg-comps-2.40.0', file))).digest('hex');
  assert.strictEqual(actual, expected, `${file} must remain the exact provider 2.40.0 artifact`);
}
const contracts = require(path.join(EXT, 'vendor', 'tcg-comps-2.40.0', 'pricing-contracts.js'));
const binder = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'binder_data.json'), 'utf8'));
const catalogProducts = {};
for (const checklist of binder.checklists || []) {
  for (const era of checklist.eras || []) {
    for (const item of era.items || []) {
      for (const record of item.pricingProducts || []) {
        catalogProducts[record.ref.productId] = {
          product: record.ref, status: 'missing', target: 1, owned: 0, missing: 1, requirement: 'required'
        };
      }
    }
  }
}
assert.strictEqual(Object.keys(catalogProducts).length, 686, 'all canonical Tracker ProductRefs must fit one page-decoration request');
assert.ok(contracts.validateCollectionSnapshot({
  schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker', products: catalogProducts
}).ok, 'the exact provider contract must accept all 686 full canonical ProductRefs atomically');
const firstProductId = Object.keys(catalogProducts)[0];
const mismatched = JSON.parse(JSON.stringify(catalogProducts[firstProductId]));
mismatched.product.productId = 'mtg:bad:mismatched-product:booster:pack:en';
assert.ok(!contracts.validateCollectionSnapshot({
  schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker', products: { [firstProductId]: mismatched }
}).ok, 'catalog keys must equal their full ProductRef productId');
const panelCss = fs.readFileSync(path.join(EXT, 'sidepanel.css'), 'utf8');
assert.match(panelCss, /\.toolbar\s*\{\s*grid-row:\s*1;/, 'toolbar must own the first grid row');
assert.match(panelCss, /\.page-scan-status\s*\{[\s\S]*grid-row:\s*2;/, 'page status must own the optional second grid row');
assert.match(panelCss, /\.settings-panel\s*\{\s*grid-row:\s*3;/, 'settings must own the optional third grid row');
assert.match(panelCss, /main\s*\{\s*grid-row:\s*4;/, 'dashboard must stay in the flexible fourth grid row');

console.log('browser extension tests: pricing bridge and MV3 shell passing');
