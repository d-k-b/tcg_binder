const DEFAULT_DASHBOARD_URL = 'https://d-k-b.github.io/tcg_binder/';
const ALLOWED_LIVE_ORIGIN = 'https://d-k-b.github.io';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const PRICING_EXTENSION_KEY = 'tcgCompsExtensionId';
const PRICING_TOKEN_KEY = 'tcgCompsApiToken';
const VISION_KEY = 'openaiVisionApiKey';
const VISION_SAFETY_KEY = 'openaiVisionSafetyId';
const EXPECTED_PRICING_API_VERSION = 1;
const VENDORED_PROVIDER_VERSION = '2.42.0';
const COLLECTION_CHANNEL = 'tcg-collection/v1';
const COLLECTION_SNAPSHOT_SCHEMA = 'tcg.collection-snapshot/v2';
const COLLECTION_RESULT_SCHEMA = 'tcg.collection-decoration-result/v2';
const COLLECTION_REQUEST_TIMEOUT_MS = 10000;
const MONITOR_REQUEST_TIMEOUT_MS = 10000;
const MONITOR_DEBOUNCE_MS = 900;
const IDENTIFY_CHANNEL = 'tcg-product-identify/v1';
const COLLECTION_AUTHOR_CHANNEL = 'tcg-collection-author/v1';

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
const visionForm = document.getElementById('visionForm');
const visionKeyInput = document.getElementById('openaiVisionApiKey');
const rememberVisionKey = document.getElementById('rememberOpenaiKey');
const visionStatus = document.getElementById('visionStatus');
const consumerExtensionId = document.getElementById('consumerExtensionId');
const scanPageButton = document.getElementById('scanPage');
const pageScanStatus = document.getElementById('pageScanStatus');
const pageScanTitle = document.getElementById('pageScanTitle');
const pageScanMessage = document.getElementById('pageScanMessage');
const copyPageScanDiagnosticsButton = document.getElementById('copyPageScanDiagnostics');
const pageScanCopyFeedback = document.getElementById('pageScanCopyFeedback');
const syncMonitorButton = document.getElementById('syncMonitor');
const refreshMonitorStatusButton = document.getElementById('refreshMonitorStatus');
const runMonitorButton = document.getElementById('runMonitor');
const monitorStatus = document.getElementById('monitorStatus');
const monitorDetails = document.getElementById('monitorDetails');
const monitorRevision = document.getElementById('monitorRevision');
const monitorProductCount = document.getElementById('monitorProductCount');
const monitorTargetCount = document.getElementById('monitorTargetCount');
const monitorSyncedAt = document.getElementById('monitorSyncedAt');
const monitorDiagnosticActions = document.getElementById('monitorDiagnosticActions');
const copyMonitorDiagnosticsButton = document.getElementById('copyMonitorDiagnostics');
const monitorCopyFeedback = document.getElementById('monitorCopyFeedback');

let currentUrl = DEFAULT_DASHBOARD_URL;
let loadTimer = null;
let pricingBridge = null;
let pricingClient = null;
let pricingSettings = { extensionId: '', apiToken: '' };
let visionSettings = { apiKey: '', remembered: false, safetyIdentifier: '' };
let identifyRunning = false;
let authorRunning = false;
let collectionRequest = null;
let collectionRequestSerial = 0;
let pageScanRunning = false;
let pageScanDiagnostics = '';
let dashboardLoadedAt = null;
let dashboardMonitorBridge = null;
const monitorRevisionGate = globalThis.TCGCollectionMonitorBridge.createRevisionGate();
let monitorSyncRunning = false;
let lastForwardedMonitorRevision = '';
let lastMonitorSubscriptionProductCount = 0;
let lastMonitorDetails = {
  revision: '',
  productCount: null,
  activeTargetCount: null,
  syncedAt: ''
};
let monitorDiagnostics = '';

function dashboardFrameIsReady() {
  if (!dashboard.getAttribute('src') || !dashboard.contentWindow) return false;
  const targetOrigin = new URL(currentUrl).origin;
  try {
    return new URL(dashboard.contentWindow.location.href).origin === targetOrigin;
  } catch (_crossOriginFrame) {
    return true;
  }
}

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

function newSafetyIdentifier() {
  if (globalThis.crypto?.randomUUID) return 'tracker-' + crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return 'tracker-' + Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
}

