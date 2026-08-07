/**
 * MTG Sealed Collecting Binder — Node/Express server
 * Serves the checklist UI and provides live Google Drive sync of your progress.
 *
 * Drive scope used: drive.file (least-privilege — the app can only see/manage
 * the single progress file it creates, nothing else in your Drive).
 */
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const ebay = require('./lib/ebay');
const prices = require('./lib/prices');
const ai = require('./lib/ai');
const gist = require('./lib/gist');

const app = express();
const PORT = process.env.PORT || 3000;
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];
const PROGRESS_FILE_NAME = 'mtg-binder-progress.json';
const DATA_DIR = path.join(__dirname, '.data');
const TOKENS_PATH = path.join(DATA_DIR, 'tokens.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* Deployed instances are public, so lock them down. Set APP_PASSWORD in your
 * host's env vars; locally you can leave it unset and the app stays open. */
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const IS_DEPLOYED = Boolean(APP_PASSWORD || process.env.RENDER ||
  process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT);
if (IS_DEPLOYED) app.set('trust proxy', 1);

app.use(express.json({ limit: '4mb' }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-dev-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: IS_DEPLOYED, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
  })
);

/* Simple gate: browsers show a username/password prompt (any username works). */
app.use((req, res, next) => {
  if (!APP_PASSWORD || req.path === '/healthz') return next();
  const [scheme, val] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Basic' && val) {
    const pass = Buffer.from(val, 'base64').toString().split(':').slice(1).join(':');
    if (pass === APP_PASSWORD) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="MTG Binder"').status(401).send('Authentication required.');
});

app.use(express.static(path.join(__dirname, 'public')));

/* ---------- small local-store helpers (single-user personal app) ---------- */
function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

let cfg = readJSON(CONFIG_PATH, { email: null, fileId: null });
function saveCfg() { writeJSON(CONFIG_PATH, cfg); }

function isConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function newOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
  );
}

/** Returns an authorized client if we have stored tokens, else null.
 *  GOOGLE_REFRESH_TOKEN lets a deployed instance survive a wiped filesystem. */
function authedClient() {
  let tokens = readJSON(TOKENS_PATH, null);
  if (!tokens && process.env.GOOGLE_REFRESH_TOKEN) {
    tokens = { refresh_token: process.env.GOOGLE_REFRESH_TOKEN };
  }
  if (!tokens) return null;
  const client = newOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', (t) => {
    const merged = { ...readJSON(TOKENS_PATH, {}), ...t };
    writeJSON(TOKENS_PATH, merged);
  });
  return client;
}

/* ----------------------------- status / data ----------------------------- */
/* Storage backend: GitHub Gist wins if GITHUB_TOKEN is set, else Google Drive. */
function backend() {
  if (gist.configured()) return 'gist';
  if (readJSON(TOKENS_PATH, null) || process.env.GOOGLE_REFRESH_TOKEN) return 'drive';
  return null;
}

app.get('/api/status', async (req, res) => {
  const be = backend();
  let label = null;
  if (be === 'gist') label = 'GitHub Gist' + ((cfg.gh = cfg.gh || await gist.whoami()) ? ' · ' + cfg.gh : '');
  else if (be === 'drive') label = cfg.email || 'Google Drive';
  res.json({
    configured: isConfigured() || gist.configured(),
    connected: Boolean(be),
    backend: be,
    label,
    email: cfg.email || null,
  });
});

app.get('/api/data', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'binder_data.json'));
});

