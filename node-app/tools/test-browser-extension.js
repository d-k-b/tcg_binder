'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'browser-extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

assert.strictEqual(manifest.manifest_version, 3, 'extension must use Manifest V3');
assert.strictEqual(manifest.version, '1.5.0', 'AI-assisted local collection drafts must bump the tracker extension version');
assert.strictEqual(manifest.side_panel.default_path, 'sidepanel.html');
assert.deepStrictEqual(manifest.permissions.slice().sort(), ['sidePanel', 'storage']);
assert.deepStrictEqual(manifest.host_permissions, ['https://api.openai.com/*'], 'photo identification may contact only the OpenAI API');

const csp = manifest.content_security_policy.extension_pages;
assert.match(csp, /script-src 'self'/);
assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:\/\/.*script-src/);
assert.match(csp, /frame-src https:\/\/d-k-b\.github\.io/);
assert.match(csp, /connect-src https:\/\/api\.openai\.com/, 'extension pages may connect only to the configured vision API host');

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
  'vendor/tcg-comps-2.42.0/pricing-contracts.js',
  'vendor/tcg-comps-2.42.0/pricing-client.js',
  'vendor/tcg-comps-2.42.0/pricing-bridge.js',
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
assert.ok(html.indexOf('<script src="monitor-bridge.js"></script>') > html.indexOf('pricing-bridge.js'),
  'the exact dashboard monitor bridge must load before sidepanel.js');
assert.ok(html.indexOf('<script src="identify-bridge.js"></script>') > html.indexOf('monitor-bridge.js'),
  'the product-identification bridge must load before sidepanel.js');
assert.ok(html.indexOf('<script src="collection-author-bridge.js"></script>') > html.indexOf('identify-bridge.js'),
  'the collection-authoring bridge must load before sidepanel.js');

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
assert.match(html, /id="rememberOpenaiKey"[^>]*checked/, 'remember-on-this-device must default on');
assert.match(panelJs, /chrome\.storage\.local\.set\(\{ \[VISION_KEY\]: apiKey \}\)/,
  'remembered OpenAI keys must use extension-local storage');
assert.match(panelJs, /chrome\.storage\.local\.remove\(VISION_KEY\)/,
  'the settings page must be able to forget the remembered key');
