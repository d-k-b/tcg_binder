/**
 * Price cache + per-item query builders + a tiny job queue for the
 * Chrome extension (which handles TCGplayer, since their API is closed).
 *
 * Price record shape (keyed by `${checklistId}::${name}`):
 *   { ebayLow, ebaySold, ebaySoldLow, ebaySoldHigh, tcg, updatedAt, ebayUrl }
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.data');
const PRICES_PATH = path.join(DATA_DIR, 'prices.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let prices = load();
let tcgJobs = []; // [{key, name, query, tcgUrl}]

function load() {
  try { return JSON.parse(fs.readFileSync(PRICES_PATH, 'utf8')); } catch { return {}; }
}
function save() { fs.writeFileSync(PRICES_PATH, JSON.stringify(prices, null, 2)); }

const keyOf = (checklistId, name) => `${checklistId}::${name}`;

/* Per-checklist query + TCGplayer search URL builders. */
function buildQuery(checklistId, name) {
  if (checklistId === 'lorcana') return `Disney Lorcana ${name} booster box sealed`;
  if (checklistId === 'collector') return `Magic the Gathering ${name} collector booster box sealed`;
  // boxes / packs / prerelease → generic MTG booster box
  return `Magic the Gathering ${name} booster box sealed`;
}
function buildTarget(checklistId, name) {
  if (checklistId === 'lorcana') return `Disney Lorcana — ${name} — a single sealed standard booster box (24 packs). Lots/bundles OK (give per-box price).`;
  if (checklistId === 'collector') return `Magic: The Gathering — ${name} — a single sealed COLLECTOR booster box (not draft/play/set). Lots OK.`;
  if (checklistId === 'boxes') return `Magic: The Gathering — ${name} — a single sealed standard booster box (the draft/play box, not Collector). Lots OK.`;
  return `Magic: The Gathering — ${name} — a single sealed booster box. Lots OK.`;
}
function buildTcgUrl(checklistId, name) {
  const line = checklistId === 'lorcana' ? 'lorcana-tcg' : 'magic';
  const kind = checklistId === 'collector' ? 'collector booster box' : 'booster box';
  const q = encodeURIComponent(`${name} ${kind}`);
  return `https://www.tcgplayer.com/search/${line}/product?q=${q}&view=grid`;
}

function getAll() { return prices; }

function setEbay(checklistId, name, ebay) {
  const k = keyOf(checklistId, name);
  prices[k] = Object.assign({}, prices[k], {
    ebayLow: ebay.lowestActive ?? null,
    ebaySold: ebay.sold ?? null,
    ebaySoldLow: ebay.soldLow ?? null,
    ebaySoldHigh: ebay.soldHigh ?? null,
    ebayUrl: ebay.url ?? null,
    ebayApplicable: ebay.applicable ?? null,
    ebayExcluded: ebay.excluded ?? null,
    ebayFiltered: ebay.filtered ?? null,
    updatedAt: new Date().toISOString(),
  });
  save();
}

function enqueueTcg(checklistId, name) {
  const k = keyOf(checklistId, name);
  if (tcgJobs.find((j) => j.key === k)) return;
  tcgJobs.push({ key: k, name, query: buildQuery(checklistId, name), tcgUrl: buildTcgUrl(checklistId, name) });
}
function takeJobs(limit = 8) {
  const batch = tcgJobs.slice(0, limit);
  tcgJobs = tcgJobs.slice(limit);
  return batch;
}
function pendingJobCount() { return tcgJobs.length; }

function ingestTcg(key, tcg, meta = {}) {
  prices[key] = Object.assign({}, prices[key], {
    tcg: tcg ?? null,
    tcgApplicable: meta.tcgApplicable ?? null,
    tcgExcluded: meta.tcgExcluded ?? null,
    tcgFiltered: meta.tcgFiltered ?? null,
    updatedAt: new Date().toISOString(),
  });
  save();
}

module.exports = {
  keyOf, buildQuery, buildTarget, buildTcgUrl, getAll,
  setEbay, enqueueTcg, takeJobs, pendingJobCount, ingestTcg,
};
