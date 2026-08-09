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
      Object.assign(mergedLegacy, body.legacyChecksV1 || {});
      if (body.updatedAt && (!newest || body.updatedAt > newest)) newest = body.updatedAt;
      lastHash[clId] = sha(JSON.stringify({
        checks: body.checks || {}, extras: body.extras || {}, legacyChecksV1: body.legacyChecksV1 || {},
      }));
    } catch (e) { /* skip a bad gist rather than lose everything */ }
  }));
  return { checks: merged, extras: mergedExtras, keyVersion: 2,
    legacyChecksV1: mergedLegacy, updatedAt: newest, source: 'gist' };
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

module.exports = { configured, read, write, whoami, links, ensureIds };
