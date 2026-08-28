#!/usr/bin/env node
'use strict';

const assert = require('assert');
const identify = require('../../browser-extension/identify-bridge.js');

const image = { mimeType: 'image/jpeg', dataBase64: Buffer.from('a'.repeat(256)).toString('base64'), width: 1200, height: 1600 };
const candidates = [1, 2, 3].map(number => ({
  candidateId: `wrapper:M21-${number}`,
  kind: 'wrapper_art', game: 'mtg', label: `Core Set 2021 booster wrapper Art ${number} (M21-${number})`,
  setCode: 'M21', setName: 'Core Set 2021', productType: 'booster', unit: 'pack', variant: `M21-${number}`,
  imageUrl: `https://example.test/M21_${number}.jpg`, imageStatus: 'exact_individual'
}));
const message = { channel: identify.CHANNEL, type: 'identifyProduct', requestId: 'identify-test-1', image, activeChecklist: 'packs', candidates };
const validated = identify.validateIdentifyRequest(message);
assert.strictEqual(validated.candidates.length, 3);
assert.throws(() => identify.validateIdentifyRequest({ ...message, image: { ...image, mimeType: 'image/gif' } }), /JPEG, PNG, or WebP/);
assert.throws(() => identify.validateIdentifyRequest({ ...message, candidates: candidates.concat(candidates[0]) }), /duplicate candidate IDs/);

const observation = {
  schema: identify.OBSERVATION_SCHEMA, status: 'tcg_product', game: 'mtg', setName: 'Core Set 2021', setCode: 'M21',
  productKind: 'booster_pack', boosterType: 'Draft Booster', variantName: '', visibleText: ['CORE SET 2021'],
  description: 'Loose booster with Teferi artwork', confidence: 93
};
const ranked = identify.rankCandidates(observation, candidates);
assert.deepStrictEqual(ranked.map(row => row.candidate.candidateId).sort(), candidates.map(candidate => candidate.candidateId).sort(),
  'an observed booster set must shortlist only that set wrapper variants');

function responseBody(value) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

const apiKey = 'sk-test-secret-key-that-must-not-leak';
const requests = [];
async function mockFetch(url, options) {
  requests.push({ url, options, body: JSON.parse(options.body) });
  const payload = requests.length === 1
    ? observation
    : { status: 'matched', matches: [{ candidateId: 'wrapper:M21-2', confidence: 97, reason: 'Artwork matches reference 2' }] };
  return { ok: true, status: 200, json: async () => responseBody(payload), text: async () => '' };
}

(async () => {
  const result = await identify.identifyProduct(apiKey, validated, { fetchImpl: mockFetch, safetyIdentifier: 'tracker-test-installation' });
  assert.strictEqual(requests.length, 2, 'exact wrapper identification should observe then compare reviewed references');
  assert.ok(requests.every(request => request.url === 'https://api.openai.com/v1/responses'));
  assert.ok(requests.every(request => request.options.headers.Authorization === `Bearer ${apiKey}`));
  assert.ok(requests.every(request => request.body.store === false), 'photos and responses must not be stored by the API request');
  assert.ok(requests.every(request => request.body.model === 'gpt-5.6-terra'));
  assert.ok(requests.every(request => request.body.reasoning.effort === 'low'));
  assert.ok(requests.every(request => request.body.safety_identifier === 'tracker-test-installation'));
  assert.match(JSON.stringify(requests[0].body), /"detail":"high"/);
  assert.ok(requests[1].body.input[0].content.filter(part => part.type === 'input_image').length === 4,
    'resolution should compare the capture with all three reviewed wrapper references');
  assert.deepStrictEqual(result.matches, [{ candidateId: 'wrapper:M21-2', confidence: 97, reason: 'Artwork matches reference 2' }]);
  assert.doesNotMatch(JSON.stringify(result), /sk-test-secret/, 'the API key must never enter the dashboard result');

  requests.length = 0;
  async function hallucinatedFetch(_url, options) {
    requests.push(JSON.parse(options.body));
    const payload = requests.length === 1 ? observation : {
      status: 'matched', matches: [{ candidateId: 'wrapper:NOT-IN-CATALOG', confidence: 100, reason: 'invented' }]
    };
    return { ok: true, status: 200, json: async () => responseBody(payload), text: async () => '' };
  }
  const rejected = await identify.identifyProduct(apiKey, validated, { fetchImpl: hallucinatedFetch });
  assert.deepStrictEqual(rejected.matches, [], 'a model-invented candidate ID must be discarded');
  assert.strictEqual(rejected.status, 'no_match');

  await assert.rejects(() => identify.identifyProduct('', validated, { fetchImpl: mockFetch }), error => error.code === 'OPENAI_KEY_MISSING');
  console.log('browser extension identification tests: request validation, exact wrapper shortlist, structured OpenAI calls, key boundary, and hallucination rejection passing');
})().catch(error => { console.error(error); process.exit(1); });
