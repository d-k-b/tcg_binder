/**
 * Provider-agnostic AI listing filter (Claude or OpenAI), chosen via .env:
 *   AI_PROVIDER = anthropic | openai   (auto-detected from whichever key is set)
 *   ANTHROPIC_API_KEY / OPENAI_API_KEY
 *   AI_MODEL (optional override)
 *
 * filterListings(target, candidates) → [{ i, applicable, perBox, reason }]
 * Lenient + normalize: single sealed boxes AND lots/bundles count (perBox = price ÷ #boxes);
 * empties, loose packs, graded singles, wrong set/type/language are excluded.
 * Returns null if AI isn't configured (caller falls back to a regex heuristic).
 */
/* Read env at call time so keys added via the extension take effect live. */
function provider() {
  return process.env.AI_PROVIDER ||
    (process.env.ANTHROPIC_API_KEY ? 'anthropic' : (process.env.OPENAI_API_KEY ? 'openai' : null));
}
function model() {
  return process.env.AI_MODEL || (provider() === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001');
}
function configured() {
  const p = provider();
  if (p === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  if (p === 'openai') return !!process.env.OPENAI_API_KEY;
  return false;
}

const SYSTEM = [
  'You filter sealed trading-card-game product listings to find the price of ONE specific product.',
  'You are given a target product and a list of marketplace listings (title + total price in USD).',
  'For each listing decide:',
  ' - applicable: true if it IS the target product as a single sealed box, OR a lot/bundle/case',
  '   of that exact box. false for: empty boxes, loose packs/blisters, single cards (incl. graded/slabbed),',
  '   wrong set, wrong product type (e.g. collector box when a draft/play box is wanted, or vice versa),',
  '   wrong language/region if clearly stated, accessories, proxies/custom/reprints, or anything not that box.',
  ' - perBox: the effective USD price for ONE single box. For a single box = the listing price.',
  '   For a lot/case, divide the price by the number of boxes you infer from the title. null if not applicable.',
  ' - reason: <= 8 words.',
  'Respond with ONLY JSON: {"results":[{"i":<index>,"applicable":<bool>,"perBox":<number|null>,"reason":"<text>"}]}.',
].join('\n');

function stripJSON(s) {
  if (!s) return null;
  const m = s.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : s); } catch { return null; }
}

async function callAnthropic(userContent) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model(), max_tokens: 1024, temperature: 0,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw new Error('anthropic ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return (j.content && j.content[0] && j.content[0].text) || '';
}

async function callOpenAI(userContent) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw new Error('openai ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

async function filterListings(target, candidates) {
  if (!configured() || !candidates || !candidates.length) return null;
  const userContent = JSON.stringify({
    target,
    listings: candidates.map((c) => ({ i: c.i, title: c.title, price: c.price })),
  });
  try {
    const raw = provider() === 'openai' ? await callOpenAI(userContent) : await callAnthropic(userContent);
    const parsed = stripJSON(raw);
    if (!parsed || !Array.isArray(parsed.results)) return null;
    return parsed.results;
  } catch (e) {
    console.error('AI filter error:', e.message);
    return null;
  }
}

module.exports = { configured, filterListings, provider, model };
