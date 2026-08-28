#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const state = require('../lib/collection-state');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'binder_data.json'), 'utf8'));
const index = state.createCatalog(catalog);
let passed = 0;

function test(name, fn) {
  try { fn(); passed += 1; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  catch (error) { console.error('  \x1b[31m✗\x1b[0m ' + name + '\n    ' + error.stack); process.exitCode = 1; }
}

function product(productId) { return state.resolveProduct(index, productId); }

console.log('\nCollection-state core tests\n' + '─'.repeat(46));

test('resolves an exact ProductRef without name matching', () => {
  const entry = product('mtg:mir:mirage:booster:display:en');
  assert.equal(entry.checklist.id, 'boxes');
  assert.equal(entry.item.name, 'Mirage');
});

test('quantity writes use the same stable group key as the dashboard', () => {
  const entry = product('mtg:mir:mirage:booster:display:en');
  const next = state.setQuantities({}, entry, { owned: 3, ordered: 2 });
  const details = state.describe(next, entry);
  assert.deepEqual({ owned: details.owned, ordered: details.ordered, target: details.target }, { owned: 3, ordered: 2, target: 1 });
  assert.equal(next.checks[state.keyFor('boxes', entry.item, 0)], true);
  assert.equal(next.extras[state.groupKeyFor('boxes', entry.item, 'Box')], 2);
  assert.equal(next.ordered[state.groupKeyFor('boxes', entry.item, 'Box')], 2);
});

test('set and draft Strixhaven boxes cannot collide', () => {
  const setBox = product('mtg:stx:strixhaven-school-of-mages:set-booster:display:en');
  const draftBox = product('mtg:stx:strixhaven-school-of-mages:draft-booster:display:en');
  let next = state.setQuantities({}, setBox, { owned: 2 });
  next = state.setQuantities(next, draftBox, { owned: 1 });
  assert.equal(state.describe(next, setBox).owned, 2);
  assert.equal(state.describe(next, draftBox).owned, 1);
  assert.notEqual(state.groupKeyFor('boxes', setBox.item, 'Set'), state.groupKeyFor('boxes', draftBox.item, 'Draft'));
});

test('receive moves ordered quantity into owned quantity', () => {
  const entry = product('mtg:jou:journey-into-nyx:booster:display:en');
  const incoming = state.setQuantities({}, entry, { ordered: 2 });
  const received = state.receive(incoming, entry, 1);
  assert.equal(state.describe(received, entry).owned, 1);
  assert.equal(state.describe(received, entry).ordered, 1);
});

test('Lorcana two-copy ProductRefs operate on the shared Copies group', () => {
  const entry = product('lorcana:s12:wilds-unknown:booster:display:en');
  const next = state.setQuantities({}, entry, { owned: 2, ordered: 1 });
  const details = state.describe(next, entry);
  assert.equal(details.slotGroup, 'Copies');
  assert.equal(details.target, 2);
  assert.equal(details.owned, 2);
  assert.equal(details.ordered, 1);
});

test('distinct prerelease variants retain their per-slot quantity model', () => {
  const entry = product('mtg:jou:journey-into-nyx:prerelease-kit:kit:forged-in-glory:en');
  const next = state.setQuantities({}, entry, { owned: 6, ordered: 1 });
  const details = state.describe(next, entry);
  assert.equal(details.progressMode, 'distinct_variants');
  assert.equal(details.owned, 6);
  assert.equal(details.ordered, 1);
  assert.ok(Object.keys(next.extras).some((key) => key.startsWith('prerelease|slot-extra|')));
});

test('invalid quantities fail without mutating the caller state', () => {
  const entry = product('mtg:mir:mirage:booster:display:en');
  const source = { checks: { keep: true } };
  assert.throws(() => state.setQuantities(source, entry, { owned: -1 }), /non-negative integer/);
  assert.deepEqual(source, { checks: { keep: true } });
});

console.log('─'.repeat(46));
console.log(passed + ' passed' + (process.exitCode ? ', failures above' : '') + '\n');
