#!/usr/bin/env node

// Validates a public, sanitized HiBid Texas lot capture before atomically
// installing it for the local monitor. This consumes structured lot facts
// rather than scraping around Cloudflare or retaining browser state.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FEED_SCHEMA = "tcg.hibid-texas-feed/v1";
const DEFAULT_OUTPUT = "/Users/dkb/.config/tcg-price-monitor/data/hibid-texas-lots.json";
const money = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
};
const premiumRate = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
};
const text = (value, maximum = 500) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maximum);
const iso = (value, fallback = null) => Number.isFinite(Date.parse(value || "")) ? new Date(value).toISOString() : fallback;

function canonicalHiBidTexasLotUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "hibid.com" || !/^\/texas\/lot\/[a-z0-9-]+/i.test(parsed.pathname)) return null;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) if (/^(?:lid|utm_|source|ref|tracking|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.href;
  } catch (_error) { return null; }
}

function assertNoSecrets(value, location = "feed") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/password|passwd|cookie|session|authorization|access.?token|refresh.?token|client.?secret/i.test(key)) throw new Error(`${location} contains forbidden credential-like field ${key}`);
    if (child && typeof child === "object") assertNoSecrets(child, `${location}.${key}`);
  }
}

function normalizeLot(row, index, generatedAt) {
  const listingId = text(row && row.listingId, 160);
  const title = text(row && row.title, 300);
  const url = canonicalHiBidTexasLotUrl(row && row.url);
  const currentBid = money(row && (row.currentBid == null ? row.price : row.currentBid));
  const buyerPremiumRate = premiumRate(row && row.buyerPremiumRate);
  const buyerPremiumMinimum = money(row && row.buyerPremiumMinimum);
  const endTime = iso(row && row.endTime);
  if (!listingId) throw new Error(`lots[${index}].listingId is required`);
  if (!title) throw new Error(`lots[${index}].title is required`);
  if (!url) throw new Error(`lots[${index}].url must be a canonical HiBid Texas HTTPS lot URL`);
  if (currentBid == null) throw new Error(`lots[${index}].currentBid must be a non-negative amount`);
  if (row && row.buyerPremiumRate != null && buyerPremiumRate == null) throw new Error(`lots[${index}].buyerPremiumRate must be between 0 and 1`);
  if (!endTime) throw new Error(`lots[${index}].endTime must be an ISO date-time`);
  return {
    listingId, title, url, currentBid, nextBid: money(row && row.nextBid), shipping: money(row && row.shipping), buyerPremium: money(row && row.buyerPremium), buyerPremiumRate, buyerPremiumMinimum,
    bidCount: Number.isInteger(Number(row && row.bidCount)) ? Number(row.bidCount) : null, endTime,
    observedAt: iso(row && row.observedAt, generatedAt), reserveStatus: text(row && row.reserveStatus, 80) || null,
    reservePriceMet: typeof (row && row.reservePriceMet) === "boolean" ? row.reservePriceMet : null, available: row && row.available !== false,
    provenance: { auctioneer: text(row && row.auctioneer, 160) || null, catalogId: text(row && row.catalogId, 100) || null, softClose: typeof (row && row.softClose) === "boolean" ? row.softClose : null, shippingAvailable: typeof (row && row.shippingAvailable) === "boolean" ? row.shippingAvailable : null }
  };
}

function normalizeFeed(input, options = {}) {
  assertNoSecrets(input);
  const document = Array.isArray(input) ? { lots: input } : input;
  if (!document || typeof document !== "object" || !Array.isArray(document.lots)) throw new Error("input must be a JSON array or an object with a lots array");
  const generatedAt = iso(options.generatedAt || document.generatedAt, new Date().toISOString());
  const lots = document.lots.map((row, index) => normalizeLot(row, index, generatedAt));
  const duplicateIds = lots.map((row) => row.listingId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`duplicate HiBid listingId values: ${[...new Set(duplicateIds)].join(", ")}`);
  return { schema: FEED_SCHEMA, generatedAt, lots };
}

function atomicWrite(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(resolved), `.hibid-texas-lots.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, resolved);
    fs.chmodSync(resolved, 0o600);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes("--self-test")) {
  const feed = normalizeFeed({ generatedAt: "2026-09-02T14:00:00Z", lots: [{ listingId: "773733-42", title: "Magic: The Gathering sealed booster display", url: "https://hibid.com/texas/lot/773733042/magic-booster-display?utm_source=mail", currentBid: 50, nextBid: 55, buyerPremium: 7.5, buyerPremiumRate: 0.15, shipping: 12, endTime: "2026-09-02T17:00:00Z", softClose: true }] });
  if (feed.lots[0].url.includes("?")) throw new Error("HiBid canonical URL regression");
  if (feed.lots[0].buyerPremium !== 7.5) throw new Error("HiBid explicit-premium regression");
  if (feed.lots[0].buyerPremiumRate !== 0.15) throw new Error("HiBid buyer-premium-rate regression");
  let rejectedRate = false;
  try { normalizeFeed({ lots: [{ ...feed.lots[0], buyerPremiumRate: 1.2 }] }); } catch (_error) { rejectedRate = true; }
  if (!rejectedRate) throw new Error("HiBid invalid premium-rate rejection regression");
  let rejectedSecret = false;
  try { normalizeFeed({ lots: [], sessionCookie: "forbidden" }); } catch (_error) { rejectedSecret = true; }
  if (!rejectedSecret) throw new Error("HiBid secret-field rejection regression");
  console.log("HiBid Texas feed updater self-test passed");
  process.exit(0);
}

const inputPath = argument("--input");
if (!inputPath) throw new Error("--input requires a JSON file exported by a trusted public/browser HiBid lot capture");
const outputPath = argument("--output") || DEFAULT_OUTPUT;
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const feed = normalizeFeed(input);
if (process.argv.includes("--check")) {
  console.log(`HiBid Texas feed is valid: ${feed.lots.length} lots; generated ${feed.generatedAt}. No file was written.`);
  process.exit(0);
}
atomicWrite(outputPath, feed);
console.log(`HiBid Texas feed updated atomically: ${feed.lots.length} lots. No credentials were read or stored.`);

export { FEED_SCHEMA, normalizeFeed, canonicalHiBidTexasLotUrl };
