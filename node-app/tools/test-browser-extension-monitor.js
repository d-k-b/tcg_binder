'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'browser-extension');
const monitor = require(path.join(EXT, 'monitor-bridge.js'));
const contracts = require(path.join(EXT, 'vendor', 'tcg-comps-2.42.0', 'pricing-contracts.js'));
const binder = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'binder_data.json'), 'utf8'));

function buildProducts() {
  const products = {};
  for (const checklist of binder.checklists || []) {
    for (const era of checklist.eras || []) {
      for (const item of era.items || []) {
        for (const record of item.pricingProducts || []) {
          products[record.ref.productId] = {
            product: record.ref,
            target: 1,
            owned: 0,
            missing: 1,
            requirement: 'required',
            status: 'missing'
          };
        }
      }
    }
  }
  return products;
}

function buildSubscription(revision = 'revision-a') {
  return {
    schema: 'tcg.collection-monitor-subscription/v1',
    namespace: 'collection-tracker',
    revision,
    generatedAt: '2026-08-09T12:00:00.000Z',
    preferences: {
      enabled: true,
      maxMarketRatio: 0.8,
      minimumConfidence: 'medium',
      sources: ['ebay', 'tcgplayer', 'heritage', 'store'],
      includeOptional: false,
      instantFixedPriceEmail: true,
      dailyDigest: { enabled: true, time: '07:00', timezone: 'America/Chicago' }
    },
    collection: {
      schema: 'tcg.collection-snapshot/v2',
      namespace: 'collection-tracker',
      products: buildProducts()
    }
  };
}