async function readVisionSettings() {
  if (!globalThis.chrome?.storage?.local) return { apiKey: '', remembered: false, safetyIdentifier: '' };
  const saved = await chrome.storage.local.get([VISION_KEY, VISION_SAFETY_KEY]);
  let safetyIdentifier = String(saved[VISION_SAFETY_KEY] || '').trim();
  if (!safetyIdentifier) {
    safetyIdentifier = newSafetyIdentifier();
    await chrome.storage.local.set({ [VISION_SAFETY_KEY]: safetyIdentifier });
  }
  return { apiKey: String(saved[VISION_KEY] || '').trim(), remembered: !!saved[VISION_KEY], safetyIdentifier };
}

async function writeVisionSettings(apiKey, remember) {
  if (!globalThis.chrome?.storage?.local) throw new Error('Photo identification settings require the installed extension.');
  if (remember) await chrome.storage.local.set({ [VISION_KEY]: apiKey });
  else await chrome.storage.local.remove(VISION_KEY);
}

async function clearVisionSettings() {
  if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(VISION_KEY);
}

function setVisionStatus(message, kind = '') {
  visionStatus.textContent = message;
  visionStatus.classList.toggle('ok', kind === 'ok');
  visionStatus.classList.toggle('error', kind === 'error');
  visionStatus.classList.toggle('warning', kind === 'warning');
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
    syncMonitorCollection: result,
    monitorStatus: result,
    runMonitor: result,
    listWatches: result,
    upsertWatch: result,
    removeWatch: result,
    runWatches: result
  };
}

function setMonitorStatus(message, kind = '') {
  monitorStatus.textContent = message;
  monitorStatus.classList.toggle('ok', kind === 'ok');
  monitorStatus.classList.toggle('warning', kind === 'warning');
  monitorStatus.classList.toggle('error', kind === 'error');
}

function monitorTimestamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Date(value).toLocaleString();
}

function renderMonitorDetails(result = {}) {
  const lastSync = result.lastSync && typeof result.lastSync === 'object' ? result.lastSync : {};
  const revision = String(result.revision || lastSync.revision || lastMonitorDetails.revision || lastForwardedMonitorRevision || '—');
  const productCount = Number.isInteger(result.productCount)
    ? result.productCount
    : (Number.isInteger(lastSync.productCount)
      ? lastSync.productCount
      : (Number.isInteger(lastMonitorDetails.productCount) ? lastMonitorDetails.productCount : lastMonitorSubscriptionProductCount));
  const activeTargetCount = Number.isInteger(result.activeTargetCount)
    ? result.activeTargetCount
    : (Number.isInteger(lastSync.activeTargetCount) ? lastSync.activeTargetCount : lastMonitorDetails.activeTargetCount);
  const syncedAt = result.syncedAt || lastSync.syncedAt || lastMonitorDetails.syncedAt || '';
  if (revision !== '—') lastMonitorDetails.revision = revision;
  if (Number.isInteger(productCount)) lastMonitorDetails.productCount = productCount;
  if (Number.isInteger(activeTargetCount)) lastMonitorDetails.activeTargetCount = activeTargetCount;
  if (syncedAt && Number.isFinite(Date.parse(syncedAt))) lastMonitorDetails.syncedAt = new Date(syncedAt).toISOString();
  monitorRevision.textContent = revision;
  monitorProductCount.textContent = productCount || productCount === 0 ? String(productCount) : '—';
  monitorTargetCount.textContent = activeTargetCount == null ? '—' : String(activeTargetCount);
  monitorSyncedAt.textContent = monitorTimestamp(syncedAt);
  monitorDetails.hidden = false;
}

function monitorSyncStatusPayload(state, details = {}) {
  const allowedStates = new Set(['idle', 'syncing', 'synced', 'error', 'unavailable']);
  return {
    schema: 'tcg.collection-monitor-sync-status/v1',
    state: allowedStates.has(state) ? state : 'error',
    revision: details.revision == null ? null : diagnosticText(details.revision, 160),
    productCount: Number.isInteger(details.productCount) && details.productCount >= 0 ? details.productCount : null,
    activeTargetCount: Number.isInteger(details.activeTargetCount) && details.activeTargetCount >= 0 ? details.activeTargetCount : null,
    monitorConfigured: typeof details.monitorConfigured === 'boolean' ? details.monitorConfigured : null,
    syncedAt: details.syncedAt && Number.isFinite(Date.parse(details.syncedAt)) ? new Date(details.syncedAt).toISOString() : null,
    message: details.message == null ? null : diagnosticText(details.message, 300),
    errorCode: details.errorCode == null ? null : diagnosticText(details.errorCode, 80)
  };
}

