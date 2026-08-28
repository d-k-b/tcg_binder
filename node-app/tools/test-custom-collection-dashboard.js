#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(html, /id="newCollectionBtn"[^>]*aria-label="New Collection"/, 'toolbar must expose New Collection');
assert.match(html, /id="authorModal"/);
assert.match(html, /Create local draft/);
assert.match(html, /Publish to GitHub Gist/);
assert.match(html, /Local draft — not synced|Stored only on this device — not synced to GitHub/);
assert.match(html, /const COLLECTION_AUTHOR_CHANNEL='tcg-collection-author\/v1'/);
assert.match(html, /event\.origin!==pricingConsumerOrigin\|\|event\.source!==window\.parent/,
  'author results must require exact extension origin and parent frame');
assert.match(html, /AUTHOR_CATALOG_BY_ID\.has\(id\)/, 'AI-selected source IDs must exist in the local catalog');
assert.match(html, /definition\.lifecycle==='live'/, 'only explicitly live custom definitions may enter Gist sync');
assert.match(html, /filter\(definition=>definition\.lifecycle==='live'\)/,
  'the Gist partitioner must exclude every local draft definition');
assert.match(html, /No GitHub Gist will be touched/);
assert.match(html, /const normalizedLibrary=normalizeCollectionLibrary\(s\.collectionLibrary\)/);
assert.match(html, /unsupported-library-schema/);
assert.match(html, /unsupported-or-invalid-definition/);
assert.match(html, /if\(validCustomId\(cl\)&&sl&&sl\.id\)return customKeyFor\(cl,sl\.id\)/,
  'custom progress keys must use immutable slot IDs instead of display text');
assert.match(html, /pricingProducts:\[\]/, 'custom drafts must not invent or duplicate pricing ProductRefs');
assert.match(html, /\(it\.tags\|\|\[\]\)\.filter/,
  'custom and externally researched rows without built-in tags must render safely');
assert.match(html, /payload\.definition=definition/, 'published custom collections must carry their self-describing definition');
assert.match(html, /https:\/\/api\.openai\.com\/v1\/responses/,
  'standalone authoring must embed the validated OpenAI client');
assert.doesNotMatch(html, /sk-(?:proj-)?[A-Za-z0-9_-]{24,}/,
  'the generated dashboard must never contain an actual OpenAI key');

const copies = ['mtg_binder_app.html', path.join('apps', 'static', 'index.html')]
  .map(file => fs.readFileSync(path.join(root, file), 'utf8'));
assert.ok(copies.every(copy => copy === html), 'all generated HTML copies must match');

console.log('custom collection dashboard tests: New Collection chat, explicit local draft apply/publish boundary, stable schema/key identity, recovery preservation, exact bridge validation, no invented pricing, and generated parity passing');
