/* Binder Price Helper — background service worker (Manifest V3).
 *
 * Flow: your binder's "Refresh prices" button tells the Node server to queue
 * TCGplayer jobs. This worker polls that queue, opens each TCGplayer page in a
 * background tab, scrapes the market price, and posts it back to the server.
 *
 * Personal use: this reads pages on demand (one tab at a time, throttled). It is
 * not a crawler — keep volume low and respect TCGplayer's terms.
 */
const DEFAULTS = { enabled: false, serverUrl: 'http://localhost:3000' };
const TAB_RENDER_MS = 4500;   // give TCGplayer's JS time to render prices
const BETWEEN_JOBS_MS = 1500; // throttle between pages

async function cfg() {
  const c = await chrome.storage.local.get(DEFAULTS);
  return Object.assign({}, DEFAULTS, c);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('poll', { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'poll') return;
  const c = await cfg();
  if (c.enabled) drainJobs().catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg.type === 'syncNow') { drainJobs().then((n) => sendResponse({ ok: true, processed: n })).catch((e) => sendResponse({ ok: false, error: String(e) })); return true; }
  if (msg.type === 'status') { getStatus().then(sendResponse); return true; }
});

let busy = false;
async function drainJobs() {
  if (busy) return 0;
  busy = true;
  let processed = 0;
  try {
    const c = await cfg();
    for (let round = 0; round < 20; round++) {
      const res = await fetch(c.serverUrl + '/api/ext/jobs').catch(() => null);
      if (!res || !res.ok) break;
      const { jobs } = await res.json();
      if (!jobs || !jobs.length) break;
      for (const job of jobs) {
        const candidates = await scrapeJob(job).catch(() => []);
        await fetch(c.serverUrl + '/api/ext/ingest', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: job.key, candidates }),
        }).catch(() => {});
        processed++;
        await sleep(BETWEEN_JOBS_MS);
      }
    }
    await chrome.storage.local.set({ lastSync: Date.now(), lastCount: processed });
  } finally { busy = false; }
  return processed;
}

async function scrapeJob(job) {
  const tab = await chrome.tabs.create({ url: job.tcgUrl, active: false });
  try {
    await waitForComplete(tab.id, 12000);
    await sleep(TAB_RENDER_MS);
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeTcgPage,
    });
    return Array.isArray(result) ? result : [];
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function waitForComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') { clearTimeout(t); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/* Runs INSIDE the TCGplayer page. Returns an array of candidate listings
 * [{title, price}] from the search grid; the server's AI filter picks the
 * right "booster box" among them. Selectors may need tweaking over time. */
function scrapeTcgPage() {
  const toNum = (s) => { const m = (s || '').replace(/[\s,]/g, '').match(/\$([0-9]+(?:\.[0-9]+)?)/); return m ? parseFloat(m[1]) : null; };
  const out = [];
  const cards = Array.from(document.querySelectorAll('[class*="product-card"], .search-result, [data-testid*="product"]'));
  for (const c of cards) {
    const title = (c.querySelector('[class*="title"], a')?.textContent || '').trim();
    const price = toNum(c.querySelector('[class*="price"], [class*="market"]')?.textContent);
    if (title && price) out.push({ title, price: Math.round(price) });
  }
  if (out.length) return out.slice(0, 25);
  // Fallback: structured data on a single product page
  try {
    const nd = document.getElementById('__NEXT_DATA__');
    if (nd) {
      const m = (nd.textContent || '').match(/"marketPrice":\s*([0-9.]+)/);
      if (m) return [{ title: document.title, price: Math.round(parseFloat(m[1])) }];
    }
  } catch (e) {}
  return [];
}

async function getStatus() {
  const c = await cfg();
  let pending = null, ok = false;
  try { const r = await fetch(c.serverUrl + '/api/ext/jobs'); const j = await r.json(); pending = j.pending; ok = true; } catch (e) {}
  const s = await chrome.storage.local.get(['lastSync', 'lastCount']);
  return { enabled: c.enabled, serverUrl: c.serverUrl, serverOk: ok, pending, lastSync: s.lastSync || null, lastCount: s.lastCount || 0 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