function publishMonitorSyncStatus(state, details = {}) {
  if (!dashboardMonitorBridge) return Promise.resolve(null);
  return dashboardMonitorBridge.postSyncStatus(monitorSyncStatusPayload(state, details));
}

function publishMonitorSyncStatusQuietly(state, details = {}) {
  publishMonitorSyncStatus(state, details).catch(() => {});
}

function setMonitorBusy(busy) {
  monitorSyncRunning = busy;
  syncMonitorButton.disabled = busy;
  refreshMonitorStatusButton.disabled = busy;
  runMonitorButton.disabled = busy;
}

function monitorErrorMessage(error) {
  const code = String(error?.code || error?.error?.code || '');
  const message = String(error?.message || error?.error?.message || error || 'Monitor request failed.');
  if (code === 'UNAUTHORIZED' || /UNAUTHORIZED/.test(message)) return 'Re-pair TCG Comps in Settings, then retry the monitor.';
  if (code === 'MONITOR_SUBSCRIPTION_TIMEOUT') return 'The dashboard did not return monitor settings. Refresh the dashboard and try again.';
  if (code === 'MONITOR_NOT_CONFIGURED') return 'The always-on monitor service is not configured in TCG Comps yet.';
  if (code === 'MONITOR_UNAVAILABLE') return 'The always-on monitor service is offline or unreachable. Check TCG Comps monitor settings, then retry.';
  if (code === 'MONITOR_HTTP_ERROR') return 'The always-on monitor service returned an HTTP error. Check its status, then retry.';
  if (code === 'MONITOR_REJECTED') return 'The monitor did not accept the exact collection revision. Check the monitor service, then retry.';
  if (code === 'USER_ACTION_REQUIRED') return 'Select Run now again to start a user-requested monitor run.';
  if (/receiving end|could not establish connection|not exist/i.test(message)) return 'TCG Comps is unavailable. Reload it, then try again.';
  return message;
}

function buildMonitorDiagnostics({ error, stage, reason, startedAt, subscription, response }) {
  const now = Date.now();
  const productCount = subscription?.collection?.products && typeof subscription.collection.products === 'object'
    ? Object.keys(subscription.collection.products).length
    : 0;
  const lines = [
    'TCG Collection Tracker monitor diagnostics',
    'Generated: ' + new Date(now).toISOString(),
    'Tracker extension version: ' + trackerVersion(),
    'Tracker extension ID: ' + String(globalThis.chrome?.runtime?.id || 'unavailable'),
    'Dashboard URL: ' + currentUrl,
    'Dashboard request origin: ' + new URL(currentUrl).origin,
    'Dashboard loaded at: ' + (dashboardLoadedAt ? new Date(dashboardLoadedAt).toISOString() : 'not observed'),
    'TCG Comps extension ID: ' + String(pricingSettings.extensionId || 'not configured'),
    'Pricing paired: ' + (pricingSettings.extensionId && pricingSettings.apiToken ? 'yes' : 'no'),
    'Expected pricing API version: ' + EXPECTED_PRICING_API_VERSION,
    'Vendored provider version: ' + VENDORED_PROVIDER_VERSION,
    'Monitor channel: ' + String(globalThis.TCGCollectionMonitorBridge?.CHANNEL || 'unavailable'),
    'Subscription schema: ' + String(subscription?.schema || 'not received'),
    'Subscription revision: ' + String(subscription?.revision || 'not received'),
    'Collection product count: ' + productCount,
    'Request reason: ' + String(reason || 'unknown'),
    'Failure stage: ' + String(stage || 'unknown'),
    'Elapsed: ' + Math.max(0, now - Number(startedAt || now)) + ' ms',
    'Error code: ' + String(error?.code || error?.error?.code || 'UNCLASSIFIED'),
    'Error name: ' + String(error?.name || 'Error'),
    'Error message: ' + String(error?.message || error?.error?.message || error || 'Monitor request failed.')
  ];
  if (response?.engineVersion) lines.push('Provider engine version: ' + String(response.engineVersion));
  if (response?.revision) lines.push('Provider revision: ' + String(response.revision));
  if (response?.monitorConfigured != null) lines.push('Monitor configured: ' + String(Boolean(response.monitorConfigured)));
  else if (response?.configured != null) lines.push('Monitor configured: ' + String(Boolean(response.configured)));
  if (error?.stack) lines.push('', 'Sanitized stack:', String(error.stack));
  lines.push('', 'No subscription body, GitHub/Gist credential, provider capability token, monitor bearer token, or email address is included.');
  return diagnosticText(lines.join('\n'));
}