/* -------------------------------- OAuth ---------------------------------- */
app.get('/auth/google', (req, res) => {
  if (!isConfigured()) {
    return res
      .status(503)
      .send(
        '<h2>Google Drive not configured yet</h2><p>Add your Google OAuth credentials to a <code>.env</code> file, then restart. See the README for the 5-minute setup.</p><p><a href="/">&larr; Back</a></p>'
      );
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const url = newOAuthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state,
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    if (!req.query.code || req.query.state !== req.session.oauthState) {
      return res.status(400).send('Invalid OAuth state. <a href="/">Back</a>');
    }
    const client = newOAuthClient();
    const { tokens } = await client.getToken(req.query.code);
    writeJSON(TOKENS_PATH, tokens);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const me = await oauth2.userinfo.get();
    cfg.email = me.data.email || null;
    saveCfg();
    if (tokens.refresh_token) {
      console.log('\n  Drive connected. To survive redeploys on a host with an ephemeral disk,');
      console.log('  set this env var:\n    GOOGLE_REFRESH_TOKEN=' + tokens.refresh_token + '\n');
    }

    res.redirect('/?connected=1');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).send('Authorization failed. <a href="/">Back</a>');
  }
});

app.post('/auth/logout', (req, res) => {
  try { if (fs.existsSync(TOKENS_PATH)) fs.unlinkSync(TOKENS_PATH); } catch {}
  cfg = { email: null, fileId: null };
  saveCfg();
  res.json({ ok: true });
});

/* ----------------------------- Drive sync -------------------------------- */
async function ensureFileId(drive) {
  if (cfg.fileId) {
    try { await drive.files.get({ fileId: cfg.fileId, fields: 'id' }); return cfg.fileId; }
    catch { cfg.fileId = null; }
  }
  const list = await drive.files.list({
    q: `name='${PROGRESS_FILE_NAME}' and trashed=false`,
    spaces: 'drive',
    fields: 'files(id,name)',
  });
  if (list.data.files && list.data.files.length) {
    cfg.fileId = list.data.files[0].id; saveCfg(); return cfg.fileId;
  }
  return null;
}

app.get('/api/progress', async (req, res) => {
  if (backend() === 'gist') {
    try { return res.json(await gist.read()); }
    catch (e) { console.error('gist read:', e.message); return res.status(500).json({ error: 'gist-read-failed' }); }
  }
  const client = authedClient();
  if (!client) return res.status(401).json({ connected: false });
  try {
    const drive = google.drive({ version: 'v3', auth: client });
    const id = await ensureFileId(drive);
    if (!id) return res.json({ checks: {}, updatedAt: null, source: 'drive-empty' });
    const file = await drive.files.get({ fileId: id, alt: 'media' });
    const body = typeof file.data === 'string' ? JSON.parse(file.data) : file.data;
    res.json({ ...body, source: 'drive' });
  } catch (err) {
    console.error('progress read error:', err.message);
    res.status(500).json({ error: 'drive-read-failed' });
  }
});

app.put('/api/progress', async (req, res) => {
  if (backend() === 'gist') {
    try { return res.json(Object.assign({ ok: true }, await gist.write(req.body.checks || {}, {
      keyVersion: req.body.keyVersion || 2,
      extras: req.body.extras || {},
      legacyChecksV1: req.body.legacyChecksV1 || {},
      keyMigration: req.body.keyMigration || null,
    }))); }
    catch (e) { console.error('gist write:', e.message); return res.status(500).json({ error: 'gist-write-failed' }); }
  }
  const client = authedClient();
  if (!client) return res.status(401).json({ connected: false });
  try {
    const drive = google.drive({ version: 'v3', auth: client });
    const payload = JSON.stringify({
      checks: req.body.checks || {},
      extras: req.body.extras || {},
      keyVersion: req.body.keyVersion || 2,
      legacyChecksV1: req.body.legacyChecksV1 || {},
      keyMigration: req.body.keyMigration || null,
      updatedAt: new Date().toISOString(),
    });
    const media = { mimeType: 'application/json', body: payload };
    let id = await ensureFileId(drive);
    if (!id) {
      const created = await drive.files.create({
        requestBody: { name: PROGRESS_FILE_NAME, mimeType: 'application/json' },
        media,
        fields: 'id',
      });
      cfg.fileId = created.data.id; saveCfg();
    } else {
      await drive.files.update({ fileId: id, media });
    }
    res.json({ ok: true, savedAt: new Date().toISOString(), fileId: cfg.fileId });
  } catch (err) {
    console.error('progress write error:', err.message);
    res.status(500).json({ error: 'drive-write-failed' });
  }
});

