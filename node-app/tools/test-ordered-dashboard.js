#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const start = html.indexOf('const DATA = ');
const end = html.indexOf('const pct=', start);
assert.ok(start >= 0 && end > start, 'generated ownership helpers must exist');
const source = html.slice(start, end);
const store = new Map();
const context = vm.createContext({
  console,
  setTimeout: () => 1,
  clearTimeout: () => {},
  localStorage: {
    getItem: key => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
  },
  driveTouch: () => {},
  updateAll: () => {},
});
vm.runInContext(source, context);

const audit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const boxes=DATA.checklists.find(cl=>cl.id==='boxes');
  const box=boxes.eras.flatMap(era=>era.items).find(item=>groupedSlots(item).some(group=>groupTarget(group)===1));
  const boxGroup=groupedSlots(box).find(group=>groupTarget(group)===1);
  const before=clProgress(boxes);
  changeOrderedQuantity(boxes.id,box,boxGroup,1);
  const orderedOnly={owned:ownedForGroup(boxes.id,box,boxGroup),ordered:orderedForGroup(boxes.id,box,boxGroup),
    complete:itemComplete(boxes.id,box),covered:itemCovered(boxes.id,box),progress:clProgress(boxes)};
  changeQuantity(boxes.id,box,boxGroup,1);
  const acquiredSeparately={owned:ownedForGroup(boxes.id,box,boxGroup),ordered:orderedForGroup(boxes.id,box,boxGroup)};
  receiveQuantity(boxes.id,box,boxGroup);
  const received={owned:ownedForGroup(boxes.id,box,boxGroup),ordered:orderedForGroup(boxes.id,box,boxGroup),
    complete:itemComplete(boxes.id,box),progress:clProgress(boxes)};

  const prerelease=DATA.checklists.find(cl=>cl.id==='prerelease');
  const variantItem=prerelease.eras.flatMap(era=>era.items).find(item=>item.name==='Magic 2015');
  changeSlotOrderedQuantity(prerelease.id,variantItem,1,1);
  changeSlotOrderedQuantity(prerelease.id,variantItem,1,1);
  receiveSlotQuantity(prerelease.id,variantItem,1);
  const variant={name:variantItem.variants[1],owned:slotQuantity(prerelease.id,variantItem,1),
    ordered:orderedForSlot(prerelease.id,variantItem,1),complete:itemComplete(prerelease.id,variantItem)};

  const aggregateVariantItem=prerelease.eras.flatMap(era=>era.items).find(item=>item.name==='Dragons of Tarkir');
  const aggregateVariantGroup=groupedSlots(aggregateVariantItem)[0];
  changeOrderedQuantity(prerelease.id,aggregateVariantItem,aggregateVariantGroup,1);
  changeOrderedQuantity(prerelease.id,aggregateVariantItem,aggregateVariantGroup,1);
  const aggregateBeforeReceive=aggregateVariantItem.slots.map((slot,si)=>orderedForSlot(prerelease.id,aggregateVariantItem,si));
  receiveQuantity(prerelease.id,aggregateVariantItem,aggregateVariantGroup);
  const aggregateAfterReceive={owned:aggregateVariantItem.slots.map((slot,si)=>slotQuantity(prerelease.id,aggregateVariantItem,si)),
    ordered:aggregateVariantItem.slots.map((slot,si)=>orderedForSlot(prerelease.id,aggregateVariantItem,si))};

  const packs=DATA.checklists.find(cl=>cl.id==='packs');
  const packItem=packs.eras.flatMap(era=>era.items).find(item=>groupedSlots(item).some(group=>groupTarget(group)===2));
  const packGroup=groupedSlots(packItem).find(group=>groupTarget(group)===2);
  changeOrderedQuantity(packs.id,packItem,packGroup,1);changeOrderedQuantity(packs.id,packItem,packGroup,1);
  const packOrdered={owned:ownedForGroup(packs.id,packItem,packGroup),ordered:orderedForGroup(packs.id,packItem,packGroup),
    complete:itemComplete(packs.id,packItem),covered:itemCovered(packs.id,packItem)};
  receiveQuantity(packs.id,packItem,packGroup);receiveQuantity(packs.id,packItem,packGroup);
  const packReceived={owned:ownedForGroup(packs.id,packItem,packGroup),ordered:orderedForGroup(packs.id,packItem,packGroup),
    complete:itemComplete(packs.id,packItem)};
  const wrapperItem=packs.eras.flatMap(era=>era.items).find(item=>item.code==='4ED');
  const art=wrapperArtSetFor(packs.id,wrapperItem).artworks[0];
  const wrapperProgressBefore=clProgress(packs);
  changeOrderedWrapperArtQuantity(art.id,2);
  receiveWrapperArt(art.id);
  const wrapper={key:wrapperArtKey(art.id),owned:wrapperArtQuantity(art.id),ordered:orderedWrapperArtQuantity(art.id),
    progressBefore:wrapperProgressBefore,progress:clProgress(packs)};

  const persisted=JSON.parse(localStorage.getItem(KEY));
  const restored=migrateState(JSON.parse(JSON.stringify(persisted)));
  const sanitized=migrateState({checks:{},extras:{},ordered:{bad:9,'boxes|extra|0123456789abcdef':true},
    wrapperArts:{},orderedWrapperArts:{bad:4,'packs|wrapper-art|4ED-2':true},ui:{}});
  return {before,orderedOnly,acquiredSeparately,received,variant,aggregateBeforeReceive,aggregateAfterReceive,packOrdered,packReceived,wrapper,
    restoredOrdered:restored.ordered,restoredOrderedWrapperArts:restored.orderedWrapperArts,
    sanitizedOrdered:sanitized.ordered,sanitizedOrderedWrapperArts:sanitized.orderedWrapperArts};
})())`, context));

assert.deepStrictEqual(audit.orderedOnly, {
  owned: 0, ordered: 1, complete: false, covered: true, progress: audit.before,
}, 'ordered-only coverage must not count as physical completion or progress');
assert.deepStrictEqual(audit.acquiredSeparately, { owned: 1, ordered: 1 },
  'adding an in-hand copy must leave the incoming copy untouched');
assert.strictEqual(audit.received.owned, 2, 'receiving must add exactly one physical copy');
assert.strictEqual(audit.received.ordered, 0, 'receiving must remove exactly one incoming copy');
assert.strictEqual(audit.received.complete, true);
assert.strictEqual(audit.received.progress.done, audit.before.done + 1,
  'only physical receipt may advance completion');
assert.deepStrictEqual(audit.variant, {
  name: 'Hunt with Guile', owned: 1, ordered: 1, complete: false,
}, 'named prerelease receipt must transfer only the exact selected variant');
assert.deepStrictEqual(audit.aggregateBeforeReceive, [1, 1, 0, 0, 0],
  'aggregate ordered plus must cover missing named variants in deterministic listed order');
assert.deepStrictEqual(audit.aggregateAfterReceive, {
  owned: [0, 1, 0, 0, 0], ordered: [1, 0, 0, 0, 0],
}, 'aggregate receive must transfer one exact incoming variant without cross-crediting another');
assert.deepStrictEqual(audit.packOrdered, { owned: 0, ordered: 2, complete: false, covered: true },
  'a two-pack target may be covered by two incoming copies without becoming complete');
assert.deepStrictEqual(audit.packReceived, { owned: 2, ordered: 0, complete: true },
  'receiving both pack copies must complete the physical two-pack target');
assert.strictEqual(audit.wrapper.key, 'packs|wrapper-art|4ED-1');
assert.deepStrictEqual({ owned: audit.wrapper.owned, ordered: audit.wrapper.ordered }, { owned: 1, ordered: 1 },
  'wrapper receipt must preserve another incoming copy on the exact art ID');
assert.deepStrictEqual(audit.wrapper.progress, audit.wrapper.progressBefore,
  'wrapper ordering and receipt must remain outside required progress');
assert.strictEqual(Object.values(audit.restoredOrdered).reduce((sum, value) => sum + value, 0), 2,
  'ordered product quantities must persist separately');
assert.strictEqual(Object.values(audit.restoredOrderedWrapperArts).reduce((sum, value) => sum + value, 0), 1,
  'ordered wrapper quantities must persist separately');
assert.deepStrictEqual(audit.sanitizedOrdered, { 'boxes|extra|0123456789abcdef': 1 },
  'ordered migration must retain only stable quantity keys and migrate booleans to one');
assert.deepStrictEqual(audit.sanitizedOrderedWrapperArts, { 'packs|wrapper-art|4ED-2': 1 },
  'ordered wrapper migration must retain only stable wrapper IDs');

assert.match(html, /className='incomingbadge'/, 'compact controls must show an incoming package badge');
assert.match(html, /classList\.add\('ordertray'\)/, 'ordered controls must float without widening rows');
assert.match(html, /function receiveIconSVG\(\)/, 'receive must use the compact package-into-hand icon');
assert.match(html, /Receive one ordered/, 'receive controls must keep a full accessible label');
assert.match(html, /\.item\.done \.qtyctrl\.goal:hover,\.item\.done \.qtyctrl\.goal:focus-within\{opacity:1\}/,
  'completed-row quantity and receive controls must return to full contrast while active');
assert.match(html, /@media\(max-width:620px\)[\s\S]*?\.ordertray\{left:58px\}[\s\S]*?\.ordertray \.ordericon\{display:none\}/,
  'narrow layouts must keep the ordered tray contiguous and compact instead of docking it across the row');
assert.match(html, /function receiveQuantity\(cl,it,g,focusSide\)/,
  'group receipt must be an atomic ordered-to-owned transfer');
assert.match(html, /function receiveSlotQuantity\(cl,it,si,focusSide\)/,
  'named variants must receive against their exact slot');
assert.match(html, /function receiveWrapperArt\(artId,focusSide\)/,
  'wrapper fronts must receive against their exact stable art ID');

console.log('ordered dashboard tests: compact badge/tray, separate persistence, exact variants, wrapper art, coverage, and atomic receive passing');