function showMonitorError(error, context) {
  monitorDiagnostics = buildMonitorDiagnostics({ error, ...context });
  monitorDiagnosticActions.hidden = false;
  monitorCopyFeedback.textContent = '';
  setMonitorStatus(monitorErrorMessage(error), 'error');
}

function clearMonitorDiagnostics() {
  monitorDiagnostics = '';
  monitorDiagnosticActions.hidden = true;
  monitorCopyFeedback.textContent = '';
}

async function copyMonitorDiagnostics() {
  if (!monitorDiagnostics) return;
  try {
    await writeClipboardText(monitorDiagnostics);
    monitorCopyFeedback.textContent = 'Monitor error details copied to the clipboard.';
    copyMonitorDiagnosticsButton.textContent = 'Copied error details';
    window.setTimeout(() => { copyMonitorDiagnosticsButton.textContent = 'Copy error details'; }, 1800);
  } catch (error) {
    monitorCopyFeedback.textContent = 'Could not copy monitor error details: ' + diagnosticText(error?.message || error, 300);
  }
}

function validateMonitorSubscription(subscription) {
  const validator = globalThis.TCGCollectionMonitorBridge?.validateSubscription;
  if (typeof validator !== 'function') throw collectionError('MONITOR_BRIDGE_UNAVAILABLE', 'Reload the updated Tracker extension.');
  const checked = validator(subscription, globalThis.TCGPricingContracts?.validateCollectionSnapshot);
  if (!checked?.ok) {
    throw collectionError('INVALID_MONITOR_SUBSCRIPTION', 'The dashboard returned invalid monitor settings: ' + String(checked?.errors?.[0] || 'validation failed'));
  }
  return checked.value;
}

function providerMonitorMethod(client, name) {
  if (client && typeof client[name] === 'function') return client[name].bind(client);
  throw collectionError('MONITOR_CLIENT_UNAVAILABLE', 'Reload the updated Tracker and TCG Comps extensions before using the monitor.');
}

function validateMonitorSyncResponse(response, subscription) {
  if (response?.error) throw collectionError(String(response.error.code || 'MONITOR_SYNC_FAILED'), String(response.error.message || response.error.code || 'Monitor sync failed.'));
  if (Number(response?.apiVersion) !== EXPECTED_PRICING_API_VERSION) throw collectionError('UNSUPPORTED_VERSION', 'TCG Comps returned an incompatible API version.');
  if (response.schema !== globalThis.TCGPricingContracts?.MONITOR_SYNC_RESULT_SCHEMA) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps returned an incompatible monitor sync schema.');
  }
  if (response.accepted !== true || response.revision !== subscription.revision) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps did not confirm the exact monitor subscription revision.');
  }
  if (!Number.isInteger(response.productCount) || response.productCount !== Object.keys(subscription.collection.products).length) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps returned a different monitor product count.');
  }
  return response;
}

function validateMonitorStatusResponse(response) {
  if (response?.error) throw collectionError(String(response.error.code || 'MONITOR_STATUS_FAILED'), String(response.error.message || response.error.code || 'Monitor status failed.'));
  if (Number(response?.apiVersion) !== EXPECTED_PRICING_API_VERSION) throw collectionError('UNSUPPORTED_VERSION', 'TCG Comps returned an incompatible API version.');
  if (response.schema !== globalThis.TCGPricingContracts?.MONITOR_STATUS_SCHEMA) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps returned an incompatible monitor status schema.');
  }
  if (typeof response.configured !== 'boolean' || typeof response.online !== 'boolean' || (response.online && !response.configured)) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps returned invalid monitor availability state.');
  }
  return response;
}

