#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(html, /Edit collection/);
assert.match(html, /Revise Collection/);
assert.match(html, /Apply as local revision/);
assert.match(html, /Local revision — published collection unchanged/);
assert.match(html, /Publish revision/);
assert.match(html, /Discard revision/);
assert.match(html, /revisesCollectionId/);
assert.match(html, /baseRevision/);
assert.match(html, /revisionProgressLosses/);
assert.match(html, /definition\.lifecycle==='draft'&&definition\.authoring&&definition\.authoring\.revisesCollectionId\)return/,
  'a staged revision must not double-count global progress');
assert.match(html, /filter\(definition=>definition\.lifecycle==='live'\)/,
  'only live definitions may enter Gist sync');

const start = html.indexOf('function revisionDraftFor');
const end = html.indexOf('async function publishCustomRevision', start);
assert.ok(start > 0 && end > start, 'revision helpers must be extractable');
const source = html.slice(start, end);

const oldDefinition = {
  collectionId: 'custom-live-test', lifecycle: 'live', revision: 3, title: 'Carbonite Packs', sub: 'Two each',
  eras: [{ id: 'old-era', name: 'Released products', items: [{ id: 'old-item', name: 'Jump to Lightspeed Carbonite Pack', code: 'SWH0406EN',
    sourceRef: { schema: 'tcg.external-catalog-source/v1', productName: 'Jump to Lightspeed Carbonite Pack', variantName: 'Carbonite Edition' },
    slots: [{ id: 'old-slot-1', l: 'Copy 1', g: 'Copies', k: 'Copies', r: true },
      { id: 'old-slot-2', l: 'Copy 2', g: 'Copies', k: 'Copies', r: true }] }] }]
};
const candidate = {
  collectionId: 'custom-generated', lifecycle: 'draft', revision: 1, title: 'Carbonite Packs', sub: 'Two each',
  eras: [{ id: 'new-era', name: 'Released products', items: [{ id: 'new-item', name: 'Jump to Lightspeed Carbonite Pack', code: 'SWH0406EN',
    sourceRef: { schema: 'tcg.external-catalog-source/v1', productName: 'Jump to Lightspeed Carbonite Pack', variantName: 'Carbonite Edition' },
    slots: [{ id: 'new-slot-1', l: 'Copy 1', g: 'Copies', k: 'Copies', r: true },
      { id: 'new-slot-2', l: 'Copy 2', g: 'Copies', k: 'Copies', r: true }] },
    { id: 'new-item-2', name: 'Legends of the Force Carbonite Pack', code: 'SWH0506EN',
      sourceRef: { schema: 'tcg.external-catalog-source/v1', productName: 'Legends of the Force Carbonite Pack', variantName: 'Carbonite Edition' },
      slots: [{ id: 'new-slot-3', l: 'Copy 1', g: 'Copies', k: 'Copies', r: true },
        { id: 'new-slot-4', l: 'Copy 2', g: 'Copies', k: 'Copies', r: true }] }] }]
};
const state = {
  checks: { 'custom-live-test|v2|old-slot-1': true, 'custom-live-test|v2|old-slot-2': true },
  extras: { 'custom-live-test|slot-extra|old-slot-1': 1 },
  ordered: { 'custom-live-test|slot-extra|old-slot-2': 1 },
  collectionLibrary: { collections: [] }, ui: { closed: {} }
};
const keyFor = (collectionId, item, index) => `${collectionId}|v2|${item.slots[index].id}`;
const extraKey = (collectionId, item, index) => `${collectionId}|slot-extra|${item.slots[index].id}`;
const context = vm.createContext({
  console, Date, JSON, Map, Set, Number, Object, Array, state, BUILD: 'test-build',
  EXTERNAL_CATALOG_SOURCE_SCHEMA: 'tcg.external-catalog-source/v1',
  normKeyPart: value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '),
  keyFor, slotExtraKeyFor: extraKey,
  slotQuantity: (collectionId, item, index) => (state.checks[keyFor(collectionId, item, index)] ? 1 : 0) +
    Number(state.extras[extraKey(collectionId, item, index)] || 0),
  orderedForSlot: (collectionId, item, index) => Number(state.ordered[extraKey(collectionId, item, index)] || 0),
  collectionProgressKeys: collectionId => ({
    checks: Object.keys(state.checks).filter(key => key.startsWith(collectionId + '|')),
    extras: Object.keys(state.extras).filter(key => key.startsWith(collectionId + '|')),
    ordered: Object.keys(state.ordered).filter(key => key.startsWith(collectionId + '|'))
  }),
  normalizeCollectionDefinition: value => value,
  pricingError: (code, message) => Object.assign(new Error(message), { code }),
  customDefinitionFor: collectionId => state.collectionLibrary.collections.find(definition => definition.collectionId === collectionId) || null,
  confirm: () => true,
  newStableId: prefix => prefix + '-generated-stable-id', syncCustomChecklists: () => {}, save: () => {}, updateAll: () => {}
});
vm.runInContext(source, context);

