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
const binder = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'binder_data.json'), 'utf8'));

function norm(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function hash(value) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    h ^= BigInt(value.charCodeAt(i));
    h = BigInt.asUintN(64, h * 0x100000001b3n);
  }
  return h.toString(16).padStart(16, '0');
}
function keyFor(checklist, item, slotIndex) {
  const slot = item.slots[slotIndex], group = norm(slot.k || slot.g || slot.l);
  const ordinal = item.slots.slice(0, slotIndex)
    .filter((s) => norm(s.k || s.g || s.l) === group).length;
  return checklist + '|v2|' + hash([norm(checklist), norm(item.name), norm(item.code), group, ordinal].join('\u001f'));
}
const prerelease = binder.checklists.find((cl) => cl.id === 'prerelease');
const magic2015 = prerelease.eras.flatMap((era) => era.items).find((item) => item.name === 'Magic 2015');
const prereleaseVariantKeys = [keyFor('prerelease', magic2015, 0), keyFor('prerelease', magic2015, 1)];
const prereleaseExtraKey = 'prerelease|slot-extra|' + prereleaseVariantKeys[0].split('|').pop();
const lorcanaExtraKey = 'lorcana|extra|0123456789abcdef';

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
    [prereleaseVariantKeys[0]]: true,
    [prereleaseVariantKeys[1]]: true,
  };
  const meta = { keyVersion: 2,
    extras: { [prereleaseExtraKey]: 2, [lorcanaExtraKey]: 1 },
    legacyChecksV1: { 'collector|0|1|0': true } };
  const w = await gist.write(checks, meta);
  eq(w.updated.sort(), ['boxes', 'collector', 'lorcana', 'prerelease'], 'writes one gist per checklist');
  eq(Object.keys(store).length, 4, 'created exactly 4 gists');

  const names = Object.values(store).map((g) => Object.keys(g.files)[0]).sort();
  eq(names, ['mtg-binder-boxes.json', 'mtg-binder-collector.json', 'mtg-binder-lorcana.json', 'mtg-binder-prerelease.json'],
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
  eq(prereleaseVariantKeys.every((key) => back.checks[key]), true,
     'real named prerelease variant keys survive the pull/push/reload round trip');
  eq(back.extras[prereleaseExtraKey] === 2 && back.extras[lorcanaExtraKey] === 1, true,
     'per-variant and group-level duplicate quantities survive the pull/push/reload round trip');
  eq(back.legacyChecksV1['collector|0|1|0'], true, 'legacy recovery keys survive the round trip');

  // 5. editing one named variant patches only prerelease and preserves its sibling
  calls = [];
  const variantEdited = Object.assign({}, changed);
  delete variantEdited[prereleaseVariantKeys[1]];
  const w4 = await gist.write(variantEdited, meta);
  eq(w4.updated, ['prerelease'], 'editing one variant rewrites only the prerelease gist');
  gist = freshGist();
  const editedBack = await gist.read();
  eq(editedBack.checks[prereleaseVariantKeys[0]] === true && !editedBack.checks[prereleaseVariantKeys[1]], true,
     'variant-level edit is preserved after a fresh pull');
  eq(editedBack.extras[prereleaseExtraKey], 2,
     'editing ownership preserves the named variant duplicate quantity');

  // 6. changing only a duplicate quantity still patches the owning checklist
  calls = [];
  const quantityMeta = { ...meta, extras: { ...meta.extras, [prereleaseExtraKey]: 3 } };
  const w5 = await gist.write(variantEdited, quantityMeta);
  eq(w5.updated, ['prerelease'], 'editing only a named variant quantity rewrites its checklist gist');
  gist = freshGist();
  const quantityBack = await gist.read();
  eq(quantityBack.extras[prereleaseExtraKey], 3,
     'named variant quantity edit is preserved after a fresh pull');

  calls = [];
  const clearedChecks = { ...variantEdited };
  delete clearedChecks[prereleaseVariantKeys[0]];
  const clearedMeta = { ...quantityMeta, extras: { [lorcanaExtraKey]: 1 } };
  const w6 = await gist.write(clearedChecks, clearedMeta);
  eq(w6.updated, ['prerelease'], 'removing the final variant and duplicate clears its existing gist');
  gist = freshGist();
  const clearedBack = await gist.read();
  eq(!clearedBack.checks[prereleaseVariantKeys[0]] && !clearedBack.extras[prereleaseExtraKey], true,
     'an empty local variant quantity does not reappear after a fresh pull');

  // 7. discovery rebuilds ids from filenames after a wiped cache
  eq(Object.keys(await gist.ensureIds()).sort(), ['boxes', 'collector', 'lorcana', 'prerelease'],
     'ids re-discovered from GitHub when the local cache is gone');

  // 8. links() gives the dashboard something to point at
  const links = gist.links();
  eq(links.length, 4, 'links() returns one URL per checklist');
  eq(links.every((l) => l.url.startsWith('https://gist.github.com/')), true, 'links are real gist URLs');

  try { fs.unlinkSync(IDPATH); } catch {}
  console.log('─'.repeat(46));
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