function validateMonitorRunResponse(response) {
  if (response?.error) throw collectionError(String(response.error.code || 'MONITOR_RUN_FAILED'), String(response.error.message || response.error.code || 'Monitor run failed.'));
  if (Number(response?.apiVersion) !== EXPECTED_PRICING_API_VERSION) throw collectionError('UNSUPPORTED_VERSION', 'TCG Comps returned an incompatible API version.');
  if (response.schema !== globalThis.TCGPricingContracts?.MONITOR_RUN_RESULT_SCHEMA || response.accepted !== true) {
    throw collectionError('INVALID_MONITOR_RESPONSE', 'TCG Comps did not confirm the requested monitor run.');
  }
  return response;
}

async function syncCollectionMonitor({ userInitiated = false, reason = 'automatic' } = {}) {
  if (monitorSyncRunning) return;
  const startedAt = Date.now();
  let stage = 'requesting-dashboard-subscription';
  let subscription = null;
  let response = null;
  setMonitorBusy(true);
  clearMonitorDiagnostics();
  setMonitorStatus(userInitiated ? 'Syncing collection monitor…' : 'Updating collection monitor…');
  publishMonitorSyncStatusQuietly('syncing', { message: userInitiated ? 'Manual monitor sync in progress.' : 'Collection change sync in progress.' });
  try {
    if (!dashboardMonitorBridge) throw collectionError('MONITOR_BRIDGE_UNAVAILABLE', 'The dashboard monitor bridge is not ready yet.');
    subscription = validateMonitorSubscription(await dashboardMonitorBridge.requestSubscription());
    lastMonitorSubscriptionProductCount = Object.keys(subscription.collection.products).length;
    if (!monitorRevisionGate.shouldForward(subscription.revision, userInitiated)) {
      renderMonitorDetails({ revision: subscription.revision, productCount: lastMonitorSubscriptionProductCount });
      setMonitorStatus('Monitor already has this collection revision.', 'ok');
      publishMonitorSyncStatusQuietly('synced', {
        revision: subscription.revision,
        productCount: lastMonitorSubscriptionProductCount,
        message: 'Monitor already has this collection revision.'
      });
      return;
    }
    stage = 'calling-tcg-comps-sync';
    pricingClient = createPricingClient();
    response = await providerMonitorMethod(pricingClient, 'syncMonitorCollection')(subscription);
    stage = 'validating-tcg-comps-sync';
    validateMonitorSyncResponse(response, subscription);
    lastForwardedMonitorRevision = subscription.revision;
    monitorRevisionGate.accept(subscription.revision);
    renderMonitorDetails(response);
    setMonitorStatus(response.monitorConfigured === false
      ? 'Collection synced, but the always-on monitor service is not configured.'
      : 'Collection monitor synced.', response.monitorConfigured === false ? 'warning' : 'ok');
    publishMonitorSyncStatusQuietly('synced', {
      revision: response.revision,
      productCount: response.productCount,
      activeTargetCount: response.activeTargetCount,
      monitorConfigured: response.monitorConfigured,
      syncedAt: response.syncedAt,
      message: response.monitorConfigured === false ? 'Collection synced; monitor service is not configured.' : 'Collection monitor synced.'
    });
  } catch (error) {
    showMonitorError(error, { stage, reason, startedAt, subscription, response });
    const code = String(error?.code || error?.error?.code || 'MONITOR_SYNC_FAILED');
    const unavailableCodes = new Set(['UNAUTHORIZED', 'MONITOR_CLIENT_UNAVAILABLE', 'MONITOR_NOT_CONFIGURED', 'MONITOR_UNAVAILABLE', 'MONITOR_HTTP_ERROR']);
    publishMonitorSyncStatusQuietly(unavailableCodes.has(code) ? 'unavailable' : 'error', {
      revision: subscription?.revision || null,
      productCount: lastMonitorSubscriptionProductCount || null,
      monitorConfigured: response?.monitorConfigured,
      message: monitorErrorMessage(error),
      errorCode: code
    });
  } finally {
    setMonitorBusy(false);
  }
}

