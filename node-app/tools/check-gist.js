#!/usr/bin/env node
/**
 * Gist connectivity diagnostic — run this locally, paste me the output.
 *
 *   node tools/check-gist.js
 *
 * Reads GITHUB_TOKEN from .env (or the environment) and does a full round-trip:
 * identity → list → write → read back → verify. It NEVER prints your token,
 * so the output is safe to share.
 */
require('dotenv').config();
const gist = require('../lib/gist');

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => console.log('  \x1b[31m✗\x1b[0m ' + m);
const info = (m) => console.log('  · ' + m);

(async () => {
  console.log('\nGist diagnostic\n' + '─'.repeat(46));

  const t = process.env.GITHUB_TOKEN;
  if (!t) {
    bad('No GITHUB_TOKEN found in .env or environment.');
    console.log('\n  Add it to .env:  GITHUB_TOKEN=ghp_...\n');
    process.exit(1);
  }
  ok(`Token present (${t.slice(0, 4)}…${t.slice(-3)}, ${t.length} chars)`);

  // 1. identity + scope
  let login;
  try {
    login = await gist.whoami();
    if (!login) throw new Error('no login returned');
    ok(`Authenticated as @${login}`);
  } catch (e) {
    bad('Auth failed: ' + e.message);
    console.log('\n  Most likely: token is wrong, expired, or missing the "gist" scope.');
    console.log('  Note fine-grained tokens do NOT work — use a classic token.\n');
    process.exit(1);
  }

  // 2. discovery
  let ids;
  try {
    ids = await gist.ensureIds();
    const n = Object.keys(ids).length;
    n ? ok(`Found ${n} existing binder gist(s): ${Object.keys(ids).join(', ')}`)
      : info('No binder gists yet — they get created on first save.');
  } catch (e) {
    bad('Listing gists failed: ' + e.message);
    console.log('\n  The token probably lacks the "gist" scope.\n');
    process.exit(1);
  }

  // 3. round-trip on a throwaway key
  const probe = `__diagnostic|${Date.now()}`;
  try {
    const before = await gist.read();
    const merged = Object.assign({}, before.checks, { [probe]: true });
    const w = await gist.write(merged);
    ok(`Write OK (updated: ${w.updated.join(', ') || 'none'})`);

    const after = await gist.read();
    if (after.checks[probe]) ok('Read-back verified — the value survived the round trip');
    else bad('Read-back FAILED — wrote, but the value did not come back');

    // clean up the probe
    delete merged[probe];
    await gist.write(merged);
    ok('Cleaned up diagnostic key');
  } catch (e) {
    bad('Round trip failed: ' + e.message);
    process.exit(1);
  }

  const links = gist.links();
  if (links.length) {
    console.log('\n  Your gists:');
    links.forEach((l) => console.log(`    ${l.title}\n      ${l.url}`));
  }
  console.log('\n\x1b[32mAll good — sync is working.\x1b[0m\n');
})();
