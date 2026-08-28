#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const FEED_SCHEMA = "tcg.heritage-feed/v1";
const DEFAULT_OUTPUT = "/Users/dkb/.config/tcg-price-monitor/data/heritage-lots.json";
const DEFAULT_PREMIUM_RATE = 0.25;
const DEFAULT_PREMIUM_MINIMUM = 49;

function money(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function text(value, maximum = 500) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maximum);
}

function iso(value, fallback = null) {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;
}

function canonicalHeritageUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !/(^|\.)(?:ha|heritageauctions)\.com$/i.test(parsed.hostname)) return null;
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:ic|ic4|ic16|utm_|source|ref)/i.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.href;
  } catch (_error) {
    return null;
  }
}

function assertNoSecrets(value, location = "feed") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/password|passwd|cookie|session|authorization|access.?token|refresh.?token|client.?secret/i.test(key)) {
      throw new Error(`${location} contains forbidden credential-like field ${key}`);
    }
    if (child && typeof child === "object") assertNoSecrets(child, `${location}.${key}`);
  }
}

function normalizeLot(row, index, generatedAt, premiumRate, premiumMinimum) {
  const listingId = text(row && row.listingId, 160);
  const title = text(row && row.title, 300);
  const url = canonicalHeritageUrl(row && row.url);
  const currentBid = money(row && row.currentBid);
  const endTime = iso(row && row.endTime);
  if (!listingId) throw new Error(`lots[${index}].listingId is required`);
  if (!title) throw new Error(`lots[${index}].title is required`);
  if (!url) throw new Error(`lots[${index}].url must be a canonical Heritage HTTPS lot URL`);
  if (currentBid == null) throw new Error(`lots[${index}].currentBid must be a non-negative amount`);
  if (!endTime) throw new Error(`lots[${index}].endTime must be an ISO date-time`);
  const explicitPremium = money(row && row.buyerPremium);
  const buyerPremium = explicitPremium == null ? Math.max(Math.round(currentBid * premiumRate * 100) / 100, premiumMinimum) : explicitPremium;
  return {
    listingId,
    title,
    url,
    currentBid,
    nextBid: money(row && row.nextBid),
    shipping: money(row && row.shipping),
    buyerPremium,
    bidCount: Number.isInteger(Number(row && row.bidCount)) ? Number(row.bidCount) : null,
    endTime,
    observedAt: iso(row && row.observedAt, generatedAt),
    reserveStatus: text(row && row.reserveStatus, 80) || null,
    reservePriceMet: typeof (row && row.reservePriceMet) === "boolean" ? row.reservePriceMet : null,
    bidStatus: text(row && row.bidStatus, 80) || null,
    secretMaximum: money(row && row.secretMaximum),
    marketplaceWatchState: text(row && row.marketplaceWatchState, 80) || null,
    available: row && row.available !== false,
    provenance: row && row.provenance && typeof row.provenance === "object" ? row.provenance : {}
  };
}

function normalizeFeed(input, options = {}) {
  assertNoSecrets(input);
  const document = Array.isArray(input) ? { lots: input } : input;
  if (!document || typeof document !== "object" || !Array.isArray(document.lots)) throw new Error("input must be a JSON array or an object with a lots array");
  const generatedAt = iso(options.generatedAt || document.generatedAt, new Date().toISOString());
  const premiumRate = Number.isFinite(Number(options.premiumRate)) ? Number(options.premiumRate) : DEFAULT_PREMIUM_RATE;
  const premiumMinimum = money(options.premiumMinimum) ?? DEFAULT_PREMIUM_MINIMUM;
  if (premiumRate < 0 || premiumRate > 1) throw new Error("premium rate must be between 0 and 1");
  const lots = document.lots.map((row, index) => normalizeLot(row, index, generatedAt, premiumRate, premiumMinimum));
  const duplicateIds = lots.map((row) => row.listingId).filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicateIds.length) throw new Error(`duplicate Heritage listingId values: ${[...new Set(duplicateIds)].join(", ")}`);
  return { schema: FEED_SCHEMA, generatedAt, premiumRate, premiumMinimum, lots };
}

function atomicWrite(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(resolved), `.heritage-lots.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temp, resolved);
    fs.chmodSync(resolved, 0o600);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv.includes("--self-test")) {
  const feed = normalizeFeed({ generatedAt: "2026-08-18T12:00:00Z", lots: [{
    listingId: "43233-73179",
    title: "Disney Lorcana sealed lot",
    url: "https://entertainment.ha.com/itm/example/a/43233-73179.s?ic=tracking",
    currentBid: 1,
    shipping: 12,
    endTime: "2026-08-19T03:00:00Z"
  }] });
  if (feed.lots[0].buyerPremium !== 49) throw new Error("Heritage minimum premium regression");
  if (feed.lots[0].url.includes("?")) throw new Error("Heritage canonical URL regression");
  let rejectedSecret = false;
  try { normalizeFeed({ lots: [], sessionCookie: "forbidden" }); } catch (_error) { rejectedSecret = true; }
  if (!rejectedSecret) throw new Error("Heritage secret-field rejection regression");
  console.log("Heritage feed updater self-test passed");
  process.exit(0);
}

const inputPath = argument("--input");
if (!inputPath) throw new Error("--input requires a JSON file exported by the trusted Heritage capture/session bridge");
const outputPath = argument("--output") || DEFAULT_OUTPUT;
const premiumRate = argument("--premium-rate");
const premiumMinimum = argument("--premium-minimum");
const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), "utf8"));
const feed = normalizeFeed(input, { premiumRate, premiumMinimum });
if (process.argv.includes("--check")) {
  console.log(`Heritage feed is valid: ${feed.lots.length} lots; generated ${feed.generatedAt}. No file was written.`);
  process.exit(0);
}
atomicWrite(outputPath, feed);
console.log(`Heritage feed updated atomically: ${feed.lots.length} lots. No credentials were read or stored.`);

export { FEED_SCHEMA, normalizeFeed, canonicalHeritageUrl };
