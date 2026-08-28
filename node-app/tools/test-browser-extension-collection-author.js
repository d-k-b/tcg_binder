#!/usr/bin/env node
'use strict';

const assert = require('assert');
const author = require('../../browser-extension/collection-author-bridge.js');

const catalog = [
  { sourceId: 'lorcana|source|0123456789abcdef', checklistId: 'lorcana', checklistTitle: 'Lorcana Booster Boxes',
    section: 'Sets 1–5', name: 'The First Chapter', code: '1', productGroups: ['Copies'] },
  { sourceId: 'lorcana|source|fedcba9876543210', checklistId: 'lorcana', checklistTitle: 'Lorcana Booster Boxes',
    section: 'Sets 1–5', name: 'Rise of the Floodborn', code: '2', productGroups: ['Copies'] }
];
const requestMessage = { channel: author.CHANNEL, type: 'collectionAuthorTurn', requestId: 'author-test-1',
  messages: [{ role: 'user', text: 'I want three of every Lorcana booster box.' }], catalog };
const request = author.validateAuthorRequest(requestMessage);
assert.strictEqual(request.catalog.length, 2);
assert.throws(() => author.validateAuthorRequest({ ...requestMessage, messages: [{ role: 'assistant', text: 'Hello' }] }), /end with a user request/);
assert.throws(() => author.validateAuthorRequest({ ...requestMessage, catalog: catalog.concat(catalog[0]) }), /duplicate IDs/);

function responseBody(value) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] };
}

const proposal = {
  schema: author.RESULT_SCHEMA, kind: 'proposal', message: 'I prepared a two-item draft.', questions: [],
  proposal: { title: 'Lorcana Booster Boxes x3', rule: 'Own three booster boxes from every listed Lorcana set.',
    selectionSummary: 'Every item in the Lorcana Booster Boxes catalog.', targetQuantity: 3,
    selectedSourceIds: catalog.map(row => row.sourceId) }
};
const requests = [];
async function mockFetch(url, options) {
  requests.push({ url, options, body: JSON.parse(options.body) });
  return { ok: true, status: 200, json: async () => responseBody(proposal), text: async () => '' };
}

(async () => {
  const apiKey = 'sk-test-collection-author-secret';
  const result = await author.authorCollection(apiKey, request, { fetchImpl: mockFetch, safetyIdentifier: 'tracker-author-test' });
  assert.strictEqual(result.proposal.targetQuantity, 3);
  assert.deepStrictEqual(result.proposal.selectedSourceIds, catalog.map(row => row.sourceId));
  assert.strictEqual(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.strictEqual(requests[0].options.headers.Authorization, `Bearer ${apiKey}`);
  assert.strictEqual(requests[0].body.store, false, 'authoring requests must disable provider storage');
  assert.strictEqual(requests[0].body.model, 'gpt-5.6-terra');
  assert.strictEqual(requests[0].body.safety_identifier, 'tracker-author-test');
  assert.match(requests[0].body.instructions, /never invent products or IDs/);
  assert.match(requests[0].body.instructions, /only a draft/);
  assert.doesNotMatch(JSON.stringify(result), /sk-test-collection-author-secret/);

  async function hallucinatedFetch() {
    const bad = JSON.parse(JSON.stringify(proposal));
    bad.proposal.selectedSourceIds = ['lorcana|source|aaaaaaaaaaaaaaaa'];
    return { ok: true, status: 200, json: async () => responseBody(bad), text: async () => '' };
  }
  await assert.rejects(() => author.authorCollection(apiKey, request, { fetchImpl: hallucinatedFetch }),
    error => error.code === 'OPENAI_INVALID_RESPONSE');
  await assert.rejects(() => author.authorCollection('', request, { fetchImpl: mockFetch }),
    error => error.code === 'OPENAI_KEY_MISSING');

  console.log('browser extension collection-author tests: strict request/catalog validation, structured OpenAI proposal, local ID boundary, no-storage request, and BYOK isolation passing');
})().catch(error => { console.error(error); process.exit(1); });
