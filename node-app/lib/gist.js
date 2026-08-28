/**
 * GitHub Gist storage backend — one named secret gist PER CHECKLIST.
 *
 * Setup: github.com → Settings → Developer settings → Personal access tokens →
 * Tokens (classic) → Generate new token → tick ONLY the "gist" scope.
 * Put it in GITHUB_TOKEN. That's the whole setup.
 *
 * You end up with a tidy, separately-versioned gist for each collection, e.g.
 *    MTG Binder · Collector Booster Displays   →  mtg-binder-collector.json
 *    MTG Binder · Booster Boxes (every set)    →  mtg-binder-boxes.json
 *    MTG Binder · Lorcana — 1 box / kid        →  mtg-binder-lorcana.json
 *
 * Gists are full read/write git repos, so every save is a restorable revision.
 * Ids are cached locally but also re-discovered by filename, so a wiped disk
 * (e.g. a redeploy on a free host) self-heals.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API = 'https://api.github.com';
const PREFIX = 'MTG Binder';
const DATA_DIR = path.join(__dirname, '..', '.data');
const IDPATH = path.join(DATA_DIR, 'gists.json');
const BINDER = path.join(__dirname, '..', 'data', 'binder_data.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const fileFor = (id) => `mtg-binder-${id}.json`;
const descFor = (id, title) => `${PREFIX} · ${title}`;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');

let idCache = null;      // { checklistId: gistId }
let lastHash = {};       // { checklistId: sha } — skip no-op writes

function configured() { return Boolean(process.env.GITHUB_TOKEN); }

function headers() {
  return {
    Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'mtg-binder',
  };
}

/** Checklist ids + titles, straight from the app's data file. */
function checklists() {
  try {
    return JSON.parse(fs.readFileSync(BINDER, 'utf8')).checklists.map((c) => ({ id: c.id, title: c.title }));
  } catch { return []; }
}
const titleFor = (id) => (checklists().find((c) => c.id === id) || {}).title || id;

function readCache() {
  if (idCache) return idCache;
  try { idCache = JSON.parse(fs.readFileSync(IDPATH, 'utf8')); } catch { idCache = {}; }
  return idCache;
}
function saveCache() { try { fs.writeFileSync(IDPATH, JSON.stringify(idCache || {}, null, 2)); } catch {} }

async function whoami() {
  try {
    const r = await fetch(API + '/user', { headers: headers() });
    return r.ok ? (await r.json()).login || null : null;
  } catch { return null; }
}

/** Rebuild the id map from GitHub by matching our filename pattern. */
async function discover() {
  const r = await fetch(API + '/gists?per_page=100', { headers: headers() });
  if (!r.ok) throw new Error('gist list failed: ' + r.status);
  const found = {};
  for (const g of await r.json()) {
    for (const fname of Object.keys(g.files || {})) {
      const m = /^mtg-binder-(.+)\.json$/.exec(fname);
      if (m) found[m[1]] = g.id;
    }
  }
  return found;
}

async function ensureIds() {
  const cache = readCache();
  const known = checklists().map((c) => c.id);
  if (known.every((id) => cache[id])) return cache;
  idCache = Object.assign({}, await discover(), cache); // cache wins if both
  saveCache();
  return idCache;
}