/* ----------------------------- Live prices ------------------------------- */
/* CORS for the Chrome extension (local personal app). */
function extCors(req, res, next) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}
app.use(['/api/prices', '/api/ext', '/api/config'], extCors);

function checklistNames(checklistId) {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'binder_data.json'), 'utf8'));
  const cl = data.checklists.find((c) => c.id === checklistId);
  if (!cl) return [];
  const names = [];
  cl.eras.forEach((e) => e.items.forEach((it) => { if (it.value) names.push(it.name); }));
  return names;
}

/* Pick the lowest applicable per-box price from raw listings, using the AI
 * filter when configured, else a regex heuristic. */
async function aiPickLowest(target, raw) {
  if (!raw.length) return { lowestActive: null, count: 0 };
  let verdicts = null;
  if (ai.configured()) {
    verdicts = await ai.filterListings(target, raw.map((r) => ({ i: r.i, title: r.title, price: r.price })));
  }
  if (verdicts) {
    const ok = verdicts.filter((v) => v.applicable && typeof v.perBox === 'number' && v.perBox > 0).sort((a, b) => a.perBox - b.perBox);
    if (!ok.length) return { lowestActive: null, count: raw.length, applicable: 0, excluded: raw.length, filtered: 'ai' };
    const best = ok[0];
    return {
      lowestActive: Math.round(best.perBox),
      url: (raw.find((r) => r.i === best.i) || {}).url || null,
      count: raw.length, applicable: ok.length, excluded: raw.length - ok.length, filtered: 'ai',
    };
  }
  const boxes = raw.filter((r) => ebay.looksLikeBox(r.title)).sort((a, b) => a.price - b.price);
  if (!boxes.length) return { lowestActive: null, count: raw.length, applicable: 0, excluded: raw.length, filtered: 'heuristic' };
  return { lowestActive: Math.round(boxes[0].price), url: boxes[0].url, count: raw.length, applicable: boxes.length, excluded: raw.length - boxes.length, filtered: 'heuristic' };
}

let refreshState = { running: false, checklist: null, done: 0, total: 0, startedAt: null };

app.get('/api/prices', (req, res) => res.json({ prices: prices.getAll(), refresh: refreshState }));

app.post('/api/prices/refresh', async (req, res) => {
  const checklist = (req.query.checklist || 'lorcana').toString();
  if (refreshState.running) return res.status(409).json({ error: 'already-running', refresh: refreshState });
  const names = checklistNames(checklist);
  if (!names.length) return res.status(404).json({ error: 'no-items' });

  // Enqueue TCGplayer jobs for the extension to pick up.
  names.forEach((n) => prices.enqueueTcg(checklist, n));

  // eBay runs server-side, in the background, throttled.
  refreshState = { running: true, checklist, done: 0, total: names.length, startedAt: Date.now() };
  res.json({ started: true, items: names.length, note: 'eBay running server-side; TCGplayer queued for the extension.' });

  (async () => {
    for (const name of names) {
      try {
        const q = prices.buildQuery(checklist, name);
        const target = prices.buildTarget(checklist, name);
        let active = { lowestActive: null };
        try { active = await aiPickLowest(target, await ebay.searchActiveRaw(q)); }
        catch (e) { try { active = await ebay.searchActive(q); } catch (_) {} }
        let sold = { sold: null };
        try { sold = await ebay.searchSold(q); } catch (e) {}
        prices.setEbay(checklist, name, Object.assign({}, active, sold));
      } catch (e) { /* keep going */ }
      refreshState.done++;
      await new Promise((r) => setTimeout(r, 250)); // be gentle on the API
    }
    refreshState.running = false;
  })();
});

/* Extension job queue (TCGplayer). */
app.get('/api/ext/jobs', (req, res) => res.json({ jobs: prices.takeJobs(8), pending: prices.pendingJobCount() }));

