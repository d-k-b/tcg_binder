'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildPackArtGoalAudit } = require('../lib/pack-art-goal');
const root = path.resolve(__dirname, '../..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
const catalog = read('binder_data.json');
const artworkCatalog = read('booster_wrapper_art_catalog.json');
const policy = read('mtg_pack_art_goal.json');
const before = JSON.stringify({ catalog, artworkCatalog });
const quantities = Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['M12-' + (i + 1), 1]));
const audit = buildPackArtGoalAudit({ catalog, artworkCatalog, policy, confirmedArtQuantities: quantities });
const m12 = audit.requirements.find(row => row.product.productId === 'mtg:m12:magic-2012:booster:pack:en');
assert.equal(m12.target, 10);
assert.equal(m12.complete, false);
assert.equal(m12.ownershipStatus, 'front-quantities-confirmed');
assert.equal(m12.artworks.reduce((n, art) => n + art.missingBeforeIncomingReview, 0), 5);
assert.equal(audit.requirements.find(row => row.product.setCode === 'MH3').artCount, null,
  'unknown count must not silently become one front');
assert(audit.requirements.filter(row => row.product.productType === 'collector_booster')
  .every(row => row.artCount === null), 'legacy regular-pack art must not credit Collector packs');
assert(audit.requirements.filter(row => row.product.variant)
  .every(row => row.artCount === null), 'faction/VIP/special identities cannot inherit regular art');
assert(audit.requirements.some(row => row.product.productId ===
  'mtg:dmu:dominaria-united:jumpstart-booster:pack:en'));
assert(audit.requirements.some(row => row.product.productId ===
  'mtg:bro:the-brothers-war:jumpstart-booster:pack:en'));
assert(audit.missingPackTypeCandidates.every(row => row.owned === null && !row.recommendationAuthority));
assert.equal(audit.unmappedArtworkIds.length,0,'new exact regular pack rows retain all legacy artwork IDs');
assert.equal(JSON.stringify({ catalog, artworkCatalog }), before, 'audit must not mutate ownership/catalogs');
const over = buildPackArtGoalAudit({ catalog, artworkCatalog, policy,
  confirmedArtQuantities: { ...quantities, 'M12-1': 9 } }).requirements.find(row => row.product.setCode === 'M12');
assert.equal(over.complete, false, 'nine of one front cannot satisfy a second copy of other fronts');
assert.equal(over.artworks[0].owned, 9);
assert.equal(over.artworks[0].creditedOwned, 2);
assert.throws(() => buildPackArtGoalAudit({ catalog, artworkCatalog, policy: { ...policy, copiesPerArtwork: 1 } }), /Unsupported/);
assert.throws(() => buildPackArtGoalAudit({ catalog, artworkCatalog, policy, confirmedArtQuantities: { 'M12-1': -1 } }), /Invalid/);
console.log('Pack-art goal tests passed: two per front, type isolation, partial/unknown inventory, specialty intake, no mutation.');

const {buildPackArtRequirements}=require('../lib/pack-art-goal');
const state=require('../lib/collection-state');
const index=state.createCatalog(catalog),entry=index.byId.get(m12.product.productId);
let inventory=state.setQuantities({},entry,{owned:12,ordered:1});
let goals=buildPackArtRequirements(catalog,inventory);
assert.equal(goals.products[entry.ref.productId].complete,false,'aggregate copies never prove fronts');
assert.equal(goals.products[entry.ref.productId].artworks[0].owned,null,'absent is unknown');
inventory=state.setArtworkQuantities(inventory,entry,{artworkId:'M12-1',owned:0});
assert.equal(state.describe(inventory,entry).packArtRequirement.artworks[0].owned,0,'explicit zero review persists');
assert.equal(state.describe(inventory,entry).owned,12,'art review never duplicates physical stock');
assert.throws(()=>state.setArtworkQuantities(inventory,entry,{artworkId:'AVR-1',owned:1}),/Unknown exact/);
for(let i=1;i<=5;i++)inventory=state.setArtworkQuantities(inventory,entry,{artworkId:'M12-'+i,owned:1,ordered:1});
const view=state.describe(inventory,entry).packArtRequirement;
assert.equal(view.covered,true);
assert.equal(view.complete,false,'incoming fronts are not physically owned');
assert.equal(view.creditedOwned,5);
assert.equal(view.confirmedMissing,0);
console.log('Pack-art core tests passed: reviewed zero, unknown fronts, incoming/physical separation and exact artwork identity.');
