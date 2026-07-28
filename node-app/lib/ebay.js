/**
 * Minimal eBay Buy API client.
 *  - Mints an application access token via client-credentials (preferred), OR
 *    uses a static EBAY_TOKEN from .env if you already have one.
 *  - searchActive():  Browse API → lowest active "Buy It Now" sealed-box listing.
 *  - searchSold():    Marketplace Insights API → recent sold price (needs special
 *                     access; returns null gracefully if your app isn't approved).
 *
 * Node 18+ has global fetch, so no dependencies needed.
 */
const EBAY_BASE = process.env.EBAY_ENV === 'sandbox'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';
const MARKETPLACE = process.env.EBAY_MARKETPLACE || 'EBAY_US';

let cachedToken = null;
let cachedTokenExp = 0;

async function getToken() {
  if (process.env.EBAY_TOKEN) return process.env.EBAY_TOKEN;     // static token path
  if (cachedToken && Date.now() < cachedTokenExp - 60000) return cachedToken;

  const id = process.env.EBAY_CLIENT_ID, secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('eBay not configured (set EBAY_CLIENT_ID/SECRET or EBAY_TOKEN in .env)');

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch(`${EBAY_BASE}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!res.ok) throw new Error('eBay token request failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  cachedToken = j.access_token;
  cachedTokenExp = Date.now() + (j.expires_in || 7200) * 1000;
  return cachedToken;
}

function looksLikeBox(title) {
  const t = (title || '').toLowerCase();
  if (!t.includes('box')) return false;
  // exclude obvious non-single-box listings
  return !/(case|lot|x\d|\d+x|empty|break|spot|random|pack only|single pack|read )/.test(t);
}

async function searchActive(query) {
  const token = await getToken();
  const url = `${EBAY_BASE}/buy/browse/v1/item_summary/search`
    + `?q=${encodeURIComponent(query)}`
    + `&filter=${encodeURIComponent('buyingOptions:{FIXED_PRICE}')}`
    + `&sort=price&limit=30`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
      'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=10001',
    },
  });
  if (!res.ok) throw new Error('eBay Browse failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  const items = (j.itemSummaries || []).filter((it) => looksLikeBox(it.title));
  let best = null;
  for (const it of items) {
    const price = parseFloat(it.price && it.price.value);
    if (isNaN(price)) continue;
    const ship = (it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost
      && parseFloat(it.shippingOptions[0].shippingCost.value)) || 0;
    const total = price + ship;
    if (!best || total < best.total) best = { total, price, ship, title: it.title, url: it.itemWebUrl };
  }
  return best ? {
    lowestActive: Math.round(best.total),
    title: best.title,
    url: best.url,
    count: items.length,
  } : { lowestActive: null, count: 0 };
}

/* Raw candidates (no filtering) — for the AI filter to classify. */
async function searchActiveRaw(query, limit = 30) {
  const token = await getToken();
  const url = `${EBAY_BASE}/buy/browse/v1/item_summary/search`
    + `?q=${encodeURIComponent(query)}`
    + `&filter=${encodeURIComponent('buyingOptions:{FIXED_PRICE}')}`
    + `&sort=price&limit=${limit}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
      'X-EBAY-C-ENDUSERCTX': 'contextualLocation=country=US,zip=10001',
    },
  });
  if (!res.ok) throw new Error('eBay Browse failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const j = await res.json();
  return (j.itemSummaries || []).map((it, i) => {
    const price = parseFloat(it.price && it.price.value) || 0;
    const ship = (it.shippingOptions && it.shippingOptions[0] && it.shippingOptions[0].shippingCost
      && parseFloat(it.shippingOptions[0].shippingCost.value)) || 0;
    return { i, title: it.title, price: Math.round((price + ship) * 100) / 100, url: it.itemWebUrl };
  });
}

async function searchSold(query) {
  const token = await getToken();
  const url = `${EBAY_BASE}/buy/marketplace_insights/v1/item_sales/search`
    + `?q=${encodeURIComponent(query)}&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE },
    });
    if (!res.ok) return { sold: null, note: 'insights-unavailable(' + res.status + ')' };
    const j = await res.json();
    const sales = (j.itemSales || []).filter((s) => looksLikeBox(s.title));
    const prices = sales.map((s) => parseFloat(s.lastSoldPrice && s.lastSoldPrice.value)).filter((n) => !isNaN(n)).sort((a, b) => a - b);
    if (!prices.length) return { sold: null };
    const median = prices[Math.floor(prices.length / 2)];
    return { sold: Math.round(median), soldLow: Math.round(prices[0]), soldHigh: Math.round(prices[prices.length - 1]), n: prices.length };
  } catch (e) {
    return { sold: null, note: 'insights-error' };
  }
}

module.exports = { searchActive, searchActiveRaw, searchSold, getToken, looksLikeBox };
