const DEFAULT_DASHBOARD_URL = 'https://d-k-b.github.io/tcg_binder/';
const ALLOWED_LIVE_ORIGIN = 'https://d-k-b.github.io';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const PRICING_EXTENSION_KEY = 'tcgCompsExtensionId';
const PRICING_TOKEN_KEY = 'tcgCompsApiToken';
const EXPECTED_PRICING_API_VERSION = 1;
const VENDORED_PROVIDER_VERSION = '2.40.0';
const COLLECTION_CHANNEL = 'tcg-collection/v1';
const COLLECTION_SNAPSHOT_SCHEMA = 'tcg.collection-snapshot/v2';
const COLLECTION_RESULT_SCHEMA = 'tcg.collection-decoration-result/v2';
const COLLECTION_REQUEST_TIMEOUT_MS = 10000;

const dashboard = document.getElementById('dashboard');
const status = document.getElementById('status');
const settingsButton = document.getElementById('settings');
const settingsPanel = document.getElementById('settingsPanel');
const sourceForm = document.getElementById('sourceForm');
const dashboardUrl = document.getElementById('dashboardUrl');
const sourceError = document.getElementById('sourceError');
const loadError = document.getElementById('loadError');
const pricingForm = document.getElementById('pricingForm');
const pricingExtensionId = document.getElementById('tcgCompsExtensionId');
const pricingToken = document.getElementById('tcgCompsApiToken');
const pricingStatus = document.getElementById('pricingStatus');
const consumerExtensionId = document.getElementById('consumerExtensionId');
const scanPageButton = document.getElementById('scanPage');
const pageScanStatus = document.getElementById('pageScanStatus');
const pageScanTitle = document.getElementById('pageScanTitle');
const pageScanMessage = document.getElementById('pageScanMessage');
const copyPageScanDiagnosticsButton = document.getElementById('copyPageScanDiagnostics');
const pageScanCopyFeedback = document.getElementById('pageScanCopyFeedback');

let currentUrl = DEFAULT_DASHBOARD_URL;
let loadTimer = null;
let pricingBridge = null;
let pricingClient = null;
let pricingSettings = { extensionId: '', apiToken: '' };
let collectionRequest = null;
let collectionRequestSerial = 0;
let pageScanRunning = false;
let pageScanDiagnostics = '';
let dashboardLoadedAt = null;

async function readDashboardUrl() {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local.get({ dashboardUrl: DEFAULT_DASHBOARD_URL });
  }
  return { dashboardUrl: localStorage.getItem('dashboardUrl') || DEFAULT_DASHBOARD_URL };
}

async function saveDashboardUrl(value) {
  if (globalThis.chrome?.storage?.local) {
    await chrome.storage.local.set({ dashboardUrl: value });
    return;
  }
  localStorage.setItem('dashboardUrl', value);
}

async function readPricingSettings() {
  if (!globalThis.chrome?.storage?.local) return { extensionId: '', apiToken: '' };
  const saved = await chrome.storage.local.get([PRICING_EXTENSION_KEY, PRICING_TOKEN_KEY]);
  return {
    extensionId: String(saved[PRICING_EXTENSION_KEY] || '').trim(),
    apiToken: String(saved[PRICING_TOKEN_KEY] || '').trim()
  };
}

async function writePricingSettings(settings) {
  if (!globalThis.chrome?.storage?.local) {
    throw new Error('Pricing pairing is available only inside the installed extension.');
  }
  await chrome.storage.local.set({
    [PRICING_EXTENSION_KEY]: settings.extensionId,
    [PRICING_TOKEN_KEY]: settings.apiToken
  });
}

async function clearPricingSettings() {
  if (!globalThis.chrome?.storage?.local) return;
  await chrome.storage.local.remove([PRICING_EXTENSION_KEY, PRICING_TOKEN_KEY]);
}