assert.doesNotMatch(panelJs, /localStorage\.(?:getItem|setItem)\([^\n]*VISION_KEY/,
  'the OpenAI key must never use dashboard or side-panel localStorage');
assert.match(workerJs, /setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/,
  'extension storage must be restricted to trusted extension contexts');
assert.match(panelJs, /event\.origin !== targetOrigin \|\| event\.source !== dashboard\.contentWindow/,
  'photo requests must require the exact dashboard origin and frame');
assert.match(panelJs, /TCGProductIdentify\.validateIdentifyRequest/,
  'the extension must validate every photo request before calling OpenAI');
assert.match(panelJs, /source\.postMessage\([\s\S]*targetOrigin\)/,
  'photo results must return only to the exact dashboard origin');
assert.doesNotMatch(panelJs, /postMessage\([^\n]*['"]\*['"]/, 'no privileged bridge may post to a wildcard origin');
assert.match(panelJs, /text = text\.split\(visionKey\)\.join\('\[REDACTED\]'\)/,
  'diagnostics must redact the remembered OpenAI key');
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
assert.match(html, /id="syncMonitor"/, 'settings must expose an explicit collection monitor sync control');
assert.match(html, /id="refreshMonitorStatus"/, 'settings must expose provider monitor status');
assert.match(html, /id="runMonitor"/, 'settings must expose an explicit manual monitor run');
assert.match(html, /id="copyMonitorDiagnostics"/, 'monitor failures must expose copyable sanitized diagnostics');
assert.match(panelJs, /COLLECTION_SNAPSHOT_SCHEMA\s*=\s*'tcg\.collection-snapshot\/v2'/,
  'the Tracker must require the canonical ProductRef collection snapshot');
assert.match(panelJs, /COLLECTION_RESULT_SCHEMA\s*=\s*'tcg\.collection-decoration-result\/v2'/,
  'the Tracker must require the corrected canonical result schema');
assert.match(panelJs, /decorateCollectionPage\(snapshot, \{ observe: true, userInitiated: true \}\)/,
  'page decoration must be a direct user-initiated provider call');
assert.strictEqual((panelJs.match(/userInitiated:\s*true/g) || []).length, 2,
  'only direct page-decoration and monitor-sync buttons may assert a user action in the panel; packaged runMonitor adds its own direct-action flag');
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
assert.match(panelJs, /syncMonitorCollection/, 'Tracker must call the packaged monitor collection client method');
assert.match(panelJs, /monitorStatus/, 'Tracker must call the packaged monitor status client method');
assert.match(panelJs, /runMonitor/, 'Tracker must call the packaged explicit monitor run client method');
assert.match(panelJs, /monitorRevisionGate\.shouldForward/, 'automatic duplicate revisions must be idempotent');
assert.match(panelJs, /dashboardMonitorBridge\.scheduleStateChanged/, 'dashboard changes must use debounced monitor resync');
assert.match(panelJs, /document\.visibilityState === 'visible'/, 'debounced resync must run only while the side panel is active');
assert.match(panelJs, /tcg\.collection-monitor-sync-status\/v1/, 'Tracker must report bounded monitor sync status to the dashboard');
assert.match(panelJs, /No subscription body, GitHub\/Gist credential, provider capability token, monitor bearer token, or email address is included/,
  'monitor diagnostics must explicitly document every excluded secret category');
assert.doesNotMatch(panelJs, /mtgBinder_gh|legacyChecksV1|githubToken|gistToken/,
  'the privileged extension must not read dashboard or Gist credentials/state');

const expectedHashes = {
  'pricing-contracts.js': 'a7e232200c6ea4209992ddd7bfeefa8791f0a80f95a33ce8203cc45ef1d8ff00',
  'pricing-client.js': 'a23d545c4fe12cae8f2bb64db91853c776145607071a08a96779cf82b3e96f67',
  'pricing-bridge.js': '4cd9dd0e71692807e2f796febe61144eb48760bd71c6118de283139fdd8bad1d',
};
for (const [file, expected] of Object.entries(expectedHashes)) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(EXT, 'vendor', 'tcg-comps-2.42.0', file))).digest('hex');
  assert.strictEqual(actual, expected, `${file} must remain the exact provider 2.42.0 artifact`);
}
const contracts = require(path.join(EXT, 'vendor', 'tcg-comps-2.42.0', 'pricing-contracts.js'));
const clientSource = fs.readFileSync(path.join(EXT, 'vendor', 'tcg-comps-2.42.0', 'pricing-client.js'), 'utf8');
assert.match(clientSource, /syncMonitorCollection:\s*\(subscription\)\s*=>\s*send\("pricing\.monitor\.syncCollection"/,
  'packaged client must expose the canonical atomic monitor sync');
assert.match(clientSource, /monitorStatus:\s*\(\)\s*=>\s*send\("pricing\.monitor\.status"\)/,
  'packaged client must expose the canonical monitor status method');
assert.match(clientSource, /runMonitor:\s*\(\)\s*=>\s*send\("pricing\.monitor\.run",\s*\{ options:\s*\{ userInitiated:\s*true \} \}\)/,
  'packaged client must add userInitiated only for the explicit run method');
assert.strictEqual(contracts.MONITOR_SYNC_RESULT_SCHEMA, 'tcg.collection-monitor-sync-result/v1');
assert.strictEqual(contracts.MONITOR_STATUS_SCHEMA, 'tcg.collection-monitor-status/v1');
assert.strictEqual(contracts.MONITOR_RUN_RESULT_SCHEMA, 'tcg.collection-monitor-run-result/v1');
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
assert.strictEqual(Object.keys(catalogProducts).length, 688, 'all canonical Tracker ProductRefs must fit one page-decoration request');
assert.ok(contracts.validateCollectionSnapshot({
  schema: 'tcg.collection-snapshot/v2', namespace: 'collection-tracker', products: catalogProducts
}).ok, 'the exact provider contract must accept all 688 full canonical ProductRefs atomically');
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