async function refreshCollectionMonitorStatus({ quiet = false } = {}) {
  if (monitorSyncRunning) return;
  const startedAt = Date.now();
  let response = null;
  if (!quiet) setMonitorBusy(true);
  if (!quiet) clearMonitorDiagnostics();
  if (!quiet) setMonitorStatus('Checking monitor status…');
  try {
    pricingClient = createPricingClient();
    response = await providerMonitorMethod(pricingClient, 'monitorStatus')();
    validateMonitorStatusResponse(response);
    const acceptedRevision = response.revision || response.lastSync?.revision || '';
    if (acceptedRevision) {
      lastForwardedMonitorRevision = String(acceptedRevision);
      monitorRevisionGate.accept(acceptedRevision);
    }
    renderMonitorDetails(response);
    clearMonitorDiagnostics();
    const message = !response.configured
      ? 'The always-on monitor service is not configured.'
      : (!response.online ? String(response.warning?.message || 'The always-on monitor service is offline or unreachable.') : 'Monitor status is current.');
    const kind = response.configured && response.online ? 'ok' : 'warning';
    setMonitorStatus(message, kind);
    const lastSync = response.lastSync && typeof response.lastSync === 'object' ? response.lastSync : {};
    publishMonitorSyncStatusQuietly(!response.configured || !response.online ? 'unavailable' : (acceptedRevision ? 'synced' : 'idle'), {
      revision: acceptedRevision || null,
      productCount: Number.isInteger(response.productCount) ? response.productCount : lastSync.productCount,
      activeTargetCount: Number.isInteger(response.activeTargetCount) ? response.activeTargetCount : lastSync.activeTargetCount,
      monitorConfigured: response.configured,
      syncedAt: lastSync.syncedAt || null,
      message,
      errorCode: response.warning?.code || (!response.configured ? 'MONITOR_NOT_CONFIGURED' : (!response.online ? 'MONITOR_UNAVAILABLE' : null))
    });
  } catch (error) {
    const code = String(error?.code || error?.error?.code || 'MONITOR_STATUS_FAILED');
    if (!quiet) showMonitorError(error, { stage: 'calling-tcg-comps-status', reason: 'status-button', startedAt, response });
    else setMonitorStatus(monitorErrorMessage(error), 'warning');
    publishMonitorSyncStatusQuietly(code === 'UNAUTHORIZED' || code === 'MONITOR_CLIENT_UNAVAILABLE' || code === 'MONITOR_UNAVAILABLE' ? 'unavailable' : 'error', {
      message: monitorErrorMessage(error), errorCode: code
    });
  } finally {
    if (!quiet) setMonitorBusy(false);
  }
}

async function runCollectionMonitorNow() {
  if (monitorSyncRunning) return;
  const startedAt = Date.now();
  let response = null;
  setMonitorBusy(true);
  clearMonitorDiagnostics();
  setMonitorStatus('Starting a monitor run…');
  try {
    pricingClient = createPricingClient();
    response = await providerMonitorMethod(pricingClient, 'runMonitor')();
    validateMonitorRunResponse(response);
    renderMonitorDetails(response);
    setMonitorStatus('Monitor run requested. Scheduled delivery remains provider-controlled.', 'ok');
  } catch (error) {
    showMonitorError(error, { stage: 'calling-tcg-comps-run', reason: 'run-button', startedAt, response });
  } finally {
    setMonitorBusy(false);
  }
}

function installDashboardMonitorBridge() {
  if (dashboardMonitorBridge) dashboardMonitorBridge.dispose();
  dashboardMonitorBridge = globalThis.TCGCollectionMonitorBridge.createBridge({
    windowObject: window,
    frame: dashboard,
    getTargetOrigin: () => new URL(currentUrl).origin,
    isReady: dashboardFrameIsReady,
    isActive: () => document.visibilityState === 'visible',
    requestTimeoutMs: MONITOR_REQUEST_TIMEOUT_MS,
    debounceMs: MONITOR_DEBOUNCE_MS,
    onStateChanged: () => syncCollectionMonitor({ reason: 'dashboard-state-changed' })
  });
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
  const visionKey = String(visionSettings.apiKey || '');
  if (visionKey) text = text.split(visionKey).join('[REDACTED]');
  text = text.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
  text = text.replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]');
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