function normalizeDashboardUrl(value) {
  const url = new URL(value);
  const isLive = url.origin === ALLOWED_LIVE_ORIGIN && url.pathname.startsWith('/tcg_binder');
  const isLocal = url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
  if (!isLive && !isLocal) {
    throw new Error('Use the live dashboard URL or a localhost preview URL.');
  }
  url.hash = '';
  return url.toString();
}

function extensionOrigin() {
  if (!globalThis.chrome?.runtime?.id || !chrome.runtime.getURL) return '';
  return chrome.runtime.getURL('').replace(/\/$/, '');
}

function dashboardRequestUrl(url, forceLatest) {
  const requested = new URL(url);
  if (forceLatest) requested.searchParams.set('extensionRefresh', Date.now().toString());
  const origin = extensionOrigin();
  if (origin) requested.searchParams.set('pricingConsumerOrigin', origin);
  return requested.toString();
}

function showSourceError(message = '') {
  sourceError.textContent = message;
  sourceError.hidden = !message;
}

function setPricingStatus(message, kind = '') {
  pricingStatus.textContent = message;
  pricingStatus.classList.toggle('ok', kind === 'ok');
  pricingStatus.classList.toggle('error', kind === 'error');
}

function unavailableClient(code, message) {
  const result = () => Promise.resolve({
    apiVersion: EXPECTED_PRICING_API_VERSION,
    engineVersion: null,
    error: { code, message }
  });
  return {
    status: result,
    priceProduct: result,
    decorateCollectionPage: result,
    listWatches: result,
    upsertWatch: result,
    removeWatch: result,
    runWatches: result
  };
}

function setPageScanStatus(title, message, kind = '', diagnostics = '') {
  pageScanTitle.textContent = title;
  pageScanMessage.textContent = message;
  pageScanDiagnostics = kind === 'error' ? String(diagnostics || '') : '';
  copyPageScanDiagnosticsButton.hidden = !pageScanDiagnostics;
  copyPageScanDiagnosticsButton.classList.remove('copied');
  copyPageScanDiagnosticsButton.title = 'Copy error details';
  copyPageScanDiagnosticsButton.setAttribute('aria-label', 'Copy page-check error details');
  pageScanCopyFeedback.textContent = '';
  pageScanStatus.classList.toggle('ok', kind === 'ok');
  pageScanStatus.classList.toggle('warning', kind === 'warning');
  pageScanStatus.classList.toggle('error', kind === 'error');
  pageScanStatus.hidden = false;
}

