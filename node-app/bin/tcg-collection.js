#!/usr/bin/env node
'use strict';

/*
 * Safe command-line adapter for the canonical private-Gist collection state.
 * It is intentionally explicit: mutations preview by default and require
 * --apply after resolving one unambiguous catalog ProductRef.
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const state = require('../lib/collection-state');
const gist = require('../lib/gist');

const catalogPath = path.join(__dirname, '..', 'data', 'binder_data.json');
const index = state.createCatalog(JSON.parse(fs.readFileSync(catalogPath, 'utf8')));

function fail(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exitCode = 1;
}

function usage() {
  return `Usage:
  node bin/tcg-collection.js find <query> [--lane <checklist>]
  node bin/tcg-collection.js show <productId-or-query> [--lane <checklist>] [--json]
  node bin/tcg-collection.js set <productId-or-query> [--lane <checklist>] [--owned <n>] [--ordered <n>] [--apply] [--json]
  node bin/tcg-collection.js receive <productId-or-query> [--lane <checklist>] [--count <n>] [--apply] [--json]

Mutations are previews until --apply is supplied. GITHUB_TOKEN with only the
gist scope must be present in the process environment for show/set/receive.
Use an exact productId when a name exists in more than one checklist.`;
}

function parse(argv) {
  const [command, query, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) throw new Error('Unexpected argument: ' + token);
    const name = token.slice(2);
    if (name === 'apply' || name === 'json') options[name] = true;
    else {
      const value = rest[++i];
      if (value === undefined || value.startsWith('--')) throw new Error('Missing value for --' + name);
      options[name] = value;
    }
  }
  return { command, query, options };
}

function asInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error('--' + name + ' must be a non-negative integer');
  return Number(value);
}

function write(value, json) {
  if (json) return process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (Array.isArray(value)) {
    for (const row of value) process.stdout.write(row.checklistId + '\t' + row.productId + '\t' + row.product + '\n');
    return;
  }
  process.stdout.write([
    value.product + ' [' + value.checklistId + ']',
    'ProductRef: ' + value.productId,
    'Owned: ' + value.owned + ' | Ordered: ' + value.ordered + ' | Target: ' + value.target + ' | Remaining: ' + value.remaining,
    value.mode ? 'Mode: ' + value.mode : null,
    value.note || null,
  ].filter(Boolean).join('\n') + '\n');
}

function catalogRow(entry) {
  return {
    productId: entry.ref.productId,
    checklistId: entry.checklist.id,
    checklistTitle: entry.checklist.title,
    product: entry.ref.productName,
    game: entry.ref.game,
    setCode: entry.ref.setCode,
  };
}

async function remoteState(entry) {
  if (!gist.configured()) throw new Error('GITHUB_TOKEN is not set; the CLI will not read browser-local state');
  const remote = await gist.readChecklist(entry.checklist.id);
  return { remote, data: state.emptyState(remote.payload) };
}

async function run() {
  const { command, query, options } = parse(process.argv.slice(2));
  if (!command || command === 'help' || command === '--help') return process.stdout.write(usage() + '\n');
  if (!query) throw new Error('Missing product query.\n\n' + usage());
  const lane = options.lane;
  if (command === 'find') {
    return write(state.findProducts(index, query, lane).map(catalogRow), options.json);
  }
  const entry = state.resolveProduct(index, query, lane);
  const { remote, data } = await remoteState(entry);
  if (command === 'show') return write({ ...state.describe(data, entry), revision: remote.revision }, options.json);
  if (command !== 'set' && command !== 'receive') throw new Error('Unknown command: ' + command + '\n\n' + usage());

  let next;
  if (command === 'set') {
    if (options.owned === undefined && options.ordered === undefined) {
      throw new Error('set requires --owned and/or --ordered');
    }
    next = state.setQuantities(data, entry, {
      owned: asInteger(options.owned, 'owned'), ordered: asInteger(options.ordered, 'ordered'),
    });
  } else {
    next = state.receive(data, entry, asInteger(options.count, 'count', 1));
  }
  const preview = { ...state.describe(next, entry), revision: remote.revision,
    mode: options.apply ? 'apply' : 'dry-run',
    note: options.apply ? 'Writing and verifying the private Gist.' : 'Preview only. Re-run with --apply to write.' };
  if (!options.apply) return write(preview, options.json);
  const verified = await gist.updateChecklist(entry.checklist.id, remote.revision, (payload) => ({
    ...payload,
    checks: next.checks,
    extras: next.extras,
    ordered: next.ordered,
    wrapperArts: next.wrapperArts,
    orderedWrapperArts: next.orderedWrapperArts,
    legacyChecksV1: next.legacyChecksV1,
  }));
  return write({ ...state.describe(state.emptyState(verified.payload), entry), revision: verified.revision,
    mode: 'applied', note: 'Private Gist read back and verified.' }, options.json);
}

run().catch((error) => fail(error.message));
