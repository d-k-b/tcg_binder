#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { targetFor, createHandler, assertLoopbackHost, collectionAuthoritySupervisorStatus } = require('../services/tcg-gateway/server');

assert.deepStrictEqual(targetFor('/v1/price'), { host: '127.0.0.1', port: 3101, name: 'pricing', path: '/v1/price' });
assert.deepStrictEqual(targetFor('/pricing/v1/readiness'), { host: '127.0.0.1', port: 3101, name: 'pricing', path: '/v1/readiness' });
assert.deepStrictEqual(targetFor('/collection/v1/readiness'), { host: '127.0.0.1', port: 3102, name: 'collection', path: '/v1/readiness' });
assert.deepStrictEqual(targetFor('/monitor/v1/status'), { host: '127.0.0.1', port: 3099, name: 'monitor', path: '/v1/status' });
assert.strictEqual(targetFor('/private/provider-authority'), null);
assert.throws(() => assertLoopbackHost('0.0.0.0'));

const statusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-gateway-status-'));
const statusFile = path.join(statusDir, 'supervisor-status.json');
fs.writeFileSync(statusFile, JSON.stringify({
  schema: 'tcg.local-supervisor-status/v1',
  collectionAuthority: {
    state: 'degraded', attempts: 4, retryAt: '2026-09-07T00:00:30.000Z',
    lastErrorCode: 'RUNTIME_READ_EAGAIN', message: 'Collection Authority is retrying.', updatedAt: '2026-09-07T00:00:00.000Z',
    token: 'must-not-cross-health-boundary', arbitrary: { secret: true },
  },
}));
assert.deepStrictEqual(collectionAuthoritySupervisorStatus(statusFile), {
  state: 'degraded', attempts: 4, retryAt: '2026-09-07T00:00:30.000Z',
  lastErrorCode: 'RUNTIME_READ_EAGAIN', message: 'Collection Authority is retrying.', updatedAt: '2026-09-07T00:00:00.000Z',
});
assert.strictEqual(collectionAuthoritySupervisorStatus(path.join(statusDir, 'missing.json')).state, 'unknown');

const upstream = http.createServer((req, res) => {
  assert.strictEqual(req.url, '/v1/test?value=1');
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') {
    assert.strictEqual(req.headers['access-control-request-method'], 'POST');
    assert.strictEqual(req.headers['access-control-request-headers'], 'authorization,content-type');
    if (origin !== 'https://d-k-b.github.io') return res.writeHead(403, { Vary: 'Origin' }).end();
    return res.writeHead(204, {
      Vary: 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept',
      'Access-Control-Max-Age': '600',
    }).end();
  }
  assert.strictEqual(req.headers.authorization, 'Bearer hidden-test-token');
  res.writeHead(200, {
    'Content-Type': 'application/json',
    ...(origin === 'https://d-k-b.github.io' ? { Vary: 'Origin', 'Access-Control-Allow-Origin': origin } : {}),
  });
  res.end(JSON.stringify({ ok: true }));
});
upstream.listen(0, '127.0.0.1', () => {
  const gateway = http.createServer(createHandler({ supervisorStatusFile: statusFile, routes: {
    pricing: { host: '127.0.0.1', port: upstream.address().port }, collection: { host: '127.0.0.1', port: upstream.address().port }, monitor: { host: '127.0.0.1', port: upstream.address().port },
  } }));
  gateway.listen(0, '127.0.0.1', async () => {
    try {
      const response = await fetch('http://127.0.0.1:' + gateway.address().port + '/collection/v1/test?value=1', { headers: { Authorization: 'Bearer hidden-test-token' } });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(await response.json(), { ok: true });
      const actualCors = await fetch('http://127.0.0.1:' + gateway.address().port + '/v1/test?value=1', { headers: { Origin: 'https://d-k-b.github.io', Authorization: 'Bearer hidden-test-token' } });
      assert.strictEqual(actualCors.headers.get('access-control-allow-origin'), 'https://d-k-b.github.io', 'gateway must preserve the upstream exact-origin grant on actual responses');
      assert.strictEqual(actualCors.headers.get('vary'), 'Origin');
      const allowedPreflight = await fetch('http://127.0.0.1:' + gateway.address().port + '/v1/test?value=1', {
        method: 'OPTIONS',
        headers: { Origin: 'https://d-k-b.github.io', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      assert.strictEqual(allowedPreflight.status, 204);
      assert.strictEqual(allowedPreflight.headers.get('access-control-allow-origin'), 'https://d-k-b.github.io');
      assert.match(allowedPreflight.headers.get('access-control-allow-methods') || '', /POST/);
      assert.match(allowedPreflight.headers.get('access-control-allow-headers') || '', /Authorization/);
      assert.strictEqual(allowedPreflight.headers.get('access-control-max-age'), '600');
      const deniedPreflight = await fetch('http://127.0.0.1:' + gateway.address().port + '/v1/test?value=1', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      assert.strictEqual(deniedPreflight.status, 403, 'foreign-origin rejection must survive the gateway');
      assert.strictEqual(deniedPreflight.headers.get('access-control-allow-origin'), null, 'gateway must never synthesize a CORS grant');
      const health = await fetch('http://127.0.0.1:' + gateway.address().port + '/gateway/healthz').then((result) => result.json());
      assert.strictEqual(health.version, '1.0.2');
      assert.deepStrictEqual(health.routes, ['collection', 'monitor', 'pricing']);
      assert.strictEqual(health.ok, true, 'healthy gateway and provider routes remain available while Collection Authority retries');
      assert.strictEqual(health.degraded, true);
      assert.deepStrictEqual(health.collectionAuthority, collectionAuthoritySupervisorStatus(statusFile));
      assert.ok(!JSON.stringify(health).includes('must-not-cross-health-boundary'), 'gateway health must allowlist supervisor status');
      console.log('TCG gateway tests passed');
    } finally { gateway.close(); upstream.close(); fs.rmSync(statusDir, { recursive: true, force: true }); }
  });
});