function diagnosticText(value, maxLength = 4000) {
  let text = String(value == null ? '' : value);
  const capabilityToken = String(pricingSettings.apiToken || '');
  if (capabilityToken) text = text.split(capabilityToken).join('[REDACTED]');
  text = text.replace(/((?:api|capability)[ _-]?token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  return text.slice(0, maxLength);
}

function trackerVersion() {
  try {
    return String(globalThis.chrome?.runtime?.getManifest?.().version || 'unknown');
  } catch (_error) {
    return 'unknown';
  }
}

function buildPageScanDiagnostics({ error, stage, startedAt, snapshot, response }) {
  const now = Date.now();
  const errorCode = String(error?.code || error?.error?.code || 'UNCLASSIFIED');
  const errorMessage = String(error?.message || error?.error?.message || error || 'Page check failed.');
  const productCount = snapshot?.products && typeof snapshot.products === 'object'
    ? Object.keys(snapshot.products).length
    : 0;
  const lines = [
    'TCG Collection Tracker page-check diagnostics',
    'Generated: ' + new Date(now).toISOString(),
    'Tracker extension version: ' + trackerVersion(),
    'Tracker extension ID: ' + String(globalThis.chrome?.runtime?.id || 'unavailable'),
    'Dashboard URL: ' + currentUrl,
    'Dashboard request origin: ' + new URL(currentUrl).origin,
    'Dashboard iframe URL: ' + String(dashboard.src || 'not loaded'),
    'Dashboard loaded at: ' + (dashboardLoadedAt ? new Date(dashboardLoadedAt).toISOString() : 'not observed'),
    'Collection request timeout: ' + COLLECTION_REQUEST_TIMEOUT_MS + ' ms',
    'Collection snapshot schema: ' + String(snapshot?.schema || 'not received'),
    'Collection product count: ' + productCount,
    'Pricing paired: ' + (pricingSettings.extensionId && pricingSettings.apiToken ? 'yes' : 'no'),
    'TCG Comps extension ID: ' + String(pricingSettings.extensionId || 'not configured'),
    'Expected pricing API version: ' + EXPECTED_PRICING_API_VERSION,
    'Vendored provider version: ' + VENDORED_PROVIDER_VERSION,
    'Failure stage: ' + String(stage || 'unknown'),
    'Elapsed: ' + Math.max(0, now - Number(startedAt || now)) + ' ms',
    'Error code: ' + errorCode,
    'Error name: ' + String(error?.name || 'Error'),
    'Error message: ' + errorMessage
  ];
  if (response?.engineVersion) lines.push('Provider engine version: ' + String(response.engineVersion));
  if (response?.schema) lines.push('Provider response schema: ' + String(response.schema));
  if (error?.stack) lines.push('', 'Sanitized stack:', String(error.stack));
  lines.push('', 'The capability token is intentionally excluded.');
  return diagnosticText(lines.join('\n'));
}

async function writeClipboardText(text) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Clipboard copy was not available.');
}

async function copyPageScanDiagnostics() {
  if (!pageScanDiagnostics) return;
  try {
    await writeClipboardText(pageScanDiagnostics);
    copyPageScanDiagnosticsButton.classList.add('copied');
    copyPageScanDiagnosticsButton.title = 'Copied error details';
    copyPageScanDiagnosticsButton.setAttribute('aria-label', 'Copied page-check error details');
    pageScanCopyFeedback.textContent = 'Page-check error details copied to the clipboard.';
  } catch (error) {
    copyPageScanDiagnosticsButton.classList.remove('copied');
    copyPageScanDiagnosticsButton.title = 'Copy failed; select again to retry';
    pageScanCopyFeedback.textContent = 'Could not copy the page-check error details: ' + diagnosticText(error?.message || error, 300);
  }
}

function collectionError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cancelCollectionRequest(message = 'The dashboard was reloaded before it returned collection status.') {
  if (!collectionRequest) return;
  window.clearTimeout(collectionRequest.timer);
  collectionRequest.reject(collectionError('DASHBOARD_SNAPSHOT_CANCELLED', message));
  collectionRequest = null;
}

function requestCollectionSnapshot() {
  if (!dashboard.contentWindow) return Promise.reject(collectionError('DASHBOARD_NOT_READY', 'The dashboard is not ready yet.'));
  cancelCollectionRequest('A newer page check replaced the previous request.');
  const requestId = 'collection-' + Date.now().toString(36) + '-' + (++collectionRequestSerial).toString(36);
  const targetOrigin = new URL(currentUrl).origin;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (collectionRequest?.requestId === requestId) collectionRequest = null;
      reject(collectionError('DASHBOARD_SNAPSHOT_TIMEOUT', 'The dashboard did not return collection status. Refresh the dashboard and try again.'));
    }, COLLECTION_REQUEST_TIMEOUT_MS);
    collectionRequest = { requestId, targetOrigin, resolve, reject, timer };
    dashboard.contentWindow.postMessage({
      channel: COLLECTION_CHANNEL,
      type: 'collectionSnapshot',
      requestId
    }, targetOrigin);
  });
}

window.addEventListener('message', (event) => {
  const pending = collectionRequest;
  if (!pending || event.origin !== pending.targetOrigin || event.source !== dashboard.contentWindow) return;
  const message = event.data;
  if (!message || message.channel !== COLLECTION_CHANNEL || message.type !== 'collectionSnapshotResult' || message.requestId !== pending.requestId) return;
  window.clearTimeout(pending.timer);
  collectionRequest = null;
  if (message.error) pending.reject(collectionError(String(message.error.code || 'SNAPSHOT_BUILD_FAILED'), String(message.error.message || message.error.code || 'Collection snapshot failed.')));
  else pending.resolve(message.result);
});

function validateCollectionSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== COLLECTION_SNAPSHOT_SCHEMA) {
    throw new Error('The dashboard needs the collection page-check update. Refresh it and try again.');
  }
  const checked = globalThis.TCGPricingContracts?.validateCollectionSnapshot?.(snapshot);
  if (!checked?.ok) {
    throw new Error('The dashboard returned invalid collection status: ' + String(checked?.errors?.[0] || 'validation failed'));
  }
  return checked.value;
}

function pageScanErrorMessage(error) {
  const code = String(error?.code || error?.error?.code || '');
  const message = String(error?.message || error?.error?.message || error || 'Page check failed.');
  if (code === 'UNAUTHORIZED' || /UNAUTHORIZED/.test(message)) return 'Re-pair TCG Comps in Settings, then try again.';
  if (code === 'USER_ACTION_REQUIRED') return 'Select the page-check button again to start a user-requested scan.';
  if (code === 'TARGET_TAB_REQUIRED' || code === 'CONTENT_UNAVAILABLE') return 'Open or refresh a supported marketplace or storefront page, then try again.';
  if (code === 'INVALID_COLLECTION_SNAPSHOT') return 'Refresh the dashboard so it can provide the current collection catalog.';
  if (code === 'PAGE_DECORATION_UNAVAILABLE' || code === 'PAGE_DECORATION_FAILED') return 'Reload TCG Comps and the marketplace page, then try again.';
  if (/receiving end|could not establish connection|not exist/i.test(message)) return 'TCG Comps is unavailable. Reload it and the marketplace page, then try again.';
  return message;
}

function summarizePageDecoration(response) {
  const results = Array.isArray(response?.results) ? response.results : [];
  const counts = { NEED: 0, OWNED: 0, TARGET: 0, CHECK: 0 };
  results.forEach((result) => {
    const disposition = String(result?.disposition || '').toUpperCase();
    if (Object.prototype.hasOwnProperty.call(counts, disposition)) counts[disposition] += 1;
  });
  const parts = [];
  if (counts.NEED) parts.push(counts.NEED + ' needed');
  if (counts.OWNED) parts.push(counts.OWNED + ' already owned');
  if (counts.TARGET) parts.push(counts.TARGET + ' tracked');
  if (counts.CHECK) parts.push(counts.CHECK + ' to check');
  if (!parts.length) parts.push('no tracked listings found');
  return {
    title: 'Page marked with collection status',
    message: parts.join(' · ') + (response?.adapter ? ' · ' + response.adapter : ''),
    kind: counts.CHECK || Number(response?.unresolved || 0) ? 'warning' : 'ok'
  };
}

async function decorateCollectionPage() {
  if (pageScanRunning) return;
  const startedAt = Date.now();
  let stage = 'starting-page-check';
  let snapshot = null;
  let response = null;
  pageScanRunning = true;
  scanPageButton.disabled = true;
  scanPageButton.classList.add('loading');
  setPageScanStatus('Checking this page…', 'Getting your current collection and asking TCG Comps to identify the visible listings.');
  try {
    stage = 'creating-pricing-client';
    pricingClient = createPricingClient();
    if (typeof pricingClient.decorateCollectionPage !== 'function') {
      throw new Error('Reload the updated Tracker and TCG Comps extensions before checking a page.');
    }
    stage = 'requesting-dashboard-snapshot';
    snapshot = validateCollectionSnapshot(await requestCollectionSnapshot());
    stage = 'calling-tcg-comps';
    response = await pricingClient.decorateCollectionPage(snapshot, { observe: true, userInitiated: true });
    if (response?.error) {
      const error = new Error(String(response.error.message || response.error.code || 'Page check failed.'));
      error.code = response.error.code;
      throw error;
    }
    stage = 'validating-provider-response';
    if (Number(response?.apiVersion) !== EXPECTED_PRICING_API_VERSION || response?.schema !== COLLECTION_RESULT_SCHEMA) {
      throw new Error('TCG Comps returned an incompatible page-check response. Reload both extensions.');
    }
    const summary = summarizePageDecoration(response);
    setPageScanStatus(summary.title, summary.message, summary.kind);
  } catch (error) {
    const diagnostics = buildPageScanDiagnostics({ error, stage, startedAt, snapshot, response });
    setPageScanStatus('Page check could not finish', pageScanErrorMessage(error), 'error', diagnostics);
  } finally {
    pageScanRunning = false;
    scanPageButton.disabled = false;
    scanPageButton.classList.remove('loading');
  }
}

