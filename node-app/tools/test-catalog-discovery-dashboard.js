#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const client = require('../../generators/catalog_author_client.js');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const catalog = [{
  sourceId: 'boxes|source|0123456789abcdef', checklistId: 'boxes', checklistTitle: 'MTG Booster Boxes',
  section: 'Play Boosters', name: 'Example Set', code: 'EXM', productGroups: ['Play Booster Box']
}];
const messages = [
  { role: 'user', text: 'I want two of every collector booster pack equivalent from Star Wars Unlimited.' },
  { role: 'assistant', text: 'Should I track Carbonite Edition booster packs for every released set?' },
  { role: 'user', text: 'Yes, released sets only.' }
];
const swuItems = [
  ['Jump to Lightspeed', 'Set 4', '2025-03-14', 'https://starwarsunlimited.com/products/set-4-jump-to-lightspeed'],
  ['Legends of the Force', 'Set 5', '2025-07-11', 'https://starwarsunlimited.com/products/set-5-legends-of-the-force'],
  ['Secrets of Power', 'Set 6', '2025-11-07', 'https://starwarsunlimited.com/products/set-6-secrets-of-power'],
  ['A Lawless Time', 'Set 7', '2026-03-13', 'https://starwarsunlimited.com/products/set-7-a-lawless-time'],
  ['Ashes of the Empire', 'Set 8', '2026-07-10', 'https://starwarsunlimited.com/products/set-8-ashes-of-the-empire']
].map(([name, code, releaseDate, sourceUrl]) => ({
  name: `${name} Carbonite Edition Booster Pack`, code, productName: `${name} Carbonite Edition Booster Pack`,
  variantName: 'Carbonite Edition', releaseDate, status: 'released', sourceUrl,
  sourceTitle: `Official ${name} product page`, evidence: 'The official product page lists Carbonite Edition Booster Packs for this set.'
}));
const externalResult = {
  schema: client.RESULT_SCHEMA, kind: 'catalog_import',
  message: 'I found five released Carbonite Edition booster-pack products on official publisher pages.', questions: [], proposal: null,
  catalogImport: {
    schema: client.IMPORT_SCHEMA, title: 'Star Wars: Unlimited Carbonite Packs',
    rule: 'Own two sealed Carbonite Edition booster packs from every released Star Wars: Unlimited set that has one.',
    gameTitle: 'Star Wars: Unlimited', productFamily: 'Carbonite Edition Booster Pack',
    selectionSummary: 'Official publisher product pages, released sets only.', targetQuantity: 2, scope: 'released',
    items: swuItems, warnings: []
  }
};

const body = client.buildAuthorApiRequest(messages, catalog, 'safe-device-id');
assert.strictEqual(body.store, false, 'catalog research must not opt into API response storage');
assert.deepStrictEqual(body.tools, [{ type: 'web_search' }], 'unknown catalogs must have explicit web-search capability');
assert.strictEqual(body.text.format.strict, true);
assert.strictEqual(body.text.format.schema.additionalProperties, false);
assert.match(body.instructions, /Prefer official publisher\/product pages/);
assert.match(body.instructions, /never changes ownership/i);
const revisionDefinition = {
  title: 'Star Wars Carbonite Packs', sub: 'Own two of every released Carbonite pack.', lifecycle: 'draft', revision: 2,
  eras: [{ name: 'Released products', items: [{ name: 'Jump to Lightspeed Carbonite Pack', code: 'SWH0406EN',
    slots: [{ id: 'private-slot-id', l: 'Copy 1', r: true }, { id: 'private-slot-id-2', l: 'Copy 2', r: true }],
    sourceRef: { schema: 'tcg.external-catalog-source/v1', sourceUrl: swuItems[0].sourceUrl,
      sourceTitle: swuItems[0].sourceTitle, productName: swuItems[0].productName, variantName: 'Carbonite Edition',
      releaseDate: swuItems[0].releaseDate, releaseStatus: 'released' } }] }]
};
const revisionBody = client.buildAuthorApiRequest([{ role: 'user', text: 'Add announced products.' }], catalog, 'safe-device-id', revisionDefinition);
assert.match(revisionBody.input[0].content, /Current collection to revise/);
assert.match(revisionBody.instructions, /complete intended replacement|complete replacement definition|complete replacement collection/);
assert.doesNotMatch(JSON.stringify(revisionBody.input[0]), /private-slot-id|collectionId|owned|ordered/,
  'AI revision context must contain the collection definition but no storage identity or ownership state');

const normalized = client.normalizeAuthorResult(externalResult, catalog);
assert.strictEqual(normalized.kind, 'catalog_import');
assert.strictEqual(normalized.catalogImport.items.length, 5);
assert.strictEqual(normalized.catalogImport.targetQuantity, 2);
assert.ok(normalized.catalogImport.items.every(item => item.sourceUrl.startsWith('https://starwarsunlimited.com/')));

assert.throws(() => client.normalizeAuthorResult({ ...externalResult, catalogImport: {
  ...externalResult.catalogImport, items: [{ ...swuItems[0], sourceUrl: 'javascript:alert(1)' }]
}}, catalog), /valid HTTPS evidence source/);
assert.throws(() => client.normalizeAuthorResult({ ...externalResult, catalogImport: {
  ...externalResult.catalogImport, items: [swuItems[0], { ...swuItems[0] }]
}}, catalog), /duplicate products/);

(async () => {
  let request;
  const fakeKey = 'sk-test-catalog-discovery-not-real';
  const result = await client.authorCollection(fakeKey, messages, catalog, { safetyIdentifier: 'safe-device-id', fetchImpl: async (_url, options) => {
    request = options;
    return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(externalResult) }] }] }) };
  }});
  assert.strictEqual(result.catalogImport.items.length, 5);
  assert.match(request.headers.Authorization, /^Bearer sk-test-/);
  assert.deepStrictEqual(JSON.parse(request.body).tools, [{ type: 'web_search' }]);
  assert.ok(!JSON.stringify(result).includes(fakeKey), 'validated result must never contain the API key');

  assert.match(html, /TCGCatalogAuthor\.authorCollection/);
  assert.match(html, /tcg\.collection-author-result\/v2/);
  assert.match(html, /tcg\.external-catalog-source\/v1/);
  assert.match(html, /Import catalog &amp; create local draft|Import catalog & create local draft/);
  assert.match(html, /Review every product and source/);
  assert.match(html, /method:'openai-web-catalog-import'/);
  assert.match(html, /sourceUrl:source\.sourceUrl/);
  assert.match(html, /\(it\.tags\|\|\[\]\)\.filter/,
    'external catalog rows must not require built-in tag metadata');
  assert.match(html, /lifecycle:'draft'/);
  assert.match(html, /definition\.lifecycle==='live'/, 'external drafts must retain the explicit Gist publication boundary');
  assert.match(html, /Apply as local revision/);
  assert.match(html, /published collection and GitHub remain unchanged/);
  assert.doesNotMatch(html, /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/, 'generated output must not contain a real-looking key');

  const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
    .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
  assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');
  console.log('catalog discovery dashboard tests: web-search request, strict sourced import validation, Star Wars Unlimited five-product example, explicit local-draft approval, and generated parity passing');
})().catch(error => { console.error(error); process.exitCode = 1; });
