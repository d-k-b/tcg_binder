(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCGProductIdentify = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNEL = 'tcg-product-identify/v1';
  const RESULT_SCHEMA = 'tcg.product-identification/v1';
  const OBSERVATION_SCHEMA = 'tcg.product-observation/v1';
  const MODEL = 'gpt-5.6-terra';
  const API_URL = 'https://api.openai.com/v1/responses';
  const MAX_CANDIDATES = 1200;
  const MAX_IMAGE_BASE64 = 6_000_000;
  const MAX_REFERENCE_IMAGES = 8;

  function identifyError(code, message) {
    const error = new Error(message || code || 'Product identification failed.');
    error.code = code || 'IDENTIFY_FAILED';
    return error;
  }

  function boundedString(value, maxLength) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function validRequestId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 160;
  }

  function normalizeCandidate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidateId = boundedString(value.candidateId, 240);
    const kind = boundedString(value.kind, 32);
    const game = boundedString(value.game, 20).toLowerCase();
    const label = boundedString(value.label, 300);
    const setCode = boundedString(value.setCode, 20).toUpperCase();
    const setName = boundedString(value.setName, 180);
    const productType = boundedString(value.productType, 80).toLowerCase();
    const unit = boundedString(value.unit, 32).toLowerCase();
    const variant = boundedString(value.variant, 180);
    const imageStatus = boundedString(value.imageStatus, 40);
    let imageUrl = boundedString(value.imageUrl, 1200);
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) imageUrl = '';
    if (!/^(?:product|wrapper):[A-Za-z0-9:._-]{3,220}$/.test(candidateId) ||
        !['product', 'wrapper_art'].includes(kind) || !label || !setName || !game) return null;
    return { candidateId, kind, game, label, setCode, setName, productType, unit, variant, imageUrl, imageStatus };
  }

  function validateIdentifyRequest(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) ||
        message.channel !== CHANNEL || message.type !== 'identifyProduct' || !validRequestId(message.requestId)) {
      throw identifyError('INVALID_IDENTIFY_REQUEST', 'The dashboard sent an invalid identification request.');
    }
    const image = message.image;
    if (!image || typeof image !== 'object' || Array.isArray(image) ||
        !['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) ||
        typeof image.dataBase64 !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(image.dataBase64) ||
        image.dataBase64.length < 64 || image.dataBase64.length > MAX_IMAGE_BASE64 ||
        !Number.isInteger(image.width) || image.width < 1 || image.width > 4096 ||
        !Number.isInteger(image.height) || image.height < 1 || image.height > 4096) {
      throw identifyError('INVALID_IDENTIFY_IMAGE', 'Use a clear JPEG, PNG, or WebP image smaller than the scanner limit.');
    }
    if (!Array.isArray(message.candidates) || !message.candidates.length || message.candidates.length > MAX_CANDIDATES) {
      throw identifyError('INVALID_IDENTIFY_CATALOG', 'The dashboard identification catalog is missing or too large.');
    }
    const seen = new Set();
    const candidates = message.candidates.map(normalizeCandidate);
    if (candidates.some(candidate => !candidate)) throw identifyError('INVALID_IDENTIFY_CATALOG', 'The dashboard identification catalog contains an invalid candidate.');
    for (const candidate of candidates) {
      if (seen.has(candidate.candidateId)) throw identifyError('INVALID_IDENTIFY_CATALOG', 'The dashboard identification catalog contains duplicate candidate IDs.');
      seen.add(candidate.candidateId);
    }
    return {
      requestId: message.requestId,
      image: { mimeType: image.mimeType, dataBase64: image.dataBase64, width: image.width, height: image.height },
      activeChecklist: boundedString(message.activeChecklist, 40),
      candidates
    };
  }

  function words(value) {
    return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(word => word.length > 1);
  }

  function overlapScore(left, right) {
    const a = new Set(words(left));
    const b = new Set(words(right));
    if (!a.size || !b.size) return 0;
    let shared = 0;
    a.forEach(word => { if (b.has(word)) shared += 1; });
    return shared / Math.max(a.size, b.size);
  }

  function observationText(observation) {
    return [observation.setName, observation.setCode, observation.variantName, observation.description]
      .concat(observation.visibleText || []).join(' ');
  }

  function kindCompatibility(observation, candidate) {
    const kind = String(observation.productKind || 'unknown');
    if (kind === 'unknown') return 0;
    if (kind === 'booster_pack') return candidate.kind === 'wrapper_art' || candidate.unit === 'pack' ? 24 : -16;
    if (kind === 'booster_display') return candidate.unit === 'display' ? 24 : -12;
    if (kind === 'prerelease_kit') return candidate.productType === 'prerelease_kit' || candidate.unit === 'kit' ? 24 : -12;
    if (kind === 'collector_booster') return /collector/.test(candidate.productType) ? 22 : -10;
    if (kind === 'other_sealed') return candidate.kind === 'product' ? 6 : 0;
    return 0;
  }

  function candidateScore(observation, candidate) {
    const observedCode = boundedString(observation.setCode, 20).toUpperCase();
    const observedName = boundedString(observation.setName, 180);
    const text = observationText(observation);
    let score = 0;
    if (observedCode && candidate.setCode === observedCode) score += 120;
    if (observedName && candidate.setName.toLowerCase() === observedName.toLowerCase()) score += 90;
    score += Math.round(overlapScore(observedName, candidate.setName) * 55);
    score += Math.round(overlapScore(text, candidate.label + ' ' + candidate.variant) * 35);
    score += kindCompatibility(observation, candidate);
    if (observation.game && candidate.game === String(observation.game).toLowerCase()) score += 8;
    return score;
  }

  function rankCandidates(observation, candidates) {
    if (!observation || observation.status === 'not_tcg') return [];
    const ranked = candidates.map(candidate => ({ candidate, score: candidateScore(observation, candidate) }))
      .sort((a, b) => b.score - a.score || a.candidate.candidateId.localeCompare(b.candidate.candidateId));
    const exactCode = boundedString(observation.setCode, 20).toUpperCase();
    const exactSet = ranked.filter(row => exactCode && row.candidate.setCode === exactCode);
    let pool = exactSet.length ? exactSet : ranked;
    if (observation.productKind === 'booster_pack') {
      const wrapperPool = pool.filter(row => row.candidate.kind === 'wrapper_art');
      if (wrapperPool.length) pool = wrapperPool;
    }
    return pool.slice(0, 12);
  }

  const observationFormat = {
    type: 'json_schema',
    name: 'tcg_product_observation',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        schema: { type: 'string', enum: [OBSERVATION_SCHEMA] },
        status: { type: 'string', enum: ['tcg_product', 'uncertain', 'not_tcg'] },
        game: { type: 'string', enum: ['mtg', 'lorcana', 'pokemon', 'yugioh', 'other', 'unknown'] },
        setName: { type: 'string' }, setCode: { type: 'string' },
        productKind: { type: 'string', enum: ['booster_pack', 'booster_display', 'collector_booster', 'prerelease_kit', 'other_sealed', 'unknown'] },
        boosterType: { type: 'string' }, variantName: { type: 'string' },
        visibleText: { type: 'array', items: { type: 'string' } },
        description: { type: 'string' }, confidence: { type: 'integer', minimum: 0, maximum: 100 }
      },
      required: ['schema', 'status', 'game', 'setName', 'setCode', 'productKind', 'boosterType', 'variantName', 'visibleText', 'description', 'confidence']
    }
  };

  const resolutionFormat = {
    type: 'json_schema',
    name: 'tcg_product_match',
    strict: true,
    schema: {
      type: 'object', additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['matched', 'uncertain', 'no_match'] },
        matches: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              candidateId: { type: 'string' }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, reason: { type: 'string' }
            },
            required: ['candidateId', 'confidence', 'reason']
          }
        }
      },
      required: ['status', 'matches']
    }
  };

  function capturedImagePart(image) {
    return { type: 'input_image', image_url: `data:${image.mimeType};base64,${image.dataBase64}`, detail: 'high' };
  }

  function buildObservationRequest(image, safetyIdentifier) {
    return {
      model: MODEL,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 900,
      safety_identifier: safetyIdentifier || undefined,
      text: { format: observationFormat },
      input: [{ role: 'user', content: [
        { type: 'input_text', text: 'Identify the single sealed trading-card-game product centered in this photo. Read visible packaging text. Distinguish a loose booster pack from a booster display, collector booster, and prerelease kit. For a loose booster, describe the exact wrapper illustration and character or scene so it can be compared with a reviewed wrapper-art catalog. Do not claim an exact catalog identity; only report what is visibly supported. If this is not a sealed TCG product, return not_tcg.' },
        capturedImagePart(image)
      ] }]
    };
  }

  function buildResolutionRequest(image, observation, ranked, safetyIdentifier) {
    const candidates = ranked.map(row => row.candidate);
    const content = [
      { type: 'input_text', text: 'Choose up to three candidates for the photographed sealed TCG product. Return only candidateId values from the supplied list. Rank exact physical packaging and wrapper-art matches first. If the art cannot be distinguished from the evidence, return uncertain rather than guessing. Observation: ' + JSON.stringify(observation) + '\nCandidates: ' + JSON.stringify(candidates.map(candidate => ({ candidateId: candidate.candidateId, kind: candidate.kind, label: candidate.label, setCode: candidate.setCode, setName: candidate.setName, productType: candidate.productType, unit: candidate.unit, variant: candidate.variant, imageStatus: candidate.imageStatus }))) },
      capturedImagePart(image)
    ];
    candidates.filter(candidate => candidate.imageUrl).slice(0, MAX_REFERENCE_IMAGES).forEach(candidate => {
      content.push({ type: 'input_text', text: 'Reference image for ' + candidate.candidateId });
      content.push({ type: 'input_image', image_url: candidate.imageUrl, detail: 'high' });
    });
    return {
      model: MODEL,
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 700,
      safety_identifier: safetyIdentifier || undefined,
      text: { format: resolutionFormat },
      input: [{ role: 'user', content }]
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

  async function callResponses(apiKey, body, fetchImpl) {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response || !response.ok) {
      let detail = '';
      try { detail = boundedString(await response.text(), 300); } catch (_error) {}
      const status = Number(response && response.status) || 0;
      if (status === 401 || status === 403) throw identifyError('OPENAI_UNAUTHORIZED', 'OpenAI rejected the stored API key. Replace it in Tracker settings.');
      if (status === 429) throw identifyError('OPENAI_RATE_LIMITED', 'OpenAI rate or spending limits prevented this scan.');
      throw identifyError('OPENAI_REQUEST_FAILED', 'OpenAI could not analyze this photo' + (status ? ' (HTTP ' + status + ')' : '') + (detail ? ': ' + detail.replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]') : '.'));
    }
    const payload = await response.json();
    const text = responseOutputText(payload);
    if (!text) throw identifyError('OPENAI_INVALID_RESPONSE', 'OpenAI returned no structured identification result.');
    try { return JSON.parse(text); }
    catch (_error) { throw identifyError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an unreadable identification result.'); }
  }

  function normalizeObservation(value) {
    if (!value || value.schema !== OBSERVATION_SCHEMA || !['tcg_product', 'uncertain', 'not_tcg'].includes(value.status)) {
      throw identifyError('OPENAI_INVALID_RESPONSE', 'OpenAI returned an invalid product observation.');
    }
    return {
      schema: OBSERVATION_SCHEMA,
      status: value.status,
      game: boundedString(value.game, 20).toLowerCase(),
      setName: boundedString(value.setName, 180),
      setCode: boundedString(value.setCode, 20).toUpperCase(),
      productKind: boundedString(value.productKind, 40),
      boosterType: boundedString(value.boosterType, 100),
      variantName: boundedString(value.variantName, 180),
      visibleText: Array.isArray(value.visibleText) ? value.visibleText.slice(0, 20).map(text => boundedString(text, 160)).filter(Boolean) : [],
      description: boundedString(value.description, 400),
      confidence: Math.max(0, Math.min(100, Number.isInteger(value.confidence) ? value.confidence : 0))
    };
  }

  function normalizeMatches(value, ranked) {
    const allowed = new Set(ranked.map(row => row.candidate.candidateId));
    const matches = [];
    const seen = new Set();
    for (const match of value && Array.isArray(value.matches) ? value.matches : []) {
      const candidateId = boundedString(match && match.candidateId, 240);
      if (!allowed.has(candidateId) || seen.has(candidateId)) continue;
      seen.add(candidateId);
      matches.push({
        candidateId,
        confidence: Math.max(0, Math.min(100, Number.isInteger(match.confidence) ? match.confidence : 0)),
        reason: boundedString(match.reason, 240)
      });
      if (matches.length >= 3) break;
    }
    return matches;
  }

  async function identifyProduct(apiKey, request, options) {
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw identifyError('OPENAI_KEY_MISSING', 'Add an OpenAI API key in Tracker extension settings first.');
    const fetchImpl = options && options.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) throw identifyError('OPENAI_UNAVAILABLE', 'This extension cannot reach OpenAI in the current browser.');
    const safetyIdentifier = boundedString(options && options.safetyIdentifier, 64);
    const observation = normalizeObservation(await callResponses(apiKey.trim(), buildObservationRequest(request.image, safetyIdentifier), fetchImpl));
    const ranked = rankCandidates(observation, request.candidates);
    if (!ranked.length) return { schema: RESULT_SCHEMA, model: MODEL, status: observation.status === 'not_tcg' ? 'not_tcg' : 'no_match', observation, matches: [] };
    const resolution = await callResponses(apiKey.trim(), buildResolutionRequest(request.image, observation, ranked, safetyIdentifier), fetchImpl);
    const matches = normalizeMatches(resolution, ranked);
    return { schema: RESULT_SCHEMA, model: MODEL, status: matches.length ? (resolution.status === 'matched' ? 'matched' : 'uncertain') : 'no_match', observation, matches };
  }

  return {
    CHANNEL, RESULT_SCHEMA, OBSERVATION_SCHEMA, MODEL, API_URL, MAX_CANDIDATES, MAX_IMAGE_BASE64,
    validRequestId, validateIdentifyRequest, rankCandidates, buildObservationRequest, buildResolutionRequest,
    responseOutputText, identifyProduct, identifyError
  };
});