/** Read every checklist gist and merge its stable checks and quantity extras. */
async function read() {
  const ids = await ensureIds();
  const merged = {};
  const mergedExtras = {};
  const mergedOrdered = {};
  const mergedWrapperArts = {};
  const mergedOrderedWrapperArts = {};
  const mergedLegacy = {};
  let newest = null;
  await Promise.all(Object.entries(ids).map(async ([clId, gistId]) => {
    try {
      const r = await fetch(API + '/gists/' + gistId, { headers: headers() });
      if (!r.ok) return;
      const j = await r.json();
      const f = (j.files || {})[fileFor(clId)];
      if (!f) return;
      let content = f.content;
      if (f.truncated && f.raw_url) content = await (await fetch(f.raw_url)).text();
      const body = JSON.parse(content);
      Object.assign(merged, body.checks || {});
      Object.assign(mergedExtras, body.extras || {});
      Object.assign(mergedOrdered, body.ordered || {});
      Object.assign(mergedWrapperArts, body.wrapperArts || {});
      Object.assign(mergedOrderedWrapperArts, body.orderedWrapperArts || {});
      Object.assign(mergedLegacy, body.legacyChecksV1 || {});
      if (body.updatedAt && (!newest || body.updatedAt > newest)) newest = body.updatedAt;
      lastHash[clId] = sha(JSON.stringify({
        checks: body.checks || {}, extras: body.extras || {}, legacyChecksV1: body.legacyChecksV1 || {},
      }));
    } catch (e) { /* skip a bad gist rather than lose everything */ }
  }));
  return { checks: merged, extras: mergedExtras, ordered: mergedOrdered,
    wrapperArts: mergedWrapperArts, orderedWrapperArts: mergedOrderedWrapperArts,
    keyVersion: 2, legacyChecksV1: mergedLegacy, updatedAt: newest, source: 'gist' };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

async function readChecklist(checklistId) {
  const ids = await ensureIds();
  const gistId = ids[checklistId] || null;
  if (!gistId) {
    return { checklistId, gistId: null, revision: null, etag: null,
      payload: { checklist: checklistId, title: titleFor(checklistId), keyVersion: 2,
        checks: {}, extras: {}, ordered: {}, wrapperArts: {}, orderedWrapperArts: {}, legacyChecksV1: {} } };
  }
  const response = await fetch(API + '/gists/' + gistId, { headers: headers() });
  if (!response.ok) throw new Error('gist read failed (' + checklistId + '): ' + response.status);
  const gist = await response.json();
  const file = (gist.files || {})[fileFor(checklistId)];
  if (!file) throw new Error('gist file missing for ' + checklistId);
  let content = file.content;
  if (file.truncated && file.raw_url) content = await (await fetch(file.raw_url)).text();
  let payload;
  try { payload = JSON.parse(content); } catch { throw new Error('gist payload is not valid JSON for ' + checklistId); }
  const etag = response.headers && typeof response.headers.get === 'function' ? response.headers.get('etag') : null;
  return { checklistId, gistId, etag,
    revision: (gist.history && gist.history[0] && gist.history[0].version) || gist.updated_at || sha(content),
    payload };
}

/**
 * Optimistic, checklist-scoped mutation used by the command-line adapter.
 * The callback receives the complete payload and must return the replacement.
 * Fields unknown to the CLI remain intact unless the callback explicitly edits them.
 */
async function updateChecklist(checklistId, expectedRevision, mutate) {
  if (!checklists().some((checklist) => checklist.id === checklistId)) {
    throw new Error('Unknown checklist: ' + checklistId);
  }
  const current = await readChecklist(checklistId);
  if (expectedRevision && current.revision && expectedRevision !== current.revision) {
    throw new Error('gist conflict for ' + checklistId + '; reload before applying a change');
  }
  const title = titleFor(checklistId);
  const next = mutate(clone(current.payload));
  if (!next || typeof next !== 'object') throw new Error('gist mutation must return an object');
  next.checklist = checklistId;
  next.title = next.title || title;
  next.keyVersion = next.keyVersion || 2;
  next.updatedAt = new Date().toISOString();
  const requestHeaders = headers();
  if (current.etag) requestHeaders['If-Match'] = current.etag;
  const content = JSON.stringify(next, null, 2);
  const body = { description: descFor(checklistId, title), files: { [fileFor(checklistId)]: { content } } };
  let response;
  if (current.gistId) {
    response = await fetch(API + '/gists/' + current.gistId, {
      method: 'PATCH', headers: requestHeaders, body: JSON.stringify(body),
    });
  } else {
    response = await fetch(API + '/gists', {
      method: 'POST', headers: requestHeaders, body: JSON.stringify(Object.assign({ public: false }, body)),
    });
  }
  if (!response.ok) {
    if (response.status === 412 || response.status === 409) {
      throw new Error('gist conflict for ' + checklistId + '; reload before applying a change');
    }
    throw new Error('gist update failed (' + checklistId + '): ' + response.status);
  }
  const saved = await response.json();
  if (!current.gistId && saved.id) {
    idCache = readCache(); idCache[checklistId] = saved.id; saveCache();
  }
  const verified = await readChecklist(checklistId);
  if (JSON.stringify(verified.payload.checks || {}) !== JSON.stringify(next.checks || {}) ||
      JSON.stringify(verified.payload.extras || {}) !== JSON.stringify(next.extras || {}) ||
      JSON.stringify(verified.payload.ordered || {}) !== JSON.stringify(next.ordered || {})) {
    throw new Error('gist verification failed for ' + checklistId);
  }
  return verified;
}

/** Split progress by checklist and write only the gists that actually changed. */
async function write(allChecks, meta = {}) {
  const ids = await ensureIds();
  const groups = {};
  const extraGroups = {};
  const legacyGroups = {};
  for (const [k, v] of Object.entries(allChecks || {})) {
    if (!v) continue;
    const clId = k.split('|')[0];
    (groups[clId] = groups[clId] || {})[k] = v;
  }
  for (const [k, v] of Object.entries(meta.legacyChecksV1 || {})) {
    if (!v) continue;
    const clId = k.split('|')[0];
    (legacyGroups[clId] = legacyGroups[clId] || {})[k] = v;
  }
  for (const [k, v] of Object.entries(meta.extras || {})) {
    if (Number(v) <= 0) continue;
    const clId = k.split('|')[0];
    (extraGroups[clId] = extraGroups[clId] || {})[k] = Number(v);
  }

  const touched = [];
  // Existing remote gists must participate even when their last quantity was
  // removed, otherwise an empty local checklist could never clear stale data.
  const checklistIds = new Set([...Object.keys(ids), ...Object.keys(groups),
    ...Object.keys(extraGroups), ...Object.keys(legacyGroups)]);
  await Promise.all([...checklistIds].map(async (clId) => {
    const checks = groups[clId] || {};
    const extras = extraGroups[clId] || {};
    const legacyChecksV1 = legacyGroups[clId] || {};
    const h = sha(JSON.stringify({ checks, extras, legacyChecksV1 }));
    if (lastHash[clId] === h && ids[clId]) return;      // nothing changed
    const title = titleFor(clId);
    const payload = JSON.stringify(
      { checklist: clId, title, keyVersion: meta.keyVersion || 2, checks, extras, legacyChecksV1,
        keyMigration: meta.keyMigration || null, updatedAt: new Date().toISOString() }, null, 2);
    const body = { description: descFor(clId, title), files: { [fileFor(clId)]: { content: payload } } };

    if (ids[clId]) {
      const r = await fetch(API + '/gists/' + ids[clId], {
        method: 'PATCH', headers: headers(), body: JSON.stringify(body) });
      if (!r.ok) throw new Error('gist update failed (' + clId + '): ' + r.status);
    } else {
      const r = await fetch(API + '/gists', {
        method: 'POST', headers: headers(), body: JSON.stringify(Object.assign({ public: false }, body)) });
      if (!r.ok) throw new Error('gist create failed (' + clId + '): ' + r.status);
      idCache = readCache(); idCache[clId] = (await r.json()).id; saveCache();
    }
    lastHash[clId] = h;
    touched.push(clId);
  }));

  return { savedAt: new Date().toISOString(), updated: touched, gists: links() };
}

/** For the dashboard: a clickable link per collection. */
function links() {
  const cache = readCache();
  return checklists()
    .filter((c) => cache[c.id])
    .map((c) => ({ id: c.id, title: c.title, url: 'https://gist.github.com/' + cache[c.id] }));
}

module.exports = { configured, read, write, whoami, links, ensureIds, readChecklist, updateChecklist };