function createPricingClient() {
  if (!globalThis.chrome?.runtime?.sendMessage) {
    return unavailableClient('MISSING_EXTENSION', 'Pricing is available only in the installed tracker extension.');
  }
  if (!/^[a-p]{32}$/.test(pricingSettings.extensionId) || !pricingSettings.apiToken) {
    return unavailableClient('UNAUTHORIZED', 'Pair TCG Comps in the tracker extension settings.');
  }
  try {
    return TCGPricingClient.createClient({
      runtime: chrome.runtime,
      extensionId: pricingSettings.extensionId,
      apiToken: pricingSettings.apiToken
    });
  } catch (error) {
    return unavailableClient('UNAUTHORIZED', String(error && error.message || error));
  }
}

function installPricingBridge() {
  if (pricingBridge) pricingBridge.dispose();
  pricingClient = createPricingClient();
  const origin = new URL(currentUrl).origin;
  pricingBridge = TCGPricingBridge.createDashboardBridge({
    windowObject: window,
    frame: dashboard,
    client: pricingClient,
    allowedOrigins: [origin]
  });
}

async function testPricingConnection() {
  pricingClient = createPricingClient();
  try {
    const response = await pricingClient.status();
    if (response?.error) throw new Error(response.error.code + ': ' + response.error.message);
    if (Number(response?.apiVersion) !== EXPECTED_PRICING_API_VERSION) {
      throw new Error('UNSUPPORTED_VERSION: TCG Comps returned API version ' + String(response?.apiVersion));
    }
    const version = String(response?.engineVersion || 'unknown');
    const versionNote = version === VENDORED_PROVIDER_VERSION
      ? ''
      : ' Version note only: the bundled client artifacts originated with ' + VENDORED_PROVIDER_VERSION + '.';
    setPricingStatus('Connected to TCG Comps ' + version + '. API v1 is compatible.' + versionNote, 'ok');
    return true;
  } catch (error) {
    const message = String(error && error.message || error);
    const unavailable = /receiving end|could not establish connection|not exist/i.test(message);
    setPricingStatus(unavailable
      ? 'TCG Comps is unavailable. Install or reload it, then test again.'
      : 'Pricing connection failed: ' + message, 'error');
    return false;
  }
}

function startLoad(url, forceLatest = false) {
  cancelCollectionRequest();
  window.clearTimeout(loadTimer);
  loadError.hidden = true;
  status.classList.remove('ready');
  status.textContent = forceLatest ? 'Getting latest dashboard…' : 'Loading dashboard…';
  installPricingBridge();
  dashboard.src = dashboardRequestUrl(url, forceLatest);
  loadTimer = window.setTimeout(() => {
    status.textContent = 'Dashboard may be unavailable';
    loadError.hidden = false;
  }, 15000);
}

dashboard.addEventListener('load', () => {
  window.clearTimeout(loadTimer);
  loadError.hidden = true;
  status.textContent = currentUrl.startsWith('http://') ? 'Local preview' : 'Live dashboard';
  status.classList.add('ready');
  dashboardLoadedAt = Date.now();
});

