'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {buildSnapshot,EXPECTED_LANES}=require('../lib/collection-snapshot');
const {CollectionAuthority}=require('../lib/collection-authority');
const state=require('../lib/collection-state');
const legacyContracts=require('../../browser-extension/vendor/tcg-comps-2.42.0/pricing-contracts');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/binder_data.json')));
const entry=state.createCatalog(catalog).products.find(row=>row.ref.setCode==='M12'&&row.ref.unit==='pack');
const now=Date.parse('2026-11-03T20:00:00Z');
let packs=state.setQuantities({},entry,{owned:12,ordered:1});
for(let i=1;i<=5;i++)packs=state.setArtworkQuantities(packs,entry,{artworkId:'M12-'+i,owned:1});
const records=EXPECTED_LANES.map(lane=>({lane,stateRevision:lane+'-revision',
  payload:{...(lane==='packs'?packs:state.emptyState()),updatedAt:new Date(now).toISOString()}}));
const first=buildSnapshot(catalog,records,{nowMs:now});
const physical=first.snapshot.products[entry.ref.productId];
assert.deepStrictEqual([physical.owned,physical.ordered,physical.missing],[12,1,0]);
const art=first.snapshot.packArtRequirements.products[entry.ref.productId];
assert.deepStrictEqual([art.target,art.creditedOwned,art.confirmedMissing,art.complete],[10,5,5,false]);
assert.equal(Object.keys(first.snapshot.products).length,719);
assert.equal(first.snapshot.packArtRequirements.summary.productCount,276);
assert.equal(first.snapshot.packArtRequirements.summary.knownArtworkTargets,756);
const second=buildSnapshot(catalog,records.map(row=>row.lane!=='packs'?row:{...row,payload:{...row.payload,
  wrapperArts:{...row.payload.wrapperArts,'packs|wrapper-art|M12-1':2}}}),{nowMs:now});
assert.notEqual(first.revision,second.revision,'exact front changes participate in Authority revision');
assert.deepStrictEqual(first.snapshot.products,second.snapshot.products,'front credit never changes physical counts');
let calls=0;
const store={configured:()=>true,readAll:async()=>records};
const monitorClient={syncCollection:async request=>{calls++;return {accepted:true,revision:request.revision,productCount:719,activeTargetCount:0};}};
async function run(){
  const authority=new CollectionAuthority({catalog,store,monitorClient,pricingContracts:legacyContracts,
    now:()=>now,dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'tcg-art-authority-test-'))});
  await assert.rejects(authority.monitorSync({schema:'tcg.collection-monitor-sync-request/v1',preferences:{}}),
    error=>error.code==='MONITOR_PACK_ART_UNSUPPORTED');
  assert.equal(calls,0,'a stripping validator must not replace the durable monitor subscription');
  const compatible={...legacyContracts,validateMonitorSubscription(input){
    const checked=legacyContracts.validateMonitorSubscription(input);
    if(checked.ok)checked.value.collection.packArtRequirements=JSON.parse(JSON.stringify(input.collection.packArtRequirements));
    return checked;
  }};
  authority.pricingContracts=compatible;
  const result=await authority.monitorSync({schema:'tcg.collection-monitor-sync-request/v1',preferences:{}});
  assert.equal(result.accepted,true);assert.equal(calls,1);
  console.log('Pack-art Authority tests passed: 719 exact products, separate artwork deficits, revision changes, fail-closed monitor compatibility.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
