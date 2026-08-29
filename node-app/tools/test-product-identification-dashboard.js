#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const binder = JSON.parse(fs.readFileSync(path.join(root, 'data', 'binder_data.json'), 'utf8'));
const wrappers = JSON.parse(fs.readFileSync(path.join(root, 'data', 'booster_wrapper_art_catalog.json'), 'utf8'));
const productCount = binder.checklists.flatMap(checklist => checklist.eras.flatMap(era => era.items.flatMap(item => item.pricingProducts || []))).length;
const wrapperCount = wrappers.sets.flatMap(set => set.artworks).length;

assert.strictEqual(productCount, 688);
assert.strictEqual(wrapperCount, 378);
assert.strictEqual(productCount + wrapperCount, 1066, 'the scanner must constrain matching to every canonical product and reviewed wrapper ID');
assert.match(html, /id="identifyBtn"/, 'the dashboard toolbar must expose photo identification');
assert.match(html, /id="identifyFile"[^>]*capture="environment"/, 'mobile capture must prefer the rear camera while desktop still accepts uploads');
assert.match(html, /The result is only a suggestion; your collection changes only when you press \+ or −/);
assert.match(html, /const IDENTIFY_CHANNEL='tcg-product-identify\/v1'/);
assert.match(html, /event\.origin!==pricingConsumerOrigin\|\|event\.source!==window\.parent/,
  'identification results must require the exact extension origin and parent frame');
assert.match(html, /RECOGNITION_BY_ID\.has\(match\.candidateId\)/,
  'the dashboard must reject model candidate IDs outside its local catalog');
assert.match(html, /result\.matches\.length>3/, 'the dashboard must bound returned alternatives');
assert.match(html, /canvas\.toBlob[\s\S]*'image\/jpeg',\.86/,
  'the browser must resize and re-encode photos before sending them, stripping original metadata');
assert.match(html, /store|Gists, or exports/, 'the scanner must explain its non-persistence boundary');
assert.match(html, /https:\/\/api\.openai\.com\/v1\/responses/,
  'standalone photo identification must embed the validated OpenAI client');
assert.doesNotMatch(html, /OPENAI_API_KEY|sk-(?:proj-)?[A-Za-z0-9_-]{24,}/,
  'generated dashboard HTML must contain no environment key or real-looking credential');
assert.match(html, /minus\.onclick=\(\)=>adjustIdentifiedCandidate\(candidate,-1,'minus'\)/);
assert.match(html, /plus\.onclick=\(\)=>adjustIdentifiedCandidate\(candidate,1,'plus'\)/);

const start = html.indexOf('function normalizeWrapperArts(input)');
const end = html.indexOf('const MONITOR_DEFAULT_PREFERENCES', start);
assert.ok(start > -1 && end > start, 'wrapper quantity normalizer must be extractable');
const normalizeWrapperArts = vm.runInNewContext(html.slice(start, end) + '\nnormalizeWrapperArts;');
assert.deepStrictEqual(JSON.parse(JSON.stringify(normalizeWrapperArts({
  'packs|wrapper-art|M21-1': true,
  'packs|wrapper-art|M21-2': 4,
  'packs|wrapper-art|M21-3': false,
  'not-a-wrapper-key': 9
}))), {
  'packs|wrapper-art|M21-1': 1,
  'packs|wrapper-art|M21-2': 4
}, 'legacy booleans and current quantities must normalize without affecting other state');

assert.doesNotMatch(html, /state\.(?:openai|vision|identif)|openaiVisionApiKey/,
  'API keys and identification results must stay outside dashboard collection state');
console.log('product-identification dashboard tests: 1066 catalog candidates, camera/upload UI, exact bridge validation, explicit-only mutation, image re-encoding, and wrapper quantity migration passing');