document.getElementById('refresh').addEventListener('click', () => startLoad(currentUrl, true));
document.getElementById('retry').addEventListener('click', () => startLoad(currentUrl, true));
scanPageButton.addEventListener('click', decorateCollectionPage);
copyPageScanDiagnosticsButton.addEventListener('click', copyPageScanDiagnostics);
document.getElementById('closePageScanStatus').addEventListener('click', () => { pageScanStatus.hidden = true; });

document.getElementById('openTab').addEventListener('click', () => {
  if (globalThis.chrome?.tabs?.create) chrome.tabs.create({ url: currentUrl });
  else window.open(currentUrl, '_blank', 'noopener');
});

settingsButton.addEventListener('click', () => {
  const willOpen = settingsPanel.hidden;
  settingsPanel.hidden = !willOpen;
  settingsButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) {
    dashboardUrl.value = currentUrl;
    pricingExtensionId.value = pricingSettings.extensionId;
    pricingToken.value = '';
    pricingToken.placeholder = pricingSettings.apiToken ? 'Stored securely; paste to replace' : 'Paste capability token';
    dashboardUrl.focus();
  }
});

sourceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    currentUrl = normalizeDashboardUrl(dashboardUrl.value.trim());
    await saveDashboardUrl(currentUrl);
    showSourceError();
    startLoad(currentUrl, true);
  } catch (error) {
    showSourceError(error.message);
  }
});

document.getElementById('useLive').addEventListener('click', async () => {
  currentUrl = DEFAULT_DASHBOARD_URL;
  dashboardUrl.value = currentUrl;
  await saveDashboardUrl(currentUrl);
  showSourceError();
  startLoad(currentUrl, true);
});

pricingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const extensionId = pricingExtensionId.value.trim();
  const apiToken = pricingToken.value.trim() || pricingSettings.apiToken;
  if (!/^[a-p]{32}$/.test(extensionId)) {
    setPricingStatus('Enter the 32-character TCG Comps extension ID.', 'error');
    return;
  }
  if (!apiToken) {
    setPricingStatus('Paste the capability token copied from TCG Comps.', 'error');
    return;
  }
  pricingSettings = { extensionId, apiToken };
  await writePricingSettings(pricingSettings);
  pricingToken.value = '';
  pricingToken.placeholder = 'Stored securely; paste to replace';
  installPricingBridge();
  await testPricingConnection();
});

document.getElementById('clearPricing').addEventListener('click', async () => {
  await clearPricingSettings();
  pricingSettings = { extensionId: '', apiToken: '' };
  pricingExtensionId.value = '';
  pricingToken.value = '';
  pricingToken.placeholder = 'Paste capability token';
  installPricingBridge();
  setPricingStatus('Pricing pairing removed.');
});

async function boot() {
  const [savedDashboard, savedPricing] = await Promise.all([readDashboardUrl(), readPricingSettings()]);
  pricingSettings = savedPricing;
  try {
    currentUrl = normalizeDashboardUrl(savedDashboard.dashboardUrl);
  } catch (_error) {
    currentUrl = DEFAULT_DASHBOARD_URL;
    await saveDashboardUrl(currentUrl);
  }
  dashboardUrl.value = currentUrl;
  pricingExtensionId.value = pricingSettings.extensionId;
  pricingToken.placeholder = pricingSettings.apiToken ? 'Stored securely; paste to replace' : 'Paste capability token';
  consumerExtensionId.textContent = globalThis.chrome?.runtime?.id || 'Unavailable outside the extension';
  setPricingStatus(pricingSettings.extensionId && pricingSettings.apiToken
    ? 'Pairing stored. Testing TCG Comps…'
    : 'Pricing is not paired.');
  startLoad(currentUrl);
  if (pricingSettings.extensionId && pricingSettings.apiToken) await testPricingConnection();
}

boot().catch((error) => {
  status.textContent = 'Extension failed to start';
  loadError.hidden = false;
  setPricingStatus('Extension startup failed.', 'error');
  console.error(error);
});
