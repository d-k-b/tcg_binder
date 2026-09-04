#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {
  SERVICE_VERSION, AuthorityError, safeErrorBody, GitHubGistStore, CollectionAuthority,
} = require('../../lib/collection-authority');

function bearer(req) {
  const match = /^Bearer ([^\s]+)$/.exec(String(req.headers.authorization || ''));
  return match ? match[1] : '';
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': encoded.length, 'Cache-Control': 'no-store' });
  res.end(encoded);
}

async function readJsonBody(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AuthorityError('REQUEST_TOO_LARGE', 'Collection authority request is too large', 413);
    chunks.push(chunk);
  }
  try {
    const text = Buffer.concat(chunks).toString('utf8');
    return text ? JSON.parse(text) : {};
  } catch { throw new AuthorityError('REQUEST_JSON_INVALID', 'Collection authority request JSON is invalid', 400); }
}

function createHandler(options) {
  const authority = options.authority;
  const accessToken = String(options.accessToken || '');
  const adminToken = String(options.adminToken || '');
  if (!accessToken) throw new Error('TCG_COLLECTION_AUTHORITY_TOKEN is required');
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        return send(res, 200, { schema: 'tcg.collection-authority-health/v1', ok: true, version: SERVICE_VERSION });
      }
      const adminRoute = req.method === 'POST' && url.pathname === '/v1/admin/gist-repair';
      const expected = adminRoute ? adminToken : accessToken;
      if (!constantTimeEqual(bearer(req), expected)) throw new AuthorityError('AUTH_REJECTED', 'Collection authority authentication was rejected', 401);
      if (req.method === 'GET' && url.pathname === '/v1/readiness') return send(res, 200, await authority.readiness());
      if (req.method === 'GET' && url.pathname === '/v1/collection/snapshot') return send(res, 200, await authority.snapshot());
      if (req.method === 'GET' && url.pathname === '/v1/pricing/readiness') return send(res, 200, await authority.pricingReadiness());
      if (req.method === 'POST' && url.pathname === '/v1/pricing/price') {
        return send(res, 200, await authority.priceProduct(await readJsonBody(req)));
      }
      if (req.method === 'POST' && url.pathname === '/v1/monitor/sync') {
        return send(res, 200, await authority.monitorSync(await readJsonBody(req)));
      }
      if (req.method === 'POST' && url.pathname === '/v1/collection/receipt-operations') {
        return send(res, 200, await authority.receiptOperation(await readJsonBody(req)));
      }
      if (adminRoute) {
        if (!adminToken) throw new AuthorityError('ADMIN_AUTH_NOT_CONFIGURED', 'Gist repair API is not configured', 404);
        const body = await readJsonBody(req, 1024 * 1024);
        return send(res, 200, await authority.repair({ apply: body.apply === true, sourcePayloads: body.sourcePayloads || {} }));
      }
      throw new AuthorityError('ROUTE_NOT_FOUND', 'Collection authority route was not found', 404);
    } catch (error) {
      const safe = error instanceof AuthorityError ? error : new AuthorityError('COLLECTION_AUTHORITY_INTERNAL', 'Collection authority failed safely', 500);
      return send(res, safe.httpStatus || 500, safeErrorBody(safe));
    }
  };
}

function createAuthorityFromEnvironment(env = process.env) {
  const root = path.resolve(__dirname, '..', '..');
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'binder_data.json'), 'utf8'));
  const dataDir = env.TCG_COLLECTION_AUTHORITY_DATA_DIR || path.join(os.homedir(), '.config', 'tcg-price-monitor', 'collection-authority');
  const store = new GitHubGistStore({ token: env.TCG_TRACKER_GIST_TOKEN, catalog, dataDir });
  let pricingClient = null;
  let monitorClient = null;
  let pricingContracts = null;
  const providerRoot = env.TCG_PROVIDER_REPO || '/Users/dkb/Apps/Extensions/TcgPriceComparisons';
  try {
    const clients = require(path.join(providerRoot, 'clients', 'node', 'index.js'));
    pricingContracts = require(path.join(providerRoot, 'shared', 'pricing-contracts.js'));
    let pricingToken = String(env.TCG_PRICING_REST_TOKEN || '').trim();
    const pricingConfigPath = env.TCG_PRICING_REST_CONFIG || '/Users/dkb/.config/tcg-pricing-rest/pricing-rest.json';
    if (!pricingToken) pricingToken = String((JSON.parse(fs.readFileSync(pricingConfigPath, 'utf8')) || {}).token || '').trim();
    if (pricingToken) pricingClient = new clients.PricingRestClient({ baseUrl: env.TCG_PRICING_REST_URL || 'http://127.0.0.1:3101', token: pricingToken,
      timeoutMs: 20_000, retryDelaysMs: [0] });
    if (env.TCG_MONITOR_TOKEN) monitorClient = new clients.PriceMonitorClient({ baseUrl: env.TCG_MONITOR_URL || 'http://127.0.0.1:3099', token: env.TCG_MONITOR_TOKEN,
      timeoutMs: 20_000, retryDelaysMs: [0] });
  } catch (_error) {
    pricingClient = null;
    monitorClient = null;
    pricingContracts = null;
  }
  return new CollectionAuthority({ store, catalog, dataDir, pricingClient, monitorClient, pricingContracts,
    maxAgeMs: Number(env.TCG_COLLECTION_AUTHORITY_MAX_AGE_MS) || undefined });
}

function assertLoopbackHost(host) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('Collection authority must remain loopback-only');
}

if (require.main === module) {
  const host = process.env.TCG_COLLECTION_AUTHORITY_HOST || '127.0.0.1';
  const port = Number(process.env.TCG_COLLECTION_AUTHORITY_PORT || 3102);
  assertLoopbackHost(host);
  const authority = createAuthorityFromEnvironment();
  const handler = createHandler({ authority, accessToken: process.env.TCG_COLLECTION_AUTHORITY_TOKEN, adminToken: process.env.TCG_COLLECTION_AUTHORITY_ADMIN_TOKEN });
  http.createServer(handler).listen(port, host, () => console.log('Collection authority listening on loopback port ' + port));
}

module.exports = { createHandler, createAuthorityFromEnvironment, constantTimeEqual, assertLoopbackHost, readJsonBody };
