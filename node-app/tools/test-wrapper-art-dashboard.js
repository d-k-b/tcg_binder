#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const binder = JSON.parse(fs.readFileSync(path.join(root, 'data', 'binder_data.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'booster_wrapper_art_catalog.json'), 'utf8'));

assert.strictEqual(catalog.schema, 'mtg-booster-wrapper-art-catalog/v1');
assert.strictEqual(catalog.sets.length, 96);
assert.strictEqual(new Set(catalog.sets.map(set => set.setCode)).size, 96, 'set codes must be unique');
const artworks = catalog.sets.flatMap(set => set.artworks.map(art => ({ set, art })));
assert.strictEqual(artworks.length, 378);
assert.strictEqual(new Set(artworks.map(({ art }) => art.id)).size, 378, 'art IDs must be unique');
assert.ok(catalog.sets.every(set => set.artCount === set.artworks.length), 'declared art counts must match rows');

const observedStatuses = artworks.reduce((counts, { art }) => {
  counts[art.imageStatus] = (counts[art.imageStatus] || 0) + 1;
  return counts;
}, {});
assert.deepStrictEqual(observedStatuses, {
  exact_individual: 366,
  group_reference: 6,
  review_only: 3,
  pending_image_source: 3,
});

const byCode = Object.fromEntries(catalog.sets.map(set => [set.setCode, set]));
assert.deepStrictEqual(byCode.POR.artworks.map(art => art.id), ['POR-1', 'POR-2', 'POR-3', 'POR-4'],
  'Portal must remain the reviewed four-front checklist');
assert.ok(byCode.IMA.artworks.every((art, index) => art.id === `IMA-${index + 1}` && art.imageUrl.includes(`/ICO_${index + 1}.png`)),
  'Iconic Masters must keep IMA state IDs while using Forge ICO filenames');
assert.ok(['UNH', 'BBD'].every(code => byCode[code].artworks.every(art => art.imageStatus === 'group_reference')));
assert.ok(byCode.UST.artworks.every(art => art.imageStatus === 'review_only'));
assert.ok(byCode['2XM'].artworks.every(art => art.imageStatus === 'pending_image_source' && art.imageUrl === null));

const packs = binder.checklists.find(checklist => checklist.id === 'packs');
const packItems = packs.eras.flatMap(era => era.items);
const packCodes = new Set(packItems.map(item => item.code));
assert.deepStrictEqual(catalog.sets.filter(set => !packCodes.has(set.setCode)).map(set => set.setCode), ['UNH', 'UST', 'UMA'],
  'only the three cataloged regular products absent from the ownership model need wrapper-only rows');
assert.strictEqual(binder.checklists.flatMap(checklist => checklist.eras.flatMap(era => era.items.flatMap(item => item.slots)))
  .filter(slot => slot.r !== false).length, 910, 'wrapper art must not alter required targets');
assert.strictEqual(binder.checklists.flatMap(checklist => checklist.eras.flatMap(era => era.items.flatMap(item => item.slots))).length,
  950, 'wrapper art must not alter inventory slots');

assert.match(html, /const WRAPPER_ART_CATALOG = \{"schema":"mtg-booster-wrapper-art-catalog\/v1"/,
  'generated dashboard must embed the reviewed catalog');
assert.match(html, /\['booster','draft','play'\]\.includes/,
  'catalog attachment must require a regular pack lane and exclude same-code VIP/Collector rows');
assert.match(html, /packs\.eras\.push\(\{name:'Wrapper-Art Inventory Only'/,
  'the dashboard must expose all catalog fronts without adding ownership slots for UNH, UST, or UMA');
assert.match(html, /Wrapper artwork \(optional\)/);
assert.match(html, /fronts ·/);
assert.match(html, /Optional loose-wrapper inventory only — it does not affect pack targets or collection completion/);
assert.match(html, /img\.dataset\.wrapperSrc=art\.imageUrl/,
  'wrapper thumbnails must remain source-less until their nested drawer opens');
assert.match(html, /img\.onerror=\(\)=>\{img\.remove\(\);fallback\.hidden=false;\}/,
  'failed image loads must reveal a durable fallback instead of hiding the card');
assert.match(html, /fallback\.textContent='Image unavailable'/);
assert.match(html, /Exact individual image/);
assert.match(html, /Group reference/);
assert.match(html, /Review-only image candidate/);
assert.match(html, /Image source pending/);
assert.match(html, /function changeWrapperArtQuantity\(artId,delta,focusSide\)/,
  'each wrapper front must support explicit quantities greater than one');
assert.match(html, /value===true\?1:/,
  'legacy checked wrapper values must migrate to quantity one');
assert.match(html, /data-wrapper-qty-key/,
  'wrapper quantity controls must restore focus for repeated increment and decrement clicks');
assert.doesNotMatch(html, /checkbox\.onchange=/,
  'wrapper inventory must no longer collapse multiple copies into a boolean checkbox');
assert.match(html, /save\(\);driveTouch\(\);updateAll\(\);restoreWrapperFocus/,
  'wrapper quantity controls must persist locally, mark Gist sync dirty, rerender, and restore focus');
assert.match(html, /function changeOrderedWrapperArtQuantity\(artId,delta,focusSide\)/,
  'each exact wrapper front must track incoming quantities separately');
assert.match(html, /function receiveWrapperArt\(artId,focusSide\)/,
  'receiving a wrapper must atomically transfer its exact art ID into owned inventory');
assert.doesNotMatch(JSON.stringify(binder), /packs\|wrapper-art\|/,
  'optional wrapper checks must stay outside authoritative ownership slots and ProductRefs');

console.log('wrapper-art dashboard tests: 96 sets, 378 fronts, mappings, quantity migration, optional-state boundary, lazy images, and fallbacks passing');