const stable = context.reuseDefinitionStableIds(oldDefinition, candidate);
assert.strictEqual(stable.eras[0].id, 'old-era');
assert.strictEqual(stable.eras[0].items[0].id, 'old-item');
assert.deepStrictEqual(stable.eras[0].items[0].slots.map(slot => slot.id), ['old-slot-1', 'old-slot-2'],
  'unchanged products and copy slots must retain immutable IDs');
assert.deepStrictEqual(stable.eras[0].items[1].slots.map(slot => slot.id), ['new-slot-3', 'new-slot-4'],
  'new products must retain newly generated IDs');

const snapshot = context.definitionQuantitySnapshot('custom-live-test', oldDefinition);
context.restoreDefinitionQuantitySnapshot('custom-revision-test', stable, snapshot);
assert.strictEqual(state.checks['custom-revision-test|v2|old-slot-1'], true);
assert.strictEqual(state.checks['custom-revision-test|v2|old-slot-2'], true);
assert.strictEqual(state.extras['custom-revision-test|slot-extra|old-slot-1'], 1,
  'owned duplicates must migrate to the matching immutable slot');
assert.strictEqual(state.ordered['custom-revision-test|slot-extra|old-slot-2'], 1,
  'ordered quantities must migrate independently to the matching immutable slot');
assert.strictEqual(state.checks['custom-revision-test|v2|new-slot-3'], undefined,
  'new products must start unowned');

const removingCopyTwo = JSON.parse(JSON.stringify(stable));
removingCopyTwo.eras[0].items[0].slots.pop();
const losses = context.revisionProgressLosses('custom-live-test', oldDefinition, removingCopyTwo);
assert.deepStrictEqual(Array.from(losses, value => ({ name: value.name, slot: value.slot, owned: value.owned, ordered: value.ordered })),
  [{ name: 'Jump to Lightspeed Carbonite Pack', slot: 'Copy 2', owned: 1, ordered: 1 }],
  'removed slots with saved data must be named before destructive publication');

state.collectionLibrary.collections = [oldDefinition];
state.checks = { 'custom-live-test|v2|old-slot-1': true, 'custom-live-test|v2|old-slot-2': true };
state.extras = { 'custom-live-test|slot-extra|old-slot-1': 1 };
state.ordered = { 'custom-live-test|slot-extra|old-slot-2': 1 };
const staged = context.installCollectionRevision('custom-live-test', JSON.parse(JSON.stringify(candidate)));
assert.strictEqual(state.collectionLibrary.collections.length, 2, 'editing a live collection must retain the published definition');
assert.strictEqual(state.collectionLibrary.collections[0].lifecycle, 'live');
assert.strictEqual(staged.lifecycle, 'draft');
assert.strictEqual(staged.authoring.revisesCollectionId, 'custom-live-test');
assert.strictEqual(staged.authoring.baseRevision, 3);
assert.strictEqual(state.checks['custom-live-test|v2|old-slot-1'], true,
  'staging a revision must not mutate published ownership');
assert.strictEqual(state.checks[`${staged.collectionId}|v2|old-slot-1`], true,
  'the local revision must receive a separate working copy of matching progress');
assert.strictEqual(state.extras[`${staged.collectionId}|slot-extra|old-slot-1`], 1);
assert.strictEqual(state.ordered[`${staged.collectionId}|slot-extra|old-slot-2`], 1);

const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');
console.log('custom collection revision tests: edit UI, full-definition AI context, immutable-ID reuse, owned/ordered migration, explicit loss reporting, staged-Gist isolation, and generated parity passing');
