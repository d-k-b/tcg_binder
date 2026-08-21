#!/usr/bin/env node
/** Exercises the exact migration/key code embedded in the generated dashboard. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pricingContracts = require('../../browser-extension/vendor/tcg-comps-2.42.0/pricing-contracts.js');

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
    'prerelease|0|7|0': true,
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
  pricingProducts: DATA.checklists.flatMap(cl => cl.eras.flatMap(e => e.items.flatMap(it =>
    (it.pricingProducts||[]).map(product => ({checklist:cl.id,item:it.name,...product}))))),
  wrapperArtSets: WRAPPER_ART_CATALOG.sets,
  wrapperMappedCodes: DATA.checklists.find(cl=>cl.id==='packs').eras.flatMap(e=>e.items).map(it=>it.code),
  firstKey: keyFor(DATA.checklists[0].id, DATA.checklists[0].eras[0].items[0], 0)
})`, context));

const activeKeys = Object.keys(result.state.checks);
ok(activeKeys.length === 4, 'maps every known legacy check to one active v2 key');
ok(activeKeys.every(k => /^[^|]+\|v2\|[0-9a-f]{16}$/.test(k)), 'emits canonical checklist|v2|fingerprint keys');
ok(Object.keys(result.state.legacyChecksV1).length === 5, 'retains known and unknown legacy keys as recovery data');
ok(result.state.keyMigration.migrated === 4 && result.state.keyMigration.unknown === 1,
  'records migration and unknown-key counts');
ok(JSON.stringify(result.state.monitorPreferences) === JSON.stringify({
  enabled:true,maxMarketRatio:.8,minimumConfidence:'medium',
  sources:['ebay','tcgplayer','heritage','store'],includeOptional:false,instantFixedPriceEmail:true,
  dailyDigest:{enabled:true,time:'07:00',timezone:'America/Chicago'}
}) && result.state.monitorPreferencesUpdatedAt === null,
  'migrates older saved state to the exact non-secret monitoring defaults');
ok(result.allKeys.length === 950 && new Set(result.allKeys).size === 950,
  'all 950 required and bonus inventory keys are unique');
ok(result.requiredKeys.length === 910 && new Set(result.requiredKeys).size === 910,
  'keeps the collection goal at 910 required targets');
ok(Object.keys(result.state.wrapperArts).length === 0,
  'loads older saved state into an empty, separate wrapper-art namespace');
ok(Object.keys(result.state.ordered).length === 0 && Object.keys(result.state.orderedWrapperArts).length === 0,
  'loads older saved state with empty, separate incoming-quantity namespaces');
ok(result.wrapperArtSets.length === 96 && result.wrapperArtSets.reduce((n, set) => n + set.artworks.length, 0) === 378,
  'embeds the reviewed 96-set / 378-front wrapper-art catalog');
ok(result.wrapperArtSets.every(set => result.wrapperMappedCodes.includes(set.setCode)),
  'exposes every catalog set in a matching Packs row, including three wrapper-only rows');
ok(result.productImages.length === 33 &&
   result.productImages.every(image => /^(MTG Wiki|TCGplayer)$/.test(image.source)),
  'embeds only the 33 trusted sealed-product image mappings');
ok(result.productImages.every(image => !image.url.includes('cards.scryfall.io/art_crop')),
  'never presents fallback card art as a sealed-product image');
const pricingIds = result.pricingProducts.map(product => product.ref.productId);
ok(result.pricingProducts.length === 686 && new Set(pricingIds).size === 686,
  'generates one unique ProductRef identity for each of the 686 actual products and groups');
ok(result.pricingProducts.every(product => pricingContracts.validateProductRef(product.ref).ok),
  'validates every generated identity against the vendored ProductRef v1 contract');
ok(result.pricingProducts.filter(product => product.checklist === 'prerelease').length === 148 &&
   result.pricingProducts.filter(product => product.checklist === 'prerelease')
     .every(product => Number.isInteger(product.slotOrdinal)),
  'prices every distinct prerelease variant by its own exact ProductRef');
ok(result.pricingProducts.some(product => product.ref.unit === 'pack') &&
   result.pricingProducts.some(product => product.ref.unit === 'display') &&
   result.pricingProducts.some(product => product.ref.unit === 'kit'),
  'keeps packs, displays, and kits distinct in pricing identities');

const wrapperArtAudit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const packs=DATA.checklists.find(x=>x.id==='packs');
  const collector=DATA.checklists.find(x=>x.id==='collector');
  const item=packs.eras.flatMap(e=>e.items).find(it=>it.code==='4ED');
  const regular2xm=packs.eras.flatMap(e=>e.items).find(it=>it.name==='Double Masters');
  const vip2xm=packs.eras.flatMap(e=>e.items).find(it=>it.name==='Double Masters VIP Edition');
  const wrapperSet=wrapperArtSetFor(packs.id,item),key=wrapperArtKey(wrapperSet.artworks[0].id);
  const progressBefore=clProgress(packs);
  state.wrapperArts[key]=3;save();
  const persisted=JSON.parse(localStorage.getItem(KEY));
  const restored=migrateState(JSON.parse(JSON.stringify(persisted)));
  const progressAfter=clProgress(packs);
  return {key,owned:restored.wrapperArts[key],count:wrapperSet.artworks.filter(art=>restored.wrapperArts[wrapperArtKey(art.id)]).length,
    packMatch:wrapperSet.setCode,collectorMatch:wrapperArtSetFor(collector.id,item),
    regular2xm:wrapperArtSetFor(packs.id,regular2xm)&&wrapperArtSetFor(packs.id,regular2xm).setCode,
    vip2xm:wrapperArtSetFor(packs.id,vip2xm),
    progressBefore,progressAfter};
})())`, context));
ok(wrapperArtAudit.key === 'packs|wrapper-art|4ED-1' && wrapperArtAudit.owned === 3 && wrapperArtAudit.count === 1,
  'persists wrapper quantities under the stable packs|wrapper-art|SET-N namespace');
ok(wrapperArtAudit.packMatch === '4ED' && wrapperArtAudit.collectorMatch === null,
  'attaches wrapper art only to its matching Packs row, never another checklist');
ok(wrapperArtAudit.regular2xm === '2XM' && wrapperArtAudit.vip2xm === null,
  'attaches 2XM art to the regular Draft row but not the same-code VIP row');
ok(JSON.stringify(wrapperArtAudit.progressBefore) === JSON.stringify(wrapperArtAudit.progressAfter),
  'keeps wrapper-art ownership outside required pack and overall completion');

const monitorPreferencesAudit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const normalized=normalizeMonitorPreferences({enabled:false,maxMarketRatio:.75,minimumConfidence:'high',
    sources:['store','ebay','unknown'],includeOptional:true,instantFixedPriceEmail:false,
    dailyDigest:{enabled:false,time:'08:15',timezone:'America/Chicago'}});
  state.monitorPreferences=normalized;
  state.monitorPreferencesUpdatedAt='2026-08-09T12:34:56.000Z';
  const fields=monitorGistFields();
  const payload=JSON.parse(JSON.stringify(Object.assign({checklist:'collector',checks:{},extras:{}},fields)));
  const restored=monitorPreferenceEnvelope(payload);
  const legacy=monitorPreferenceEnvelope({checklist:'collector',checks:{},extras:{}});
  const invalid=normalizeMonitorPreferences({maxMarketRatio:4,minimumConfidence:'certain',sources:[],
    dailyDigest:{time:'28:99',timezone:'not-a-zone'}});
  return {normalized,fields,restored,legacy,invalid,
    snapshot:JSON.parse(monitorGistSnapshot('collector',{}, {},fields)),
    nonCanonical:JSON.parse(monitorGistSnapshot('packs',{}, {},fields))};
})())`, context));
ok(JSON.stringify(monitorPreferencesAudit.normalized.sources) === JSON.stringify(['ebay','store']) &&
   monitorPreferencesAudit.normalized.maxMarketRatio === .75 && monitorPreferencesAudit.normalized.minimumConfidence === 'high',
  'normalizes monitoring preferences into canonical source order without unknown sources');
ok(JSON.stringify(monitorPreferencesAudit.restored.preferences) === JSON.stringify(monitorPreferencesAudit.normalized) &&
   monitorPreferencesAudit.restored.updatedAt === '2026-08-09T12:34:56.000Z' && monitorPreferencesAudit.legacy === null,
  'round-trips non-secret monitoring preferences through the canonical Gist payload fields');
ok(JSON.stringify(monitorPreferencesAudit.snapshot.monitorPreferences) === JSON.stringify(monitorPreferencesAudit.normalized) &&
   !Object.prototype.hasOwnProperty.call(monitorPreferencesAudit.nonCanonical,'monitorPreferences'),
  'stores global monitoring preferences only in the canonical collector Gist');
ok(monitorPreferencesAudit.invalid.maxMarketRatio === .8 && monitorPreferencesAudit.invalid.minimumConfidence === 'medium' &&
   JSON.stringify(monitorPreferencesAudit.invalid.sources) === JSON.stringify(['ebay','tcgplayer','heritage','store']) &&
   monitorPreferencesAudit.invalid.dailyDigest.time === '07:00' && monitorPreferencesAudit.invalid.dailyDigest.timezone === 'America/Chicago',
  'falls back safely when imported or legacy monitoring preference values are invalid');

const prereleaseAudit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='prerelease');
  const items=cl.eras.flatMap(e=>e.items),byName=name=>items.find(it=>it.name===name);
  const names=name=>byName(name).variants;
  const added=['Mirrodin Besieged','Modern Horizons 2',"Commander Legends: Battle for Baldur's Gate",'Modern Horizons 3'];
  const m15=byName('Magic 2015');
  return {mode:cl.progressMode,rows:items.length,total:clProgress(cl).total,
    m15:names('Magic 2015'),dtk:names('Dragons of Tarkir'),bro:names("The Brothers' War"),
    tdm:names('Tarkir: Dragonstorm'),atl:names('Avatar: The Last Airbender'),
    mbs:names('Mirrodin Besieged'),mh2:names('Modern Horizons 2'),
    clb:names("Commander Legends: Battle for Baldur's Gate"),mh3:names('Modern Horizons 3'),
    firstLegacy:LEGACY_KEYS['prerelease|0|7|0']===keyFor(cl.id,m15,0),
    expandedSlotsUnmapped:[m15,byName('Dragons of Tarkir'),byName("The Brothers' War"),
      byName('Tarkir: Dragonstorm'),byName('Avatar: The Last Airbender')]
      .every(it=>it.slots.slice(1).every(sl=>Object.prototype.hasOwnProperty.call(sl,'legacy')&&sl.legacy===null)),
    addedRowsUnmapped:added.every(name=>byName(name).slots.every(sl=>sl.legacy===null))};
})())`, context));
ok(prereleaseAudit.mode === 'distinct_variants' && prereleaseAudit.rows === 69 && prereleaseAudit.total === 148,
  'models 148 distinct prerelease variants across 69 product rows');
ok(JSON.stringify(prereleaseAudit.m15) === JSON.stringify(['Hunt with Valor','Hunt with Guile','Hunt with Ambition','Hunt with Ferocity','Hunt with Strength']) &&
   JSON.stringify(prereleaseAudit.dtk) === JSON.stringify(['Dromoka','Ojutai','Silumgar','Kolaghan','Atarka']) &&
   JSON.stringify(prereleaseAudit.bro) === JSON.stringify(["Mishra's Burnished Banner","Urza's Iron Alliance"]),
  'stores the corrected Magic 2015, Dragons of Tarkir, and Brothers War names');
ok(JSON.stringify(prereleaseAudit.tdm) === JSON.stringify(['Abzan','Jeskai','Sultai','Mardu','Temur']) &&
   JSON.stringify(prereleaseAudit.atl) === JSON.stringify(['Aang','Azula','Katara','Toph','Zuko']),
  'stores the five Tarkir Dragonstorm clans and five Avatar characters');
ok(JSON.stringify(prereleaseAudit.mbs) === JSON.stringify(['Mirran Faction Pack','Phyrexian Faction Pack']) &&
   prereleaseAudit.mh2.length === 1 && prereleaseAudit.clb.length === 1 && prereleaseAudit.mh3.length === 1,
  'adds the verified Mirrodin Besieged, MH2, CLB, and MH3 sealed products');
ok(prereleaseAudit.firstLegacy && prereleaseAudit.expandedSlotsUnmapped && prereleaseAudit.addedRowsUnmapped,
  'maps each old one-slot row only to its first named variant and never maps new slots');

const productAudit = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const boxes=DATA.checklists.find(cl=>cl.id==='boxes');
  const packs=DATA.checklists.find(cl=>cl.id==='packs');
  const boxItems=boxes.eras.flatMap(e=>e.items),packItems=packs.eras.flatMap(e=>e.items);
  const boxRows=name=>boxItems.filter(it=>it.name===name);
  const boxType=name=>boxRows(name).find(it=>it.slots.some(slotRequired))?.tags[0]?.t;
  const boxGroups=name=>boxRows(name).flatMap(it=>it.slots.map(s=>s.g));
  const packGroups=name=>packItems.find(it=>it.name===name)?.slots.map(s=>s.g)||[];
  const packVariants=name=>packItems.find(it=>it.name===name)?.variants||[];
  return {
    packMode:packs.progressMode,
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
    mysteryPacks:packGroups('Mystery Booster 2'),
    znrVariants:packVariants('Zendikar Rising'),
    explicitPackLabels:packItems.every(it=>it.slots.every(slot=>/ Pack copy [12]$/.test(slot.l)))
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
ok(productAudit.packMode === 'group_variants' &&
   JSON.stringify(productAudit.znrVariants) === JSON.stringify([
     {name:'Draft Booster Pack',group:'Draft',target:2},
     {name:'Set Booster Pack',group:'Set',target:2},
     {name:'Collector Booster Pack',group:'Collector',target:2}]) && productAudit.explicitPackLabels,
  'names every booster pack type and exposes multi-type rows as variants');

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

const variants = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='prerelease');
  const items=cl.eras.flatMap(e=>e.items),m15=items.find(it=>it.name==='Magic 2015');
  const mh2=items.find(it=>it.name==='Modern Horizons 2');
  const group=groupedSlots(m15)[0],single=groupedSlots(mh2)[0];
  group.items.forEach(({si})=>delete state.checks[keyFor(cl.id,m15,si)]);
  single.items.forEach(({si})=>delete state.checks[keyFor(cl.id,mh2,si)]);
  group.items.forEach(({si})=>delete state.extras[slotExtraKeyFor(cl.id,m15,si)]);
  single.items.forEach(({si})=>delete state.extras[slotExtraKeyFor(cl.id,mh2,si)]);
  changeQuantity(cl.id,m15,group,1);changeQuantity(cl.id,m15,group,1);
  const firstTwo=group.items.map(({si})=>isChecked(keyFor(cl.id,m15,si)));
  changeQuantity(cl.id,m15,group,1);changeQuantity(cl.id,m15,group,1);
  changeQuantity(cl.id,m15,group,1);changeQuantity(cl.id,m15,group,1);
  const aboveTarget={owned:ownedForGroup(cl.id,m15,group),quantities:group.items.map(({si})=>slotQuantity(cl.id,m15,si)),
    complete:itemComplete(cl.id,m15),extra:state.extras[slotExtraKeyFor(cl.id,m15,0)]||0};
  changeQuantity(cl.id,m15,group,-1);
  const afterMinus=group.items.map(({si})=>slotQuantity(cl.id,m15,si));
  changeSlotQuantity(cl.id,m15,2,1);changeSlotQuantity(cl.id,m15,2,1);
  changeSlotQuantity(cl.id,m15,4,-1);
  const duplicateMissing={owned:ownedForGroup(cl.id,m15,group),complete:itemComplete(cl.id,m15),
    completed:group.items.filter(({si})=>slotQuantity(cl.id,m15,si)>=1).length};
  changeQuantity(cl.id,m15,group,1);
  const refilled={owned:ownedForGroup(cl.id,m15,group),complete:itemComplete(cl.id,m15)};
  changeQuantity(cl.id,m15,group,-1);
  const afterExtraRemoval={owned:ownedForGroup(cl.id,m15,group),complete:itemComplete(cl.id,m15),
    quantities:group.items.map(({si})=>slotQuantity(cl.id,m15,si))};
  changeQuantity(cl.id,mh2,single,1);changeQuantity(cl.id,mh2,single,1);
  return {firstTwo,aboveTarget,afterMinus,duplicateMissing,refilled,afterExtraRemoval,
    single:ownedForGroup(cl.id,mh2,single),directDrawerOpen:openDetails.has(detailKey(cl.id,m15)),
    stableExtraKey:/^prerelease\\|slot-extra\\|[0-9a-f]{16}$/.test(slotExtraKeyFor(cl.id,m15,0))};
})())`, context));
ok(JSON.stringify(variants.firstTwo) === JSON.stringify([true,true,false,false,false]),
  'aggregate plus fills named variant slots in deterministic listed order');
ok(variants.aboveTarget.owned === 6 && variants.aboveTarget.complete && variants.aboveTarget.extra === 1 &&
   JSON.stringify(variants.aboveTarget.quantities) === JSON.stringify([2,1,1,1,1]) && variants.stableExtraKey,
  'stores duplicate prerelease copies against their stable named variant');
ok(JSON.stringify(variants.afterMinus) === JSON.stringify([1,1,1,1,1]),
  'aggregate minus removes a duplicate before clearing a required variant');
ok(variants.duplicateMissing.owned === 6 && !variants.duplicateMissing.complete && variants.duplicateMissing.completed === 4,
  'does not let duplicate copies substitute for a missing required variant');
ok(variants.refilled.owned === 7 && variants.refilled.complete && variants.afterExtraRemoval.owned === 6 &&
   variants.afterExtraRemoval.complete && JSON.stringify(variants.afterExtraRemoval.quantities) === JSON.stringify([1,1,2,1,1]),
  'aggregate controls refill missing variants first and then adjust duplicate copies deterministically');
ok(variants.single === 2 && variants.directDrawerOpen,
  'keeps single-variant products compact while allowing their total quantity above one');

const packVariantQuantities = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='packs');
  const item=cl.eras.flatMap(e=>e.items).find(it=>it.name==='Zendikar Rising');
  const groups=groupedSlots(item),draft=groups.find(g=>g.n==='Draft'),set=groups.find(g=>g.n==='Set'),collector=groups.find(g=>g.n==='Collector');
  groups.forEach(g=>{g.items.forEach(({si})=>delete state.checks[keyFor(cl.id,item,si)]);delete state.extras[groupKeyFor(cl.id,item,g.k||g.n)];});
  changeQuantity(cl.id,item,draft,1);changeQuantity(cl.id,item,draft,1);changeQuantity(cl.id,item,draft,1);
  changeQuantity(cl.id,item,set,1);changeQuantity(cl.id,item,set,1);changeQuantity(cl.id,item,collector,1);
  const missing={owned:groups.map(g=>ownedForGroup(cl.id,item,g)),total:groups.reduce((n,g)=>n+ownedForGroup(cl.id,item,g),0),complete:itemComplete(cl.id,item)};
  changeQuantity(cl.id,item,collector,1);
  return {missing,complete:itemComplete(cl.id,item),owned:groups.map(g=>ownedForGroup(cl.id,item,g))};
})())`, context));
ok(JSON.stringify(packVariantQuantities.missing.owned) === JSON.stringify([3,2,1]) &&
   packVariantQuantities.missing.total === 6 && !packVariantQuantities.missing.complete &&
   packVariantQuantities.complete && JSON.stringify(packVariantQuantities.owned) === JSON.stringify([3,2,2]),
  'tracks named booster pack type quantities independently and completes each type at two');

const focusEvents = [];
context.document = {
  documentElement: { dataset: {} },
  querySelector: selector => ({
    querySelector: child => ({
      disabled: false,
      focus: options => focusEvents.push({selector, child, preventScroll:!!(options&&options.preventScroll)}),
    }),
  }),
};
const repeated = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const cl=DATA.checklists.find(x=>x.id==='lorcana');
  const item=cl.eras[0].items[0],group=groupedSlots(item)[0];
  const before=ownedForGroup(cl.id,item,group);
  changeQuantity(cl.id,item,group,1,'plus');
  changeQuantity(cl.id,item,group,1,'plus');
  return {before,after:ownedForGroup(cl.id,item,group),key:groupKeyFor(cl.id,item,group.k||group.n)};
})())`, context));
ok(repeated.after === repeated.before + 2 && focusEvents.length === 2 &&
   focusEvents.every(event => event.child === '.qtybtn.plus' && event.preventScroll &&
     event.selector.includes(repeated.key)),
  'restores focus to the replacement plus button for repeated clicks');

console.log('─'.repeat(46));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
