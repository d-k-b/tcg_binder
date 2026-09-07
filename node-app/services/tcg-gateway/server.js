#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const VERSION = '1.0.2';
const DEFAULT_ROUTES = Object.freeze({ pricing: { host: '127.0.0.1', port: 3101 }, collection: { host: '127.0.0.1', port: 3102 }, monitor: { host: '127.0.0.1', port: 3099 } });
const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const FORWARDED_REQUEST_HEADERS = Object.freeze([
  'authorization',
  'content-type',
  'origin',
  'access-control-request-method',
  'access-control-request-headers',
]);
const FORWARDED_RESPONSE_HEADERS = Object.freeze([
  'content-type',
  'cache-control',
  'retry-after',
  'vary',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
]);

function send(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': encoded.length, 'Cache-Control': 'no-store' });
  res.end(encoded);
}

function collectionAuthoritySupervisorStatus(filename) {
  const fallback = { state: 'unknown', attempts: 0, retryAt: null, lastErrorCode: null, message: 'Collection Authority supervisor status is unavailable.', updatedAt: null };
  if (!filename) return fallback;
  try {
    const parsed = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const value = parsed && parsed.schema === 'tcg.local-supervisor-status/v1' && parsed.collectionAuthority;
    if (!value || !['starting', 'ready', 'degraded', 'external', 'stopped'].includes(value.state)) return fallback;
    return {
      state: value.state,
      attempts: Number.isInteger(value.attempts) && value.attempts >= 0 ? value.attempts : 0,
      retryAt: typeof value.retryAt === 'string' ? value.retryAt : null,
      lastErrorCode: typeof value.lastErrorCode === 'string' && /^[A-Z0-9_]{1,64}$/.test(value.lastErrorCode) ? value.lastErrorCode : null,
      message: typeof value.message === 'string' ? value.message.slice(0, 240) : null,
      updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    };
  } catch (_error) { return fallback; }
}

function targetFor(pathname, routes = DEFAULT_ROUTES) {
  for (const prefix of ['/collection', '/pricing', '/monitor']) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      const name = prefix.slice(1);
      return { ...routes[name], name, path: pathname.slice(prefix.length) || '/' };
    }
  }
  if (pathname === '/healthz' || pathname.startsWith('/v1/')) return { ...routes.pricing, name: 'pricing', path: pathname };
  return null;
}

function proxyRequest(req, res, target) {
  const chunks = [];
  let size = 0;
  let failed = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { failed = true; req.destroy(new Error('request too large')); } else chunks.push(chunk);
  });
  req.on('error', () => {
    if (!res.headersSent) send(res, failed ? 413 : 400, { schema: 'tcg.gateway-error/v1', error: { code: failed ? 'REQUEST_TOO_LARGE' : 'REQUEST_STREAM_FAILED', message: 'Gateway request was rejected' } });
  });
  req.on('end', () => {
    if (failed) return;
    const body = Buffer.concat(chunks);
    const headers = { Accept: 'application/json' };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      if (req.headers[name] != null) headers[name] = req.headers[name];
    }
    if (body.length) headers['Content-Length'] = body.length;
    const search = new URL(req.url, 'http://gateway').search || '';
    const upstream = http.request({ host: target.host, port: target.port, method: req.method, path: target.path + search, headers, timeout: REQUEST_TIMEOUT_MS }, (upstreamResponse) => {
      const responseHeaders = {};
      for (const name of FORWARDED_RESPONSE_HEADERS) {
        if (upstreamResponse.headers[name] != null) responseHeaders[name] = upstreamResponse.headers[name];
      }
      if (!responseHeaders['content-type']) responseHeaders['content-type'] = 'application/json; charset=utf-8';
      if (!responseHeaders['cache-control']) responseHeaders['cache-control'] = 'no-store';
      res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(res);
    });
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) send(res, 503, { schema: 'tcg.gateway-error/v1', error: { code: 'UPSTREAM_UNAVAILABLE', message: target.name + ' API is unavailable', retryable: true } });
      else res.destroy();
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

function createHandler(options = {}) {
  const routes = options.routes || DEFAULT_ROUTES;
  const supervisorStatusFile = options.supervisorStatusFile || '';
  return (req, res) => {
    const url = new URL(req.url, 'http://gateway');
    if (req.method === 'GET' && url.pathname === '/gateway/healthz') {
      const collectionAuthority = collectionAuthoritySupervisorStatus(supervisorStatusFile);
      return send(res, 200, { schema: 'tcg.gateway-health/v1', ok: true, degraded: ['degraded', 'stopped'].includes(collectionAuthority.state), version: VERSION, routes: ['collection', 'monitor', 'pricing'], collectionAuthority });
    }
    const target = targetFor(url.pathname, routes);
    if (!target) return send(res, 404, { schema: 'tcg.gateway-error/v1', error: { code: 'ROUTE_NOT_FOUND', message: 'Gateway route was not found' } });
    return proxyRequest(req, res, target);
  };
}

function assertLoopbackHost(host) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('TCG gateway must remain loopback-only; Tailscale owns external exposure');
}

if (require.main === module) {
  const host = process.env.TCG_GATEWAY_HOST || '127.0.0.1';
  const port = Number(process.env.TCG_GATEWAY_PORT || 3180);
  assertLoopbackHost(host);
  http.createServer(createHandler({ supervisorStatusFile: process.env.TCG_SUPERVISOR_STATUS_FILE || '' })).listen(port, host, () => console.log('TCG gateway listening on loopback port ' + port));
}

module.exports = { VERSION, DEFAULT_ROUTES, MAX_BODY_BYTES, FORWARDED_REQUEST_HEADERS, FORWARDED_RESPONSE_HEADERS, targetFor, createHandler, assertLoopbackHost, collectionAuthoritySupervisorStatus };
