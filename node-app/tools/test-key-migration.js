#!/usr/bin/env node
/** Exercises the exact migration/key code embedded in the generated dashboard. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function ok(value, message) {
  if (value) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + message); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + message); }
}

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'mtg_binder_app.html'), 'utf8');
const start = html.indexOf('const DATA = ');
const end = html.indexOf('const pct=', start);
if (start < 0 || end < 0) throw new Error('Could not find generated key-migration code');
const source = html.slice(start, end);

const legacy = {
  checks: {
    'collector|0|0|0': true,
    'packs|10|0|0': true,
    'lorcana|0|0|1': true,
    'boxes|999|0|0': true,
  },
  ui: { active: 'collector', hideDone: false, closed: {} },
  theme: 'light',
};
const store = new Map([['mtgBinder_v1', JSON.stringify(legacy)]]);
const context = vm.createContext({
  console,
  driveTouch: () => {},
  updateAll: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
  localStorage: {
    getItem: (k) => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
});

console.log('\nContent-key migration tests\n' + '─'.repeat(46));
vm.runInContext(source, context);
const result = JSON.parse(vm.runInContext(`JSON.stringify({
  state,
  allKeys: DATA.checklists.flatMap(cl => cl.eras.flatMap(e => e.items.flatMap(it =>
    it.slots.map((sl, si) => keyFor(cl.id, it, si))))),
  requiredKeys: DATA.checklists.flatMap(cl => cl.eras.flatMap(e => e.items.flatMap(it =>
    it.slots.flatMap((sl, si) => slotRequired(sl) ? [keyFor(cl.id, it,si)] : [])))),
  productImages: DATA.checklists.flatMap(cl => cl.eras.flatMap(e => e.items.flatMap(it =>
    (it.images||[]).map(image => ({checklist:cl.id, ...image}))))),
  firstKey: keyFor(DATA.checklists[0].id, DATA.checklists[0].eras[0].items[0], 0)
})`, context));

const activeKeys = Object.keys(result.state.checks);
ok(activeKeys.length === 3, 'maps every known legacy check to one active v2 key');
ok(activeKeys.every(k => /^[^|]+\|v2\|[0-9a-f]{16}$/.test(k)), 'emits canonical checklist|v2|fingerprint keys');
ok(Object.keys(result.state.legacyChecksV1).length === 4, 'retains known and unknown legacy keys as recovery data');
ok(result.state.keyMigration.migrated === 3 && result.state.keyMigration.unknown === 1,
  'records migration and unknown-key counts');
ok(result.allKeys.length === 928 && new Set(result.allKeys).size === 928,
  'all 928 required and bonus inventory keys are unique');
ok(result.requiredKeys.length === 888 && new Set(result.requiredKeys).size === 888,
  'keeps the collection goal at 888 required targets');
ok(result.productImages.length === 33 &&
   result.productImages.every(image => /^(MTG Wiki|TCGplayer)$/.test(image.source)),
  'embeds only the 33 trusted sealed-product image mappings');
ok(result.productImages.every(image => !image.url.includes('cards.scryfall.io/art_crop')),
  'never presents fallback card art as a sealed-product image');

const productAudit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const boxes=DATA.checklists.find(cl=>cl.id==='boxes');
  const packs=DATA.checklists.find(cl=>cl.id==='packs');
  const boxItems=boxes.eras.flatMap(e=>e.items),packItems=packs.eras.flatMap(e=>e.items);
  const boxRows=name=>boxItems.filter(it=>it.name===name);
  const boxType=name=>boxRows(name).find(it=>it.slots.some(slotRequired))?.tags[0]?.t;
  const boxGroups=name=>boxRows(name).flatMap(it=>it.slots.map(s=>s.g));
  const packGroups=name=>packItems.find(it=>it.name===name)?.slots.map(s=>s.g)||[];
  return {
    clb:boxType("Commander Legends: Baldur's Gate"),
    cmm:boxType('Commander Masters'),
    aftermath:boxType('March of the Machine: Aftermath'),
    mysteries:boxItems.filter(it=>it.name.startsWith('Mystery Booster')).map(it=>it.name),
    themeStart:boxGroups('Guilds of Ravnica'),
    themeEnd:boxGroups('Streets of New Capenna'),
    dmu:boxGroups('Dominaria United'),
    ltr:boxGroups('LotR: Tales of Middle-earth'),
    lci:boxGroups('The Lost Caverns of Ixalan'),
    eraNames:boxes.eras.map(e=>e.name),
    maxEraColumns:Math.max(...boxes.eras.map(e=>new Set(e.items.flatMap(it=>it.slots.map(s=>s.g))).size)),
    bonusOnlyTotals:boxes.eras.filter(e=>e.name.startsWith('Bonus ')).map(e=>
      e.items.flatMap(it=>it.slots).filter(slotRequired).length),
    clbPacks:packGroups("Commander Legends: Baldur's Gate"),
    cmmPacks:packGroups('Commander Masters'),
    rvrPacks:packGroups('Ravnica Remastered'),
    aftermathPacks:packGroups('March of the Machine: Aftermath'),
    acrPacks:packGroups("Assassin's Creed"),
    mysteryPacks:packGroups('Mystery Booster 2')
  };
})())`, context));
ok(productAudit.clb === 'Set' && productAudit.cmm === 'Set',
  'tracks CLB and Commander Masters Set Booster displays');
ok(productAudit.aftermath === 'Epilogue',
  'tracks March of the Machine: Aftermath as an Epilogue display');
ok(productAudit.mysteries.length === 4,
  'tracks all four distinct Mystery Booster displays');
ok(productAudit.themeStart.includes('Theme') && productAudit.themeEnd.includes('Theme'),
  'tracks the complete Guilds of Ravnica through New Capenna Theme-display run');
ok(JSON.stringify(productAudit.dmu) === JSON.stringify(['Set','Draft','Jumpstart']) &&
   JSON.stringify(productAudit.ltr) === JSON.stringify(['Set','Draft','Jumpstart','JS Vol. 2']),
  'tracks set-attached Jumpstart displays and the second Lord of the Rings volume');
ok(JSON.stringify(productAudit.lci) === JSON.stringify(['Set','Draft']),
  'tracks the optional Draft display through the final Set-Booster release');
ok(productAudit.maxEraColumns === 2 &&
   ['Bonus Theme Booster Displays — 2018–2022',
    'Bonus Set-Attached Jumpstart Displays — 2022–2023',
    'Bonus Jumpstart Vol. 2 Display — 2023',
    'Epilogue Booster Display — 2023',
    'Beyond Booster Display — 2024',
    'Draft Holdover — Ravnica Remastered (2024)'].every(n=>productAudit.eraNames.includes(n)),
  'moves sparse product types into focused sections and caps every era at two columns');
ok(productAudit.bonusOnlyTotals.length === 3 && productAudit.bonusOnlyTotals.every(n=>n===0),
  'marks all three specialty inventory sections as bonus-only');
ok(productAudit.clbPacks.includes('Set') && productAudit.cmmPacks.includes('Set'),
  'includes the corresponding CLB and Commander Masters Set Booster packs');
ok(productAudit.rvrPacks.includes('Draft') && productAudit.aftermathPacks.includes('Epilogue') &&
   productAudit.acrPacks.includes('Beyond') && productAudit.mysteryPacks.includes('Mystery'),
  'uses truthful special pack-type labels instead of the surrounding era label');

const bonus = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='boxes');
  const rows=cl.eras.flatMap(e=>e.items).filter(x=>x.name==='Zendikar Rising');
  const item=rows.find(x=>x.slots.some(s=>s.g==='Set'));
  const themeItem=rows.find(x=>x.slots.some(s=>s.g==='Theme'));
  const groups=groupedSlots(item),draft=groups.find(g=>g.n==='Draft'),goal=groups.find(g=>g.n==='Set');
  const theme=groupedSlots(themeItem)[0],requiredIndex=item.slots.findIndex(slotRequired);
  const expectedRequired=cl.id+'|v2|'+contentHash([normKeyPart(cl.id),normKeyPart(item.name),
    normKeyPart(item.code),'box',0].join('\\u001f'));
  const before=clProgress(cl); changeQuantity(cl.id,item,draft,1); changeQuantity(cl.id,themeItem,theme,1);
  const afterBonus=clProgress(cl);
  const completeWithBonus=itemComplete(cl.id,item); changeQuantity(cl.id,item,goal,1); const afterGoal=clProgress(cl);
  return {draftTarget:groupTarget(draft),goalTarget:groupTarget(goal),before,afterBonus,afterGoal,
    completeWithBonus,completeWithGoal:itemComplete(cl.id,item),
    bonusOnlyComplete:itemComplete(cl.id,themeItem),
    keyPreserved:keyFor(cl.id,item,requiredIndex)===expectedRequired,
    legacyPinned:LEGACY_KEYS['boxes|7|5|0']===keyFor(cl.id,item,requiredIndex)};
})())`, context));
ok(bonus.draftTarget === 0 && bonus.goalTarget === 1 &&
   bonus.before.done === bonus.afterBonus.done && bonus.before.total === bonus.afterBonus.total,
  'bonus quantities do not change required progress');
ok(!bonus.completeWithBonus && bonus.completeWithGoal && bonus.afterGoal.done === bonus.before.done + 1,
  'only the starred goal type completes a booster-box row');
ok(!bonus.bonusOnlyComplete,
  'bonus-only rows never become completed or disappear under Hide completed');
ok(bonus.keyPreserved,
  'preserves every existing required box content key while adding type columns');
ok(bonus.legacyPinned,
  'preserves the original positional migration key after moving a box row');

const stable = vm.runInContext(`(() => {
  const cl=DATA.checklists[0], item=cl.eras[0].items[0], before=keyFor(cl.id,item,0);
  cl.eras.reverse(); cl.eras[0].items.reverse();
  return before===keyFor(cl.id,item,0);
})()`, context);
ok(stable, 'key survives era and item reordering');
ok(JSON.parse(store.get('mtgBinder_v1')).keyVersion === 2, 'persists the migrated state immediately');

const quantity = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='lorcana');
  const item=cl.eras[0].items[0], groups=groupedSlots(item), group=groups[0];
  const before=ownedForGroup(cl.id,item,group);
  state.ui.hideDone=true;
  changeQuantity(cl.id,item,group,1);
  const atTarget={owned:ownedForGroup(cl.id,item,group),complete:itemComplete(cl.id,item),
    lingering:isCompletionLingering(cl.id,item)};
  changeQuantity(cl.id,item,group,1);
  const aboveTarget={owned:ownedForGroup(cl.id,item,group),extra:state.extras[groupKeyFor(cl.id,item,group.n)],
    lingering:isCompletionLingering(cl.id,item)};
  changeQuantity(cl.id,item,group,-1);
  const afterExtraRemoval=ownedForGroup(cl.id,item,group);
  changeQuantity(cl.id,item,group,-1);
  return {name:group.n,target:group.items.length,before,atTarget,aboveTarget,afterExtraRemoval,
    restored:ownedForGroup(cl.id,item,group),lingeringAfterBelow:isCompletionLingering(cl.id,item)};
})())`, context));
ok(quantity.name === 'Copies' && quantity.target === 2,
  'merges Lorcana kid slots into one two-copy quantity target');
ok(quantity.before === 1 && quantity.atTarget.owned === 2 && quantity.atTarget.complete,
  'increments the visible quantity to its completion target');
ok(quantity.aboveTarget.owned === 3 && quantity.aboveTarget.extra === 1,
  'stores owned quantities above the checklist target');
ok(quantity.afterExtraRemoval === 2 && quantity.restored === 1,
  'decrements extras first and preserves the underlying checked slots');
ok(quantity.atTarget.lingering && quantity.aboveTarget.lingering && !quantity.lingeringAfterBelow,
  'keeps a newly completed row visible while adjusting and cancels below target');

console.log('─'.repeat(46));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