class FakeWindow {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
  dispatch(event) { const handler = this.listeners.get('message'); if (handler) handler(event); }
}

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const subscription = buildSubscription();
  assert.strictEqual(Object.keys(subscription.collection.products).length, 688, 'monitor sync must forward all 688 ProductRefs atomically');
  assert.ok(monitor.validateSubscription(subscription, contracts.validateCollectionSnapshot).ok, 'canonical monitor subscription must validate');

  const sidepanelSource = fs.readFileSync(path.join(EXT, 'sidepanel.js'), 'utf8');
  assert.match(sidepanelSource, /lastMonitorDetails\.activeTargetCount/, 'manual-run rendering must retain the last verified active-target count');
  assert.match(sidepanelSource, /lastMonitorDetails\.syncedAt/, 'manual-run rendering must retain the last verified sync timestamp');

  const leakedTopLevel = JSON.parse(JSON.stringify(subscription));
  leakedTopLevel.apiToken = 'must-not-pass';
  assert.ok(!monitor.validateSubscription(leakedTopLevel, contracts.validateCollectionSnapshot).ok, 'unexpected credential-like fields must fail closed');
  const leakedCollection = JSON.parse(JSON.stringify(subscription));
  leakedCollection.collection.gist = { token: 'must-not-pass' };
  assert.ok(!monitor.validateSubscription(leakedCollection, contracts.validateCollectionSnapshot).ok, 'collection metadata outside the snapshot contract must fail closed');
  const badRatio = JSON.parse(JSON.stringify(subscription));
  badRatio.preferences.maxMarketRatio = 1.01;
  assert.ok(!monitor.validateSubscription(badRatio, contracts.validateCollectionSnapshot).ok, 'invalid market threshold must fail validation');
  const badSchema = JSON.parse(JSON.stringify(subscription));
  badSchema.schema = 'tcg.collection-monitor-subscription/v0';
  assert.ok(!monitor.validateSubscription(badSchema, contracts.validateCollectionSnapshot).ok, 'wrong subscription schema must fail validation');

  const gate = monitor.createRevisionGate();
  assert.strictEqual(gate.shouldForward('revision-a', false), true, 'first automatic revision must forward');
  gate.accept('revision-a');
  assert.strictEqual(gate.shouldForward('revision-a', false), false, 'duplicate automatic revision must be idempotent');
  assert.strictEqual(gate.shouldForward('revision-a', true), true, 'explicit user sync may resend an idempotent revision');
  assert.strictEqual(gate.shouldForward('revision-b', false), true, 'changed revision must forward');

  const windowObject = new FakeWindow();
  const posted = [];
  const contentWindow = { postMessage(message, origin) { posted.push({ message, origin }); } };
  const frame = { contentWindow };
  let active = true;
  let ready = false;
  let hints = 0;
  const bridge = monitor.createBridge({
    windowObject,
    frame,
    getTargetOrigin: () => 'https://d-k-b.github.io',
    isReady: () => ready,
    isActive: () => active,
    requestTimeoutMs: 80,
    debounceMs: 12,
    onStateChanged: () => { hints += 1; }
  });

  await assert.rejects(bridge.requestSubscription(), (error) => error.code === 'DASHBOARD_NOT_READY',
    'the initial about:blank frame must not receive a dashboard-origin postMessage');
  assert.strictEqual(posted.length, 0, 'frame-readiness rejection must happen before postMessage');
  ready = true;
  let resolved = false;
  const request = bridge.requestSubscription().then((value) => { resolved = true; return value; });
  const requestEnvelope = posted.at(-1).message;
  assert.deepStrictEqual(requestEnvelope, {
    channel: 'tcg-collection-monitor/v1', type: 'monitorSubscription', requestId: requestEnvelope.requestId
  }, 'dashboard request envelope must stay exact and credential-free');
  assert.strictEqual(posted.at(-1).origin, 'https://d-k-b.github.io', 'dashboard request must target the exact origin');

  windowObject.dispatch({ origin: 'https://evil.example', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'monitorSubscriptionResult', requestId: requestEnvelope.requestId, result: subscription
  } });
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: {}, data: {
    channel: monitor.CHANNEL, type: 'monitorSubscriptionResult', requestId: requestEnvelope.requestId, result: subscription
  } });
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'monitorSubscriptionResult', requestId: 'wrong-request-id', result: subscription
  } });
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'unexpectedResult', requestId: requestEnvelope.requestId, result: subscription
  } });
  await Promise.resolve();
  assert.strictEqual(resolved, false, 'wrong origin, frame, request ID, and response type must be ignored');
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'monitorSubscriptionResult', requestId: requestEnvelope.requestId, result: subscription
  } });
  assert.strictEqual(await request, subscription, 'exact response must resolve the pending request');

  const statusPromise = bridge.postSyncStatus({
    schema: 'tcg.collection-monitor-sync-status/v1', state: 'synced', revision: 'revision-a', productCount: 688,
    activeTargetCount: 123, monitorConfigured: true, syncedAt: '2026-08-09T12:00:01.000Z', message: null, errorCode: null
  });
  const statusEnvelope = posted.at(-1).message;
  assert.strictEqual(statusEnvelope.type, 'monitorSyncStatus');
  assert.ok(!JSON.stringify(statusEnvelope).includes('apiToken'), 'dashboard status must contain no capability token');
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'monitorSyncStatusResult', requestId: statusEnvelope.requestId,
    result: { schema: 'tcg.collection-monitor-sync-status-ack/v1', accepted: true }
  } });
  assert.deepStrictEqual(await statusPromise, { schema: 'tcg.collection-monitor-sync-status-ack/v1', accepted: true });

  const badStatusPromise = bridge.postSyncStatus({
    schema: 'tcg.collection-monitor-sync-status/v1', state: 'error', revision: null, productCount: null,
    activeTargetCount: null, monitorConfigured: null, syncedAt: null, message: 'Unavailable', errorCode: 'OFFLINE'
  });
  const badStatusEnvelope = posted.at(-1).message;
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: {
    channel: monitor.CHANNEL, type: 'monitorSyncStatusResult', requestId: badStatusEnvelope.requestId,
    result: { schema: 'tcg.collection-monitor-sync-status-ack/v0', accepted: true }
  } });
  await assert.rejects(badStatusPromise, (error) => error.code === 'INVALID_MONITOR_SYNC_STATUS_ACK',
    'malformed dashboard status acknowledgement must fail closed');

  for (let index = 0; index < 3; index += 1) {
    windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: { channel: monitor.CHANNEL, type: 'monitorStateChanged' } });
  }
  await wait(30);
  assert.strictEqual(hints, 1, 'rapid monitor state hints must debounce into one resync');
  active = false;
  windowObject.dispatch({ origin: 'https://d-k-b.github.io', source: contentWindow, data: { channel: monitor.CHANNEL, type: 'monitorStateChanged' } });
  await wait(20);
  assert.strictEqual(hints, 1, 'inactive side panel must queue rather than resync');
  active = true;
  bridge.resume();
  await wait(30);
  assert.strictEqual(hints, 2, 'queued hint must resync after the side panel resumes');

  bridge.dispose();
  assert.strictEqual(windowObject.listeners.has('message'), false, 'disposing the bridge must remove its message listener');
  console.log('browser extension monitor tests: 688-product validation, exact bridge, status ack, revision gate, and debounce passing');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
