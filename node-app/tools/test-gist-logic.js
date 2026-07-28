#!/usr/bin/env node
/**
 * Offline unit tests for the gist sync logic — no network, no token.
 * Fakes the GitHub API so the partition / merge / skip-unchanged behaviour
 * can be verified deterministically.
 *
 *   node tools/test-gist-logic.js
 */
const fs = require('fs');
const path = require('path');

process.env.GITHUB_TOKEN = 'ghp_fake_token_for_tests';
const DATA_DIR = path.join(__dirname, '..', '.data');
const IDPATH = path.join(DATA_DIR, 'gists.json');

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + msg); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + msg + `\n      expected ${JSON.stringify(b)}\n      got      ${JSON.stringify(a)}`); }
};

/* ---------------- fake GitHub ---------------- */
let store = {};        // gistId -> {description, files}
let calls = [];        // [method + path]
let nextId = 1;

function fakeFetch(url, opts = {}) {
  const method = opts.method || 'GET';
  const u = String(url);
  calls.push(method + ' ' + u.replace('https://api.github.com', ''));
  const json = (o, okFlag = true) => Promise.resolve({ ok: okFlag, status: okFlag ? 200 : 404, json: () => Promise.resolve(o), text: () => Promise.resolve('') });

  if (u.endsWith('/user')) return json({ login: 'testuser' });
  if (u.includes('/gists?per_page')) {
    return json(Object.entries(store).map(([id, g]) => ({ id, files: g.files, description: g.description })));
  }
  const m = /\/gists\/([^/?]+)$/.exec(u);
  if (m && method === 'GET') {
    const g = store[m[1]];
    return g ? json(g) : json({}, false);
  }
  if (m && method === 'PATCH') {
    const body = JSON.parse(opts.body);
    store[m[1]] = { description: body.description, files: Object.assign({}, store[m[1]].files, body.files) };
    return json({ id: m[1] });
  }
  if (u.endsWith('/gists') && method === 'POST') {
    const body = JSON.parse(opts.body);
    const id = 'gist' + (nextId++);
    store[id] = { description: body.description, files: body.files };
    return json({ id });
  }
  return json({}, false);
}

function freshGist() {
  try { fs.unlinkSync(IDPATH); } catch {}
  delete require.cache[require.resolve('../lib/gist')];
  return require('../lib/gist');
}

/* ---------------- tests ---------------- */
(async () => {
  console.log('\nGist logic tests (offline)\n' + '─'.repeat(46));
  globalThis.fetch = fakeFetch;

  // 1. one gist per checklist, correctly partitioned
  let gist = freshGist();
  const checks = {
    'collector|0|1|0': true,
    'collector|2|3|0': true,
    'boxes|1|0|0': true,
    'lorcana|3|2|4': true,
  };
  const meta = { keyVersion: 2, legacyChecksV1: { 'collector|0|1|0': true } };
  const w = await gist.write(checks, meta);
  eq(w.updated.sort(), ['boxes', 'collector', 'lorcana'], 'writes one gist per checklist');
  eq(Object.keys(store).length, 3, 'created exactly 3 gists');

  const names = Object.values(store).map((g) => Object.keys(g.files)[0]).sort();
  eq(names, ['mtg-binder-boxes.json', 'mtg-binder-collector.json', 'mtg-binder-lorcana.json'],
     'filenames follow mtg-binder-<checklist>.json');

  const collector = Object.values(store).find((g) => g.files['mtg-binder-collector.json']);
  const body = JSON.parse(collector.files['mtg-binder-collector.json'].content);
  eq(Object.keys(body.checks).length, 2, 'collector gist holds only its own 2 checks');
  eq(body.checklist, 'collector', 'payload records which checklist it is');
  eq(body.keyVersion, 2, 'payload records the content-key version');
  eq(body.legacyChecksV1['collector|0|1|0'], true, 'payload retains legacy recovery keys');
  eq(collector.description.startsWith('MTG Binder · '), true, 'gist gets a friendly name');

  // 2. unchanged writes are skipped (no pointless API traffic)
  calls = [];
  const w2 = await gist.write(checks, meta);
  eq(w2.updated, [], 'second identical save writes nothing');
  eq(calls.some((c) => c.startsWith('PATCH')), false, 'no PATCH issued when nothing changed');

  // 3. a change touches only the affected checklist
  const changed = Object.assign({}, checks, { 'boxes|9|9|0': true });
  const w3 = await gist.write(changed, meta);
  eq(w3.updated, ['boxes'], 'only the changed checklist is rewritten');

  // 4. read merges every gist back into one flat object
  gist = freshGist();                       // wipe id cache → force rediscovery
  const back = await gist.read();
  eq(Object.keys(back.checks).sort(), Object.keys(changed).sort(), 'read() merges all gists back');
  eq(back.checks['lorcana|3|2|4'], true, 'individual values survive the round trip');
  eq(back.legacyChecksV1['collector|0|1|0'], true, 'legacy recovery keys survive the round trip');

  // 5. discovery rebuilds ids from filenames after a wiped cache
  eq(Object.keys(await gist.ensureIds()).sort(), ['boxes', 'collector', 'lorcana'],
     'ids re-discovered from GitHub when the local cache is gone');

  // 6. links() gives the dashboard something to point at
  const links = gist.links();
  eq(links.length, 3, 'links() returns one URL per checklist');
  eq(links.every((l) => l.url.startsWith('https://gist.github.com/')), true, 'links are real gist URLs');

  try { fs.unlinkSync(IDPATH); } catch {}
  console.log('─'.repeat(46));
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