app.post('/api/ext/ingest', async (req, res) => {
  const { key, tcg, candidates } = req.body || {};
  if (!key) return res.status(400).json({ error: 'no-key' });

  // New path: extension sends raw candidate listings → AI/heuristic picks the right one.
  if (Array.isArray(candidates) && candidates.length) {
    const [checklist, name] = key.split('::');
    const target = prices.buildTarget(checklist, name || '');
    let verdicts = null;
    if (ai.configured()) {
      verdicts = await ai.filterListings(target, candidates.map((c, i) => ({ i, title: c.title, price: c.price })));
    }
    let chosen = null, meta = {};
    if (verdicts) {
      const ok = verdicts.filter((v) => v.applicable && typeof v.perBox === 'number' && v.perBox > 0).sort((a, b) => a.perBox - b.perBox);
      chosen = ok.length ? Math.round(ok[0].perBox) : null;
      meta = { tcgApplicable: ok.length, tcgExcluded: candidates.length - ok.length, tcgFiltered: 'ai' };
    } else {
      const boxes = candidates.filter((c) => /booster box/i.test(c.title || '')).map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
      const any = candidates.map((c) => c.price).filter((p) => p > 0).sort((a, b) => a - b);
      chosen = boxes.length ? Math.round(boxes[0]) : (any.length ? Math.round(any[0]) : null);
      meta = { tcgFiltered: 'heuristic' };
    }
    prices.ingestTcg(key, chosen, meta);
    return res.json({ ok: true, tcg: chosen, ...meta });
  }

  // Back-compat: a single pre-picked price.
  prices.ingestTcg(key, typeof tcg === 'number' ? Math.round(tcg) : null);
  res.json({ ok: true });
});
app.get('/api/ext/ping', (req, res) => res.json({ ok: true, app: 'mtg-binder' }));

/* ---- API keys via the extension (stored on THIS server, not the extension) ---- */
const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');
function loadSecrets() {
  const s = readJSON(SECRETS_PATH, {});
  for (const [k, v] of Object.entries(s)) if (v) process.env[k] = v;
  return s;
}
loadSecrets();
const SECRET_KEYS = ['EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET', 'EBAY_TOKEN', 'EBAY_ENV', 'EBAY_MARKETPLACE',
  'AI_PROVIDER', 'AI_MODEL', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
const mask = (v) => (v ? v.slice(0, 4) + '••••' + v.slice(-2) : null);

function localOnly(req, res, next) {
  const ip = (req.ip || '').replace('::ffff:', '');
  if (IS_DEPLOYED || !(ip === '127.0.0.1' || ip === '::1')) {
    return res.status(403).json({ error: 'local-only', note: 'Set keys as env vars on your host instead.' });
  }
  next();
}
app.get('/api/config', localOnly, (req, res) => {
  const s = readJSON(SECRETS_PATH, {});
  const status = {};
  SECRET_KEYS.forEach((k) => { status[k] = process.env[k] ? (k.includes('ENV') || k.includes('PROVIDER') || k.includes('MARKETPLACE') || k.includes('MODEL') ? process.env[k] : mask(process.env[k])) : null; });
  res.json({ keys: status, ebayConfigured: !!(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) || !!process.env.EBAY_TOKEN, aiConfigured: ai.configured(), aiProvider: ai.provider(), aiModel: ai.model(), source: Object.keys(s).length ? 'extension+env' : 'env' });
});
app.post('/api/config', localOnly, (req, res) => {
  const incoming = req.body || {};
  const s = readJSON(SECRETS_PATH, {});
  let changed = 0;
  for (const k of SECRET_KEYS) {
    if (typeof incoming[k] === 'string' && incoming[k].trim()) { s[k] = incoming[k].trim(); process.env[k] = s[k]; changed++; }
    if (incoming[k] === null) { delete s[k]; delete process.env[k]; changed++; }
  }
  writeJSON(SECRETS_PATH, s);
  res.json({ ok: true, changed, note: 'Saved to .data/secrets.json on this machine. Restart not required for most keys.' });
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`\n  MTG Sealed Binder running →  http://localhost:${PORT}`);
  console.log(`  Google Drive: ${isConfigured() ? 'configured' : 'NOT configured (see README)'}\n`);
});
