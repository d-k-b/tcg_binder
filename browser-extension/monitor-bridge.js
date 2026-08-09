(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TCGCollectionMonitorBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNEL = 'tcg-collection-monitor/v1';
  const SUBSCRIPTION_SCHEMA = 'tcg.collection-monitor-subscription/v1';
  const COLLECTION_SCHEMA = 'tcg.collection-snapshot/v2';
  const SYNC_STATUS_SCHEMA = 'tcg.collection-monitor-sync-status/v1';
  const SYNC_STATUS_ACK_SCHEMA = 'tcg.collection-monitor-sync-status-ack/v1';
  const SOURCES = new Set(['ebay', 'tcgplayer', 'heritage', 'store']);
  const CONFIDENCE = new Set(['low', 'medium', 'high']);

  function validationError(path, message) {
    return path + ': ' + message;
  }

  function isIsoTimestamp(value) {
    return typeof value === 'string' && value.length <= 80 && Number.isFinite(Date.parse(value));
  }

  function rejectUnexpectedKeys(value, allowed, path, errors) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.keys(value).forEach((key) => {
      if (!allowed.has(key)) errors.push(validationError(path + '.' + key, 'unexpected field'));
    });
  }

  function validateSubscription(input, validateCollectionSnapshot) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: ['subscription: expected object'] };
    }
    rejectUnexpectedKeys(input, new Set(['schema', 'namespace', 'revision', 'generatedAt', 'preferences', 'collection']), 'subscription', errors);
    if (input.schema !== SUBSCRIPTION_SCHEMA) errors.push(validationError('schema', 'expected ' + SUBSCRIPTION_SCHEMA));
    if (input.namespace !== 'collection-tracker') errors.push(validationError('namespace', 'expected collection-tracker'));
    if (typeof input.revision !== 'string' || !input.revision.trim() || input.revision.length > 160) {
      errors.push(validationError('revision', 'expected nonempty string up to 160 characters'));
    }
    if (!isIsoTimestamp(input.generatedAt)) errors.push(validationError('generatedAt', 'expected ISO timestamp'));

    const preferences = input.preferences;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
      errors.push(validationError('preferences', 'expected object'));
    } else {
      rejectUnexpectedKeys(preferences, new Set(['enabled', 'maxMarketRatio', 'minimumConfidence', 'sources', 'includeOptional', 'instantFixedPriceEmail', 'dailyDigest']), 'preferences', errors);
      if (typeof preferences.enabled !== 'boolean') errors.push(validationError('preferences.enabled', 'expected boolean'));
      if (typeof preferences.maxMarketRatio !== 'number' || !Number.isFinite(preferences.maxMarketRatio) || preferences.maxMarketRatio <= 0 || preferences.maxMarketRatio > 1) {
        errors.push(validationError('preferences.maxMarketRatio', 'expected number greater than 0 and at most 1'));
      }
      if (!CONFIDENCE.has(preferences.minimumConfidence)) errors.push(validationError('preferences.minimumConfidence', 'expected low, medium, or high'));
      if (!Array.isArray(preferences.sources) || !preferences.sources.length || preferences.sources.some((source) => !SOURCES.has(source)) || new Set(preferences.sources).size !== preferences.sources.length) {
        errors.push(validationError('preferences.sources', 'expected unique supported sources'));
      }
      if (typeof preferences.includeOptional !== 'boolean') errors.push(validationError('preferences.includeOptional', 'expected boolean'));
      if (typeof preferences.instantFixedPriceEmail !== 'boolean') errors.push(validationError('preferences.instantFixedPriceEmail', 'expected boolean'));
      const digest = preferences.dailyDigest;
      if (!digest || typeof digest !== 'object' || Array.isArray(digest)) {
        errors.push(validationError('preferences.dailyDigest', 'expected object'));
      } else {
        rejectUnexpectedKeys(digest, new Set(['enabled', 'time', 'timezone']), 'preferences.dailyDigest', errors);
        if (typeof digest.enabled !== 'boolean') errors.push(validationError('preferences.dailyDigest.enabled', 'expected boolean'));
        if (typeof digest.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(digest.time)) errors.push(validationError('preferences.dailyDigest.time', 'expected HH:MM'));
        if (typeof digest.timezone !== 'string' || !digest.timezone.trim() || digest.timezone.length > 80) errors.push(validationError('preferences.dailyDigest.timezone', 'expected timezone'));
      }
    }

    if (!input.collection || input.collection.schema !== COLLECTION_SCHEMA) {
      errors.push(validationError('collection.schema', 'expected ' + COLLECTION_SCHEMA));
    } else if (typeof validateCollectionSnapshot !== 'function') {
      errors.push(validationError('collection', 'collection validator unavailable'));
    } else {
      rejectUnexpectedKeys(input.collection, new Set(['schema', 'namespace', 'products']), 'collection', errors);
      const checked = validateCollectionSnapshot(input.collection);
      if (!checked || !checked.ok) {
        const detail = checked && Array.isArray(checked.errors) && checked.errors.length ? checked.errors[0] : 'validation failed';
        errors.push(validationError('collection', String(detail)));
      }
    }

    if (errors.length) return { ok: false, errors };
    return { ok: true, value: input };
  }

  function bridgeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function createRevisionGate(initialRevision) {
    let acceptedRevision = typeof initialRevision === 'string' ? initialRevision : '';
    return {
      shouldForward(revision, userInitiated) {
        return Boolean(userInitiated) || !acceptedRevision || revision !== acceptedRevision;
      },
      accept(revision) {
        acceptedRevision = String(revision || '');
      },
      clear() {
        acceptedRevision = '';
      },
      current() {
        return acceptedRevision;
      }
    };
  }

  function createBridge(options) {
    const windowObject = options.windowObject;
    const frame = options.frame;
    const getTargetOrigin = options.getTargetOrigin;
    const isReady = typeof options.isReady === 'function' ? options.isReady : function () { return true; };
    const onStateChanged = typeof options.onStateChanged === 'function' ? options.onStateChanged : function () {};
    const isActive = typeof options.isActive === 'function' ? options.isActive : function () { return true; };
    const setTimer = options.setTimeoutFn || setTimeout;
    const clearTimer = options.clearTimeoutFn || clearTimeout;
    const requestTimeoutMs = Number(options.requestTimeoutMs || 10000);
    const debounceMs = Number(options.debounceMs || 800);
    let serial = 0;
    let pending = null;
    let pendingStatus = null;
    let debounceTimer = null;
    let queuedWhileInactive = false;

    function targetOrigin() {
      return String(getTargetOrigin());
    }

    function cancelPending(message) {
      if (!pending) return;
      clearTimer(pending.timer);
      pending.reject(bridgeError('MONITOR_SUBSCRIPTION_CANCELLED', message || 'Monitor subscription request cancelled.'));
      pending = null;
    }

    function requestSubscription() {
      if (!frame || !frame.contentWindow || !isReady()) return Promise.reject(bridgeError('DASHBOARD_NOT_READY', 'The dashboard is not ready yet.'));
      cancelPending('A newer monitor sync replaced the previous dashboard request.');
      const requestId = 'monitor-' + Date.now().toString(36) + '-' + (++serial).toString(36);
      const origin = targetOrigin();
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          if (pending && pending.requestId === requestId) pending = null;
          reject(bridgeError('MONITOR_SUBSCRIPTION_TIMEOUT', 'The dashboard did not return its monitor subscription.'));
        }, requestTimeoutMs);
        pending = { requestId, origin, resolve, reject, timer };
        frame.contentWindow.postMessage({ channel: CHANNEL, type: 'monitorSubscription', requestId }, origin);
      });
    }

    function postSyncStatus(status) {
      if (!frame || !frame.contentWindow || !isReady()) return Promise.reject(bridgeError('DASHBOARD_NOT_READY', 'The dashboard is not ready yet.'));
      if (!status || status.schema !== SYNC_STATUS_SCHEMA) return Promise.reject(bridgeError('INVALID_MONITOR_SYNC_STATUS', 'Invalid monitor sync status schema.'));
      if (pendingStatus) {
        clearTimer(pendingStatus.timer);
        pendingStatus.reject(bridgeError('MONITOR_SYNC_STATUS_CANCELLED', 'A newer monitor status replaced the previous update.'));
        pendingStatus = null;
      }
      const requestId = 'monitor-status-' + Date.now().toString(36) + '-' + (++serial).toString(36);
      const origin = targetOrigin();
      return new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          if (pendingStatus && pendingStatus.requestId === requestId) pendingStatus = null;
          reject(bridgeError('MONITOR_SYNC_STATUS_TIMEOUT', 'The dashboard did not acknowledge monitor status.'));
        }, requestTimeoutMs);
        pendingStatus = { requestId, origin, resolve, reject, timer };
        frame.contentWindow.postMessage({ channel: CHANNEL, type: 'monitorSyncStatus', requestId, status }, origin);
      });
    }

    function scheduleStateChanged() {
      if (!isActive()) {
        queuedWhileInactive = true;
        return;
      }
      queuedWhileInactive = false;
      clearTimer(debounceTimer);
      debounceTimer = setTimer(() => {
        debounceTimer = null;
        onStateChanged();
      }, debounceMs);
    }

    function resume() {
      if (queuedWhileInactive && isActive()) scheduleStateChanged();
    }

    function onMessage(event) {
      const origin = targetOrigin();
      if (!event || event.origin !== origin || event.source !== frame.contentWindow) return;
      const message = event.data;
      if (!message || message.channel !== CHANNEL) return;
      if (message.type === 'monitorStateChanged') {
        scheduleStateChanged();
        return;
      }
      if (pendingStatus && message.type === 'monitorSyncStatusResult' && message.requestId === pendingStatus.requestId && event.origin === pendingStatus.origin) {
        const currentStatus = pendingStatus;
        pendingStatus = null;
        clearTimer(currentStatus.timer);
        if (!message.result || message.result.schema !== SYNC_STATUS_ACK_SCHEMA || message.result.accepted !== true) {
          currentStatus.reject(bridgeError('INVALID_MONITOR_SYNC_STATUS_ACK', 'The dashboard returned an invalid monitor status acknowledgement.'));
        } else {
          currentStatus.resolve(message.result);
        }
        return;
      }
      if (!pending || message.type !== 'monitorSubscriptionResult' || message.requestId !== pending.requestId || event.origin !== pending.origin) return;
      const current = pending;
      pending = null;
      clearTimer(current.timer);
      if (message.error) {
        current.reject(bridgeError(String(message.error.code || 'MONITOR_SUBSCRIPTION_FAILED'), String(message.error.message || message.error.code || 'Monitor subscription failed.')));
      } else {
        current.resolve(message.result);
      }
    }

    function dispose() {
      clearTimer(debounceTimer);
      debounceTimer = null;
      cancelPending('Monitor bridge disposed.');
      if (pendingStatus) {
        clearTimer(pendingStatus.timer);
        pendingStatus.reject(bridgeError('MONITOR_SYNC_STATUS_CANCELLED', 'Monitor bridge disposed.'));
        pendingStatus = null;
      }
      windowObject.removeEventListener('message', onMessage);
    }

    windowObject.addEventListener('message', onMessage);
    return { requestSubscription, postSyncStatus, scheduleStateChanged, resume, cancelPending, dispose };
  }

  return {
    CHANNEL,
    SUBSCRIPTION_SCHEMA,
    COLLECTION_SCHEMA,
    SYNC_STATUS_SCHEMA,
    SYNC_STATUS_ACK_SCHEMA,
    validateSubscription,
    createRevisionGate,
    createBridge
  };
});
