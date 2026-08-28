(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCGCollectionAuthor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNEL = 'tcg-collection-author/v1';
  const RESULT_SCHEMA = 'tcg.collection-author-result/v1';
  const MODEL = 'gpt-5.6-terra';
  const API_URL = 'https://api.openai.com/v1/responses';
  const MAX_CATALOG_ITEMS = 1200;

  function authorError(code, message) {
    const error = new Error(message || code || 'Collection authoring failed.');
    error.code = code || 'AUTHOR_FAILED';
    return error;
  }

  function boundedString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function validRequestId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 160;
  }

  function normalizeCatalogRow(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const sourceId = boundedString(value.sourceId, 100);
    const checklistId = boundedString(value.checklistId, 64);
    const checklistTitle = boundedString(value.checklistTitle, 120);
    const section = boundedString(value.section, 180);
    const name = boundedString(value.name, 180);
    const code = boundedString(value.code, 30).toUpperCase();
    const productGroups = Array.isArray(value.productGroups)
      ? value.productGroups.slice(0, 20).map(group => boundedString(group, 80)).filter(Boolean) : [];
    if (!/^[a-z0-9_-]{1,64}\|source\|[0-9a-f]{16}$/i.test(sourceId) || !checklistId || !checklistTitle || !section || !name) return null;
    return { sourceId, checklistId, checklistTitle, section, name, code, productGroups };
  }

  function validateAuthorRequest(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.channel !== CHANNEL ||
        message.type !== 'collectionAuthorTurn' || !validRequestId(message.requestId)) {
      throw authorError('INVALID_AUTHOR_REQUEST', 'The dashboard sent an invalid collection-authoring request.');
    }
    if (!Array.isArray(message.messages) || !message.messages.length || message.messages.length > 16) {
      throw authorError('INVALID_AUTHOR_MESSAGES', 'The collection conversation is missing or too long.');
    }
    const messages = message.messages.map(turn => {
      const role = turn && turn.role;
      const text = boundedString(turn && turn.text, 2000);
      return (role === 'user' || role === 'assistant') && text ? { role, text } : null;
    });
    if (messages.some(turn => !turn) || messages[messages.length - 1].role !== 'user') {
      throw authorError('INVALID_AUTHOR_MESSAGES', 'The collection conversation must end with a user request.');
    }
    if (!Array.isArray(message.catalog) || !message.catalog.length || message.catalog.length > MAX_CATALOG_ITEMS) {
      throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog is missing or too large.');
    }
    const catalog = message.catalog.map(normalizeCatalogRow);
    if (catalog.some(row => !row)) throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog contains an invalid item.');
    const seen = new Set();
    for (const row of catalog) {
      if (seen.has(row.sourceId)) throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog contains duplicate IDs.');
      seen.add(row.sourceId);
    }
    return { requestId: message.requestId, messages, catalog };
  }

  const resultFormat = {
    type: 'json_schema',
    name: 'tcg_collection_author_result',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        schema: { type: 'string', enum: [RESULT_SCHEMA] },
        kind: { type: 'string', enum: ['clarification', 'proposal'] },
        message: { type: 'string' },
        questions: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        proposal: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            title: { type: 'string' }, rule: { type: 'string' }, selectionSummary: { type: 'string' },
            targetQuantity: { type: 'integer', minimum: 1, maximum: 100 },
            selectedSourceIds: { type: 'array', minItems: 1, maxItems: MAX_CATALOG_ITEMS, items: { type: 'string' } }
          },
          required: ['title', 'rule', 'selectionSummary', 'targetQuantity', 'selectedSourceIds']
        }
      },
      required: ['schema', 'kind', 'message', 'questions', 'proposal']
    }
  };

  function buildAuthorApiRequest(request, safetyIdentifier) {
    const conversation = request.messages.map(turn => ({ role: turn.role, content: turn.text }));
    conversation.push({ role: 'user', content:
      'Available dashboard catalog (sourceId values are authoritative):\n' + JSON.stringify(request.catalog) });
    return {
      model: MODEL,
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 4000,
      safety_identifier: safetyIdentifier || undefined,
      instructions: 'You help a collector design one checklist from an existing sealed-product catalog. Ask concise clarification questions when the game, product type, scope, exclusions, or target quantity is ambiguous. When sufficiently clear, return a proposal. Select only exact sourceId values from the supplied catalog; never invent products or IDs. The proposal targetQuantity applies independently to every selected item. Write a short title and an unambiguous completion rule. A proposal is only a draft and never changes ownership automatically. For clarification set proposal to null. For a proposal include at least one selectedSourceId and set questions to an empty array. Do not request or repeat API keys, GitHub tokens, credentials, ownership quantities, prices, or personal data.',
      text: { format: resultFormat },
      input: conversation
    };
  }

  function responseOutputText(response) {
    const parts = [];
    for (const item of response && Array.isArray(response.output) ? response.output : []) {
      if (item && item.type === 'message' && Array.isArray(item.content)) {
        item.content.forEach(part => { if (part && part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text); });
      }
    }
    return parts.join('').trim();
  }

  function normalizeAuthorResult(value, catalog) {
    if (!value || value.schema !== RESULT_SCHEMA || !['clarification', 'proposal'].includes(value.kind)) {
      throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an invalid collection-authoring result.');
    }
    const message = boundedString(value.message, 1200);
    const questions = Array.isArray(value.questions) ? value.questions.slice(0, 6).map(question => boundedString(question, 300)).filter(Boolean) : [];
    if (!message) throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an empty collection response.');
    if (value.kind === 'clarification') return { schema: RESULT_SCHEMA, kind: 'clarification', message, questions, proposal: null };
    const proposal = value.proposal;
    const allowed = new Set(catalog.map(row => row.sourceId));
    const selectedSourceIds = Array.isArray(proposal && proposal.selectedSourceIds) ? proposal.selectedSourceIds.map(id => boundedString(id, 100)) : [];
    const unique = new Set(selectedSourceIds);
    const targetQuantity = Math.floor(Number(proposal && proposal.targetQuantity));
    if (!proposal || !boundedString(proposal.title, 100) || !boundedString(proposal.rule, 700) ||
        !boundedString(proposal.selectionSummary, 500) || !Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 100 ||
        !selectedSourceIds.length || unique.size !== selectedSourceIds.length || selectedSourceIds.some(id => !allowed.has(id))) {
      throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned a proposal with unknown products or invalid targets.');
    }
    return { schema: RESULT_SCHEMA, kind: 'proposal', message, questions: [], proposal: {
      title: boundedString(proposal.title, 100), rule: boundedString(proposal.rule, 700),
      selectionSummary: boundedString(proposal.selectionSummary, 500), targetQuantity, selectedSourceIds
    } };
  }

  async function authorCollection(apiKey, request, options) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw authorError('OPENAI_KEY_MISSING', 'Add an OpenAI API key in Tracker extension settings first.');
    const fetchImpl = options && options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw authorError('OPENAI_UNAVAILABLE', 'This extension cannot reach OpenAI in the current browser.');
    const body = buildAuthorApiRequest(request, boundedString(options && options.safetyIdentifier, 64));
    const response = await fetchImpl(API_URL, { method: 'POST', headers: { Authorization: 'Bearer ' + apiKey.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response || !response.ok) {
      let detail = ''; try { detail = boundedString(await response.text(), 300); } catch (_error) {}
      const status = Number(response && response.status) || 0;
      if (status === 401 || status === 403) throw authorError('OPENAI_UNAUTHORIZED', 'OpenAI rejected the stored API key. Replace it in Tracker settings.');
      if (status === 429) throw authorError('OPENAI_RATE_LIMITED', 'OpenAI rate or spending limits prevented this request.');
      throw authorError('OPENAI_REQUEST_FAILED', 'OpenAI could not design this collection' + (status ? ' (HTTP ' + status + ')' : '') +
        (detail ? ': ' + detail.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]') : '.'));
    }
    const payload = await response.json(), text = responseOutputText(payload);
    if (!text) throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned no structured collection result.');
    let parsed; try { parsed = JSON.parse(text); } catch (_error) { throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an unreadable collection result.'); }
    return normalizeAuthorResult(parsed, request.catalog);
  }

  return { CHANNEL, RESULT_SCHEMA, MODEL, API_URL, MAX_CATALOG_ITEMS, validRequestId,
    validateAuthorRequest, buildAuthorApiRequest, responseOutputText, normalizeAuthorResult, authorCollection, authorError };
});
