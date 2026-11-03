(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.TcgPackArtGoal=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

// Read-only migration/audit model. It deliberately does NOT rewrite the legacy
// two-per-type snapshot or send this projection to a v2 monitor consumer.
function buildPackArtGoalAudit({ catalog, artworkCatalog, policy, confirmedArtQuantities = {} }) {
  if (policy?.schema !== 'tcg.pack-art-goal/v1' || policy.game !== 'mtg' ||
      policy.language !== 'en' || policy.unit !== 'pack' || policy.copiesPerArtwork !== 2) {
    throw new Error('Unsupported pack artwork goal');
  }
  if (!Array.isArray(catalog?.checklists) || !Array.isArray(artworkCatalog?.sets)) {
    throw new Error('Complete source catalogs required');
  }
  const lanes = new Map(catalog.checklists.map(lane => [lane.id, lane]));
  if (!lanes.has('packs') || !lanes.has('boxes')) throw new Error('Pack and display catalogs required');
  for (const [id, quantity] of Object.entries(confirmedArtQuantities)) {
    if (!/^[A-Z0-9][A-Z0-9-]+$/.test(id) || !Number.isInteger(quantity) || quantity < 0) {
      throw new Error('Invalid confirmed artwork quantity');
    }
  }
  const allProducts = lane => lane.eras.flatMap(era => era.items.flatMap(item =>
    (item.pricingProducts || []).map(product => ({ item, product: product.ref }))));
  const packProducts = allProducts(lanes.get('packs'));
  const byId = new Map();
  const mappedArtIds = new Set();
  const sourceSets = new Map(artworkCatalog.sets.map(set => [set.setCode, set]));
  const requirements = [];
  for (const { product } of packProducts) {
    if (product.game !== 'mtg' || product.unit !== 'pack' || product.language !== 'en') continue;
    if (byId.has(product.productId)) throw new Error('Duplicate pack ProductRef');
    byId.set(product.productId, product);
    // The legacy manifest proves regular-booster fronts only, not same-set
    // Collector/Set/VIP/faction/Jumpstart packaging. Never join just on set code.
    const regular = ['booster', 'draft_booster'].includes(product.productType) && !product.variant;
    const set = regular ? sourceSets.get(product.setCode) : null;
    const artworks = (set?.artworks || []).map(art => {
      mappedArtIds.add(art.id);
      const reviewed = Object.hasOwn(confirmedArtQuantities, art.id);
      const owned = reviewed ? confirmedArtQuantities[art.id] : null;
      return {
        artworkId: art.id, target: 2, owned, ownershipReviewed: reviewed,
        creditedOwned: reviewed ? Math.min(2, owned) : null,
        missingBeforeIncomingReview: reviewed ? Math.max(2 - owned, 0) : null,
        imageStatus: art.imageStatus,
      };
    });
    const countReview = Boolean(set?.validationNote && /verify.*physical|count.*confirm/i.test(set.validationNote));
    requirements.push({
      product, copiesPerArtwork: 2,
      artCount: set ? artworks.length : null,
      artCountStatus: !set ? 'unverified' : countReview ? 'review-required' : 'catalog-recorded',
      target: set ? artworks.length * 2 : null,
      artworks,
      ownershipStatus: artworks.length && artworks.every(art => art.ownershipReviewed)
        ? 'front-quantities-confirmed' : 'unquantified-or-partial',
      complete: Boolean(set && !countReview && artworks.length && artworks.every(art =>
        art.ownershipReviewed && art.owned >= 2)),
      recommendationAuthority: false,
    });
  }
  // A known display identifies a candidate missing pack lane, not ownership or
  // proof of exact pack pricing/variant availability. Catalog intake must verify
  // the inner sealed product before promoting these candidates.
  const missingPackTypeCandidates = allProducts(lanes.get('boxes'))
    .filter(({ product }) => product.game === 'mtg' && product.language === 'en' &&
      ['jumpstart_booster', 'theme_booster'].includes(product.productType))
    .map(({ product }) => ({
      proposedProduct: { ...product,
        productId: product.productId.replace(':display:', ':pack:'),
        productName: product.productName.replace(/ Display$/, ' Pack'), unit: 'pack' },
      sourceDisplayProductId: product.productId,
      state: 'exact-pack-catalog-intake-required',
      owned: null, artCount: null, target: null,
      recommendationAuthority: false,
    }))
    .filter(candidate => !byId.has(candidate.proposedProduct.productId));
  const unmappedArtworkIds = artworkCatalog.sets.flatMap(set => set.artworks)
    .map(art => art.id).filter(id => !mappedArtIds.has(id));
  return {
    schema: 'tcg.pack-art-goal-audit/v1', policy,
    liveSnapshotMutation: false, monitorSubscription: false,
    completeness: 'incomplete-catalog-migration',
    requirements, missingPackTypeCandidates, unmappedArtworkIds,
    summary: {
      existingPackProducts: requirements.length,
      productsWithRecordedArtCount: requirements.filter(row => row.artCount !== null).length,
      productsWithUnverifiedArtCount: requirements.filter(row => row.artCount === null).length,
      mappedFronts: mappedArtIds.size,
      knownArtworkTargets: mappedArtIds.size * 2,
      confirmedFronts: requirements.flatMap(row => row.artworks).filter(art => art.ownershipReviewed).length,
      knownShortfallBeforeIncomingReview: requirements.flatMap(row => row.artworks)
        .reduce((total, art) => total + (art.missingBeforeIncomingReview || 0), 0),
      missingPackTypeCandidates: missingPackTypeCandidates.length,
    },
  };
}

function quantity(map,key){
  const value=map&&map[key];
  if(value===true)return 1;
  return Number.isInteger(value)&&value>=0?value:null;
}

// A versioned goal projection, not a replacement physical-inventory snapshot.
// Null means unreviewed. Numeric zero means an explicit physical inventory review.
function buildPackArtRequirements(catalog,state){
  if(!catalog.packArtGoal)return null;
  const policy=catalog.packArtGoal;
  const raw=state||{};
  const confirmed={};
  for(const [key,value]of Object.entries(raw.wrapperArts||{})){
    if(!key.startsWith('packs|wrapper-art|'))continue;
    const count=quantity(raw.wrapperArts,key);
    if(count!==null)confirmed[key.slice(18)]=count;
  }
  const audit=buildPackArtGoalAudit({catalog,artworkCatalog:catalog.packArtCatalog,
    policy,confirmedArtQuantities:confirmed});
  const products={};
  for(const row of audit.requirements){
    const artworks=row.artworks.map(art=>{
      const key='packs|wrapper-art|'+art.artworkId;
      const ordered=quantity(raw.orderedWrapperArts,key)||0;
      return {artworkId:art.artworkId,target:2,owned:art.owned,ordered,
        missing:art.owned===null?null:Math.max(2-art.owned-ordered,0),
        ownershipReviewed:art.ownershipReviewed};
    });
    const reviewed=artworks.filter(art=>art.ownershipReviewed);
    products[row.product.productId]={productId:row.product.productId,
      artCount:row.artCount,artCountStatus:row.artCountStatus,target:row.target,
      artworkTarget:2,artworks,
      creditedOwned:reviewed.reduce((n,art)=>n+Math.min(2,art.owned),0),
      confirmedMissing:reviewed.reduce((n,art)=>n+art.missing,0),
      unreviewedFronts:artworks.length-reviewed.length,
      complete:row.complete,
      covered:row.artCountStatus==='catalog-recorded'&&artworks.length>0&&
        artworks.every(art=>art.ownershipReviewed&&art.missing===0),
      consumerStatus:row.artCountStatus==='catalog-recorded'&&reviewed.length===artworks.length
        ?'AUTHORITATIVE':'CONDITIONAL'};
  }
  return {schema:'tcg.pack-art-requirements/v1',copiesPerArtwork:2,
    physicalInventorySemantics:'independent-no-addition',catalogCoverage:'partial',
    products,
    summary:{productCount:Object.keys(products).length,
      knownArtworkTargets:Object.values(products).reduce((n,row)=>n+(row.target||0),0),
      creditedOwned:Object.values(products).reduce((n,row)=>n+row.creditedOwned,0),
      productsWithUnknownArtCount:Object.values(products).filter(row=>row.artCount===null).length,
      productsNeedingOwnershipReview:Object.values(products).filter(row=>row.consumerStatus==='CONDITIONAL').length}};
}

return { buildPackArtGoalAudit,buildPackArtRequirements };
});