async function handleIdentifyMessage(event) {
  const targetOrigin = new URL(currentUrl).origin;
  if (event.origin !== targetOrigin || event.source !== dashboard.contentWindow) return;
  const message = event.data;
  if (!message || message.channel !== IDENTIFY_CHANNEL || message.type !== 'identifyProduct' ||
      !globalThis.TCGProductIdentify?.validRequestId?.(message.requestId)) return;
  const source = event.source;
  const requestId = message.requestId;
  const respond = payload => {
    if (source !== dashboard.contentWindow || targetOrigin !== new URL(currentUrl).origin) return;
    source.postMessage(Object.assign({ channel: IDENTIFY_CHANNEL, type: 'identifyProductResult', requestId }, payload), targetOrigin);
  };
  if (identifyRunning) {
    respond({ error: { code: 'IDENTIFY_BUSY', message: 'Finish or dismiss the current photo identification before starting another.' } });
    return;
  }
  identifyRunning = true;
  try {
    const request = globalThis.TCGProductIdentify.validateIdentifyRequest(message);
    const result = await globalThis.TCGProductIdentify.identifyProduct(visionSettings.apiKey, request, {
      safetyIdentifier: visionSettings.safetyIdentifier
    });
    respond({ result });
  } catch (error) {
    respond({ error: {
      code: String(error?.code || 'IDENTIFY_FAILED').slice(0, 80),
      message: diagnosticText(error?.message || error || 'Product identification failed.', 400)
    } });
  } finally {
    identifyRunning = false;
  }
}

window.addEventListener('message', event => {
  handleIdentifyMessage(event).catch(() => {});
});

async function handleCollectionAuthorMessage(event) {
  const targetOrigin = new URL(currentUrl).origin;
  if (event.origin !== targetOrigin || event.source !== dashboard.contentWindow) return;
  const message = event.data;
  if (!message || message.channel !== COLLECTION_AUTHOR_CHANNEL || message.type !== 'collectionAuthorTurn' ||
      !globalThis.TCGCollectionAuthor?.validRequestId?.(message.requestId)) return;
  const source = event.source;
  const requestId = message.requestId;
  const respond = payload => {
    if (source !== dashboard.contentWindow || targetOrigin !== new URL(currentUrl).origin) return;
    source.postMessage(Object.assign({ channel: COLLECTION_AUTHOR_CHANNEL, type: 'collectionAuthorTurnResult', requestId }, payload), targetOrigin);
  };
  if (authorRunning) {
    respond({ error: { code: 'AUTHOR_BUSY', message: 'Finish the current collection-assistant request before sending another.' } });
    return;
  }
  authorRunning = true;
  try {
    const request = globalThis.TCGCollectionAuthor.validateAuthorRequest(message);
    const result = await globalThis.TCGCollectionAuthor.authorCollection(visionSettings.apiKey, request, {
      safetyIdentifier: visionSettings.safetyIdentifier
    });
    respond({ result });
  } catch (error) {
    respond({ error: {
      code: String(error?.code || 'AUTHOR_FAILED').slice(0, 80),
      message: diagnosticText(error?.message || error || 'Collection authoring failed.', 400)
    } });
  } finally {
    authorRunning = false;
  }
}

window.addEventListener('message', event => {
  handleCollectionAuthorMessage(event).catch(() => {});
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
  dashboardLoadedAt = null;
  installPricingBridge();
  installDashboardMonitorBridge();
  dashboard.src = dashboardRequestUrl(url, forceLatest);
  loadTimer = window.setTimeout(() => {
    status.textContent = 'Dashboard may be unavailable';
    loadError.hidden = false;
  }, 15000);
}

dashboard.addEventListener('load', () => {
  if (!dashboardFrameIsReady()) return;
  window.clearTimeout(loadTimer);
  loadError.hidden = true;
  status.textContent = currentUrl.startsWith('http://') ? 'Local preview' : 'Live dashboard';
  status.classList.add('ready');
  dashboardLoadedAt = Date.now();
  dashboardMonitorBridge.scheduleStateChanged();
});

document.getElementById('refresh').addEventListener('click', () => startLoad(currentUrl, true));
document.getElementById('retry').addEventListener('click', () => startLoad(currentUrl, true));
scanPageButton.addEventListener('click', decorateCollectionPage);
copyPageScanDiagnosticsButton.addEventListener('click', copyPageScanDiagnostics);
syncMonitorButton.addEventListener('click', () => syncCollectionMonitor({ userInitiated: true, reason: 'sync-button' }));
refreshMonitorStatusButton.addEventListener('click', () => refreshCollectionMonitorStatus());
runMonitorButton.addEventListener('click', runCollectionMonitorNow);
copyMonitorDiagnosticsButton.addEventListener('click', copyMonitorDiagnostics);
document.getElementById('closePageScanStatus').addEventListener('click', () => { pageScanStatus.hidden = true; });

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') dashboardMonitorBridge?.resume();
});

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
    visionKeyInput.value = '';
    visionKeyInput.placeholder = visionSettings.apiKey ? 'Remembered on this device; paste to replace' : 'Paste your API key';
    rememberVisionKey.checked = visionSettings.remembered || !visionSettings.apiKey;
    pricingExtensionId.value = pricingSettings.extensionId;
    pricingToken.value = '';
    pricingToken.placeholder = pricingSettings.apiToken ? 'Stored securely; paste to replace' : 'Paste capability token';
    dashboardUrl.focus();
  }
});

