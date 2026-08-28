(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCGCatalogAuthor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RESULT_SCHEMA = 'tcg.collection-author-result/v2';
  const IMPORT_SCHEMA = 'tcg.external-catalog-import/v1';
  const MODEL = 'gpt-5.6-terra';
  const API_URL = 'https://api.openai.com/v1/responses';
  const MAX_CATALOG_ITEMS = 1200;
  const MAX_IMPORT_ITEMS = 400;

  function authorError(code, message) {
    const error = new Error(message || code || 'Collection authoring failed.');
    error.code = code || 'AUTHOR_FAILED';
    return error;
  }

  function boundedString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function validHttpsUrl(value) {
    const text = boundedString(value, 1000);
    if (!text) return '';
    try {
      const url = new URL(text);
      return url.protocol === 'https:' && url.username === '' && url.password === '' ? url.href : '';
    } catch (_error) { return ''; }
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

  function normalizeRequest(messages, catalog) {
    if (!Array.isArray(messages) || !messages.length || messages.length > 16) {
      throw authorError('INVALID_AUTHOR_MESSAGES', 'The collection conversation is missing or too long.');
    }
    const safeMessages = messages.map(turn => {
      const role = turn && turn.role;
      const text = boundedString(turn && turn.text, 2000);
      return (role === 'user' || role === 'assistant') && text ? { role, text } : null;
    });
    if (safeMessages.some(turn => !turn) || safeMessages[safeMessages.length - 1].role !== 'user') {
      throw authorError('INVALID_AUTHOR_MESSAGES', 'The collection conversation must end with a user request.');
    }
    if (!Array.isArray(catalog) || !catalog.length || catalog.length > MAX_CATALOG_ITEMS) {
      throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog is missing or too large.');
    }
    const safeCatalog = catalog.map(normalizeCatalogRow);
    if (safeCatalog.some(row => !row)) throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog contains an invalid item.');
    const ids = new Set();
    for (const row of safeCatalog) {
      if (ids.has(row.sourceId)) throw authorError('INVALID_AUTHOR_CATALOG', 'The dashboard collection catalog contains duplicate IDs.');
      ids.add(row.sourceId);
    }
    return { messages: safeMessages, catalog: safeCatalog };
  }

  function normalizeRevisionContext(value) {
    if (!value) return null;
    if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.eras)) {
      throw authorError('INVALID_REVISION_CONTEXT', 'The current collection could not be prepared for revision.');
    }
    const title = boundedString(value.title, 100), rule = boundedString(value.sub, 700);
    if (!title || !rule) throw authorError('INVALID_REVISION_CONTEXT', 'The current collection is missing its title or rule.');
    const items = [];
    for (const era of value.eras.slice(0, 100)) {
      const section = boundedString(era && era.name, 160);
      for (const item of era && Array.isArray(era.items) ? era.items : []) {
        const name = boundedString(item && item.name, 180), code = boundedString(item && item.code, 30).toUpperCase();
        if (!name || !Array.isArray(item.slots)) continue;
        const source = item.sourceRef && typeof item.sourceRef === 'object' ? item.sourceRef : {};
        items.push({ section, name, code,
          targetQuantity: item.slots.filter(slot => !slot || slot.r !== false).length,
          sourceId: boundedString(source.sourceId, 100) || null,
          sourceUrl: validHttpsUrl(source.sourceUrl) || null,
          sourceTitle: boundedString(source.sourceTitle, 200) || null,
          productName: boundedString(source.productName, 180) || null,
          variantName: boundedString(source.variantName, 160) || null,
          releaseDate: boundedString(source.releaseDate, 30) || null,
          releaseStatus: ['released', 'announced', 'unknown'].includes(source.releaseStatus) ? source.releaseStatus : null });
        if (items.length > MAX_IMPORT_ITEMS) throw authorError('INVALID_REVISION_CONTEXT', 'This collection is too large for AI revision.');
      }
    }
    if (!items.length) throw authorError('INVALID_REVISION_CONTEXT', 'The current collection has no products to revise.');
    return { schema: 'tcg.collection-revision-context/v1', title, rule,
      lifecycle: value.lifecycle === 'live' ? 'live' : 'draft', revision: Math.max(1, Math.floor(Number(value.revision) || 1)), items };
  }

  const importItemSchema = {
    type: 'object', additionalProperties: false,
    properties: {
      name: { type: 'string' }, code: { type: 'string' }, productName: { type: 'string' },
      variantName: { type: ['string', 'null'] }, releaseDate: { type: ['string', 'null'] },
      status: { type: 'string', enum: ['released', 'announced', 'unknown'] },
      sourceUrl: { type: 'string' }, sourceTitle: { type: 'string' }, evidence: { type: 'string' }
    },
    required: ['name', 'code', 'productName', 'variantName', 'releaseDate', 'status', 'sourceUrl', 'sourceTitle', 'evidence']
  };

  const resultFormat = {
    type: 'json_schema', name: 'tcg_collection_author_result_v2', strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        schema: { type: 'string', enum: [RESULT_SCHEMA] },
        kind: { type: 'string', enum: ['clarification', 'proposal', 'catalog_import'] },
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
        },
        catalogImport: {
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            schema: { type: 'string', enum: [IMPORT_SCHEMA] },
            title: { type: 'string' }, rule: { type: 'string' }, gameTitle: { type: 'string' },
            productFamily: { type: 'string' }, selectionSummary: { type: 'string' },
            targetQuantity: { type: 'integer', minimum: 1, maximum: 100 },
            scope: { type: 'string', enum: ['released', 'released_and_announced'] },
            items: { type: 'array', minItems: 1, maxItems: MAX_IMPORT_ITEMS, items: importItemSchema },
            warnings: { type: 'array', maxItems: 10, items: { type: 'string' } }
          },
          required: ['schema', 'title', 'rule', 'gameTitle', 'productFamily', 'selectionSummary', 'targetQuantity', 'scope', 'items', 'warnings']
        }
      },
      required: ['schema', 'kind', 'message', 'questions', 'proposal', 'catalogImport']
    }
  };

  function buildAuthorApiRequest(messages, catalog, safetyIdentifier, revisionContext) {
    const request = normalizeRequest(messages, catalog);
    const input = request.messages.map(turn => ({ role: turn.role, content: turn.text }));
    const current = normalizeRevisionContext(revisionContext);
    if (current) input.unshift({ role: 'user', content:
      'Current collection to revise. Return a complete replacement definition, not a partial patch. Preserve products and rules unless the user explicitly changes them:\n' + JSON.stringify(current) });
    input.push({ role: 'user', content: 'Current dashboard catalog (sourceId values are authoritative):\n' + JSON.stringify(request.catalog) });
    return {
      model: MODEL,
      store: false,
      reasoning: { effort: 'medium' },
      max_output_tokens: 8000,
      safety_identifier: boundedString(safetyIdentifier, 64) || undefined,
      tools: [{ type: 'web_search' }],
      instructions: 'You help a collector design or revise one sealed-product checklist. First use the supplied dashboard catalog when it contains the requested game and products. When a current collection is supplied, treat the user request as a revision and return the complete intended replacement collection, not a patch; preserve existing products, evidence, scope, and rules unless the user explicitly changes them. Ask concise clarification questions when game, product type, equivalence rule, released-versus-announced scope, exclusions, or quantity is ambiguous. If the requested catalog is absent, use web search only after the request is clear. Prefer official publisher/product pages for every imported product; use a reputable secondary catalog only when official evidence is unavailable and disclose that in warnings. Treat distinct named products or art variants as distinct rows when the user requests them. Never claim completeness without evidence. For an existing-catalog proposal, select only exact supplied sourceId values. For an external catalog_import, include one independently sourced item per tracked product, an exact HTTPS evidence URL, a concise quote-free evidence summary, release status, and a stable human-readable name. Never invent source IDs, facts, products, URLs, or release dates. A result is only a reviewable local draft proposal: it never changes ownership and never syncs to GitHub automatically. For clarification, proposal and catalogImport are null. For proposal, catalogImport is null. For catalog_import, proposal is null and questions is empty. Do not request or repeat API keys, GitHub tokens, credentials, ownership quantities, prices, or personal data.',
      text: { format: resultFormat },
      input
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

  function normalizeImportItem(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const name = boundedString(value.name, 180), code = boundedString(value.code, 30).toUpperCase();
    const productName = boundedString(value.productName, 180), variantName = boundedString(value.variantName, 160);
    const releaseDate = boundedString(value.releaseDate, 30), sourceUrl = validHttpsUrl(value.sourceUrl);
    const sourceTitle = boundedString(value.sourceTitle, 200), evidence = boundedString(value.evidence, 500);
    const status = ['released', 'announced', 'unknown'].includes(value.status) ? value.status : '';
    if (!name || !productName || !status || !sourceUrl || !sourceTitle || !evidence) return null;
    if (releaseDate && Number.isNaN(Date.parse(releaseDate))) return null;
    return { name, code, productName, variantName: variantName || null,
      releaseDate: releaseDate ? new Date(releaseDate).toISOString().slice(0, 10) : null,
      status, sourceUrl, sourceTitle, evidence };
  }

  function normalizeAuthorResult(value, catalog) {
    if (!value || value.schema !== RESULT_SCHEMA || !['clarification', 'proposal', 'catalog_import'].includes(value.kind)) {
      throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an invalid collection-authoring result.');
    }
    const message = boundedString(value.message, 1200);
    const questions = Array.isArray(value.questions) ? value.questions.slice(0, 6).map(question => boundedString(question, 300)).filter(Boolean) : [];
    if (!message) throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an empty collection response.');
    if (value.kind === 'clarification') return { schema: RESULT_SCHEMA, kind: 'clarification', message, questions, proposal: null, catalogImport: null };
    if (value.kind === 'proposal') {
      const proposal = value.proposal, allowed = new Set(catalog.map(row => row.sourceId));
      const selectedSourceIds = Array.isArray(proposal && proposal.selectedSourceIds) ? proposal.selectedSourceIds.map(id => boundedString(id, 100)) : [];
      const unique = new Set(selectedSourceIds), targetQuantity = Math.floor(Number(proposal && proposal.targetQuantity));
      if (!proposal || !boundedString(proposal.title, 100) || !boundedString(proposal.rule, 700) || !boundedString(proposal.selectionSummary, 500) ||
          !Number.isInteger(targetQuantity) || targetQuantity < 1 || targetQuantity > 100 || !selectedSourceIds.length ||
          unique.size !== selectedSourceIds.length || selectedSourceIds.some(id => !allowed.has(id))) {
        throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned a proposal with unknown products or invalid targets.');
      }
      return { schema: RESULT_SCHEMA, kind: 'proposal', message, questions: [], catalogImport: null, proposal: {
        title: boundedString(proposal.title, 100), rule: boundedString(proposal.rule, 700),
        selectionSummary: boundedString(proposal.selectionSummary, 500), targetQuantity, selectedSourceIds
      } };
    }
    const catalogImport = value.catalogImport;
    if (!catalogImport || catalogImport.schema !== IMPORT_SCHEMA || !Array.isArray(catalogImport.items) ||
        !catalogImport.items.length || catalogImport.items.length > MAX_IMPORT_ITEMS) {
      throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an invalid external catalog.');
    }
    const items = catalogImport.items.map(normalizeImportItem);
    if (items.some(item => !item)) throw authorError('OPENAI_INVALID_RESPONSE', 'Every imported product needs a valid HTTPS evidence source.');
    const identities = new Set();
    for (const item of items) {
      const identity = [item.name, item.code, item.productName, item.variantName || ''].join('\u001f').toLowerCase();
      if (identities.has(identity)) throw authorError('OPENAI_INVALID_RESPONSE', 'The researched catalog contains duplicate products.');
      identities.add(identity);
    }
    const targetQuantity = Math.floor(Number(catalogImport.targetQuantity));
    const scope = ['released', 'released_and_announced'].includes(catalogImport.scope) ? catalogImport.scope : '';
    const title = boundedString(catalogImport.title, 100), rule = boundedString(catalogImport.rule, 700);
    const gameTitle = boundedString(catalogImport.gameTitle, 120), productFamily = boundedString(catalogImport.productFamily, 160);
    const selectionSummary = boundedString(catalogImport.selectionSummary, 500);
    const warnings = Array.isArray(catalogImport.warnings) ? catalogImport.warnings.slice(0, 10).map(warning => boundedString(warning, 400)).filter(Boolean) : [];
    if (!title || !rule || !gameTitle || !productFamily || !selectionSummary || !Number.isInteger(targetQuantity) ||
        targetQuantity < 1 || targetQuantity > 100 || !scope) {
      throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an incomplete external catalog.');
    }
    return { schema: RESULT_SCHEMA, kind: 'catalog_import', message, questions: [], proposal: null,
      catalogImport: { schema: IMPORT_SCHEMA, title, rule, gameTitle, productFamily, selectionSummary,
        targetQuantity, scope, items, warnings } };
  }

  async function authorCollection(apiKey, messages, catalog, options) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw authorError('OPENAI_KEY_MISSING', 'Add an OpenAI API key in dashboard AI settings first.');
    const fetchImpl = options && options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw authorError('OPENAI_UNAVAILABLE', 'This browser cannot reach OpenAI.');
    const safeRequest = normalizeRequest(messages, catalog);
    const body = buildAuthorApiRequest(safeRequest.messages, safeRequest.catalog, options && options.safetyIdentifier,
      options && options.currentDefinition);
    const response = await fetchImpl(API_URL, { method: 'POST', headers: {
      Authorization: 'Bearer ' + apiKey.trim(), 'Content-Type': 'application/json'
    }, body: JSON.stringify(body) });
    if (!response || !response.ok) {
      let detail = ''; try { detail = boundedString(await response.text(), 300); } catch (_error) {}
      const status = Number(response && response.status) || 0;
      if (status === 401 || status === 403) throw authorError('OPENAI_UNAUTHORIZED', 'OpenAI rejected the saved API key. Replace it in AI settings.');
      if (status === 429) throw authorError('OPENAI_RATE_LIMITED', 'OpenAI rate or spending limits prevented this request.');
      throw authorError('OPENAI_REQUEST_FAILED', 'OpenAI could not design this collection' + (status ? ' (HTTP ' + status + ')' : '') +
        (detail ? ': ' + detail.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]') : '.'));
    }
    const payload = await response.json(), text = responseOutputText(payload);
    if (!text) throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned no structured collection result.');
    let parsed; try { parsed = JSON.parse(text); } catch (_error) { throw authorError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an unreadable collection result.'); }
    return normalizeAuthorResult(parsed, safeRequest.catalog);
  }

  return { RESULT_SCHEMA, IMPORT_SCHEMA, MODEL, API_URL, MAX_CATALOG_ITEMS, MAX_IMPORT_ITEMS,
    validHttpsUrl, normalizeRequest, normalizeRevisionContext, buildAuthorApiRequest, responseOutputText, normalizeAuthorResult, authorCollection, authorError };
});