visionForm.addEventListener('submit', async event => {
  event.preventDefault();
  const apiKey = visionKeyInput.value.trim() || visionSettings.apiKey;
  if (!apiKey) {
    setVisionStatus('Paste an OpenAI API key first.', 'error');
    return;
  }
  if (apiKey.length < 20 || /\s/.test(apiKey)) {
    setVisionStatus('The API key format does not look valid.', 'error');
    return;
  }
  const remembered = rememberVisionKey.checked;
  await writeVisionSettings(apiKey, remembered);
  visionSettings = { apiKey, remembered, safetyIdentifier: visionSettings.safetyIdentifier || newSafetyIdentifier() };
  visionKeyInput.value = '';
  visionKeyInput.placeholder = remembered ? 'Remembered on this device; paste to replace' : 'Available until this panel closes';
  setVisionStatus(remembered
    ? 'API key remembered on this device. It will be tested on the next photo.'
    : 'API key is available for this panel session only.', 'ok');
});

document.getElementById('clearVisionKey').addEventListener('click', async () => {
  await clearVisionSettings();
  visionSettings = { apiKey: '', remembered: false, safetyIdentifier: visionSettings.safetyIdentifier };
  visionKeyInput.value = '';
  visionKeyInput.placeholder = 'Paste your API key';
  rememberVisionKey.checked = true;
  setVisionStatus('Remembered API key removed.');
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
  dashboardMonitorBridge?.scheduleStateChanged();
});

document.getElementById('clearPricing').addEventListener('click', async () => {
  await clearPricingSettings();
  pricingSettings = { extensionId: '', apiToken: '' };
  pricingExtensionId.value = '';
  pricingToken.value = '';
  pricingToken.placeholder = 'Paste capability token';
  installPricingBridge();
  setPricingStatus('Pricing pairing removed.');
  lastForwardedMonitorRevision = '';
  monitorRevisionGate.clear();
  monitorDetails.hidden = true;
  clearMonitorDiagnostics();
  setMonitorStatus('Pair TCG Comps before syncing the collection monitor.');
  publishMonitorSyncStatusQuietly('unavailable', { message: 'TCG Comps pairing was removed.', errorCode: 'UNAUTHORIZED' });
});

async function boot() {
  const [savedDashboard, savedPricing, savedVision] = await Promise.all([readDashboardUrl(), readPricingSettings(), readVisionSettings()]);
  pricingSettings = savedPricing;
  visionSettings = savedVision;
  try {
    currentUrl = normalizeDashboardUrl(savedDashboard.dashboardUrl);
  } catch (_error) {
    currentUrl = DEFAULT_DASHBOARD_URL;
    await saveDashboardUrl(currentUrl);
  }
  dashboardUrl.value = currentUrl;
  pricingExtensionId.value = pricingSettings.extensionId;
  visionKeyInput.placeholder = visionSettings.apiKey ? 'Remembered on this device; paste to replace' : 'Paste your API key';
  rememberVisionKey.checked = true;
  setVisionStatus(visionSettings.apiKey
    ? 'API key is remembered on this device and ready for photo identification.'
    : 'Photo identification is not configured.', visionSettings.apiKey ? 'ok' : '');
  pricingToken.placeholder = pricingSettings.apiToken ? 'Stored securely; paste to replace' : 'Paste capability token';
  consumerExtensionId.textContent = globalThis.chrome?.runtime?.id || 'Unavailable outside the extension';
  setPricingStatus(pricingSettings.extensionId && pricingSettings.apiToken
    ? 'Pairing stored. Testing TCG Comps…'
    : 'Pricing is not paired.');
  startLoad(currentUrl);
  if (pricingSettings.extensionId && pricingSettings.apiToken) {
    await testPricingConnection();
    await refreshCollectionMonitorStatus({ quiet: true });
  }
}

boot().catch((error) => {
  status.textContent = 'Extension failed to start';
  loadError.hidden = false;
  setPricingStatus('Extension startup failed.', 'error');
  console.error(error);
});
