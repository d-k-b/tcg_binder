#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_APP = path.join(ROOT, "node-app");
const MONITOR_ENV = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
const CHECKLISTS = new Set(["collector", "boxes", "packs", "prerelease", "lorcana", "lorcana_pre", "lorcana_coll"]);
// Complete missing collection targets at verified exact Market after required
// landed costs; deal discounts belong only to discretionary acquisition profiles.
const COLLECTION_TARGET_MAX_MARKET_RATIO = 1.0;
// Exact products already owned remain a separate discretionary lane. They are
// retained only when the verified landed cost is at least 50% below Market.
const BUY_ANYWAY_MAX_MARKET_RATIO = 0.5;
// Loose MTG booster packs are deliberately de-prioritized until the physical
// inventory is sorted. Keep only a verified 25%+ discount; Collector Booster
// packs remain subject to the provider's stricter 70% rip/gift profile.
const LOOSE_PACK_MAX_MARKET_RATIO = 0.75;
const BACKGROUND_DAILY_DIGEST_ENABLED = false;

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a file path`);
  return value;
}

function readTrackerExport(exportPath) {
  const resolved = path.resolve(exportPath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Tracker export path is not a file");
  const exported = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (!exported || typeof exported !== "object" || Array.isArray(exported)) throw new Error("Tracker export must be a JSON object");
  if (!exported.checks || typeof exported.checks !== "object" || Array.isArray(exported.checks)) throw new Error("Tracker export has no checks object");
  if (!exported.extras || typeof exported.extras !== "object" || Array.isArray(exported.extras)) throw new Error("Tracker export has no extras object");
  return { ...exported, source: "tracker-export", updatedAt: stat.mtime.toISOString() };
}

function norm(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function contentHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function keyFor(checklistId, item, slotIndex) {
  const slot = item.slots[slotIndex];
  const group = norm(slot.k || slot.g || slot.l);
  const ordinal = item.slots.slice(0, slotIndex).filter((candidate) => norm(candidate.k || candidate.g || candidate.l) === group).length;
  return `${checklistId}|v2|${contentHash([norm(checklistId), norm(item.name), norm(item.code), group, ordinal].join("\u001f"))}`;
}

function groupKeyFor(checklistId, item, group) {
  return `${checklistId}|extra|${contentHash([norm(checklistId), norm(item.name), norm(item.code), norm(group)].join("\u001f"))}`;
}

function slotExtraKeyFor(checklistId, item, slotIndex) {
  return `${checklistId}|slot-extra|${keyFor(checklistId, item, slotIndex).split("|").pop()}`;
}

function groupedSlots(item) {
  const copies = item.slots.length > 1 && item.slots.every((slot) => /^Kid\s+\d+$/i.test(slot.g || slot.l || ""));
  const groups = [];
  item.slots.forEach((slot, slotIndex) => {
    const name = copies ? "Copies" : (slot.g || slot.l || "");
    let group = groups.find((candidate) => candidate.name === name);
    if (!group) { group = { name, key: slot.k || name, items: [] }; groups.push(group); }
    group.items.push({ slot, slotIndex });
  });
  return groups;
}

function buildSubscription(binder, remote, generatedAt = new Date().toISOString()) {
  const checks = remote.checks || {};
  const extras = remote.extras || {};
  const products = {};
  const lanes = {};
  const knownKeys = new Set();
  const slotQuantity = (checklistId, item, slotIndex) => {
    const key = keyFor(checklistId, item, slotIndex);
    const extraKey = slotExtraKeyFor(checklistId, item, slotIndex);
    knownKeys.add(key); knownKeys.add(extraKey);
    return (checks[key] ? 1 : 0) + Math.max(0, Number(extras[extraKey] || 0));
  };
  for (const checklist of binder.checklists || []) {
    if (!CHECKLISTS.has(checklist.id)) continue;
    lanes[checklist.id] = { required: 0, owned: 0, missing: 0 };
    for (const era of checklist.eras || []) for (const item of era.items || []) {
      const groups = groupedSlots(item);
      for (const record of item.pricingProducts || []) {
        const product = JSON.parse(JSON.stringify(record.ref));
        let target;
        let owned;
        if (Object.prototype.hasOwnProperty.call(record, "slotOrdinal")) {
          const slotIndex = record.slotOrdinal;
          if (!Number.isInteger(slotIndex) || !item.slots[slotIndex]) throw new Error(`${product.productId}: invalid slotOrdinal`);
          target = item.slots[slotIndex].r === false ? 0 : 1;
          owned = slotQuantity(checklist.id, item, slotIndex);
        } else {
          const matches = groups.filter((group) => group.name === record.slotGroup);
          if (matches.length !== 1) throw new Error(`${product.productId}: slotGroup must map to exactly one group`);
          const group = matches[0];
          target = group.items.filter(({ slot }) => slot.r !== false).length;
          const checked = group.items.filter(({ slotIndex }) => {
            const key = keyFor(checklist.id, item, slotIndex); knownKeys.add(key); return !!checks[key];
          }).length;
          if (checklist.progressMode === "distinct_variants") {
            owned = group.items.reduce((total, { slotIndex }) => total + slotQuantity(checklist.id, item, slotIndex), 0);
          } else {
            const extraKey = groupKeyFor(checklist.id, item, group.key); knownKeys.add(extraKey);
            owned = checked + Math.max(0, Number(extras[extraKey] || 0));
          }
        }
        const missing = Math.max(target - owned, 0);
        const requirement = target > 0 ? "required" : "optional";
        const status = missing > 0 ? "missing" : (owned > 0 ? "owned" : "target");
        if (products[product.productId]) throw new Error(`duplicate ProductRef ${product.productId}`);
        products[product.productId] = { product, target, owned, missing, requirement, status };
        if (requirement === "required") {
          lanes[checklist.id].required += target;
          lanes[checklist.id].owned += Math.min(owned, target);
          lanes[checklist.id].missing += missing;
        }
      }
    }
  }
  const activeRemoteKeys = [...Object.keys(checks), ...Object.keys(extras)].filter((key) => checks[key] || Number(extras[key]) > 0);
  const matchedRemoteKeys = activeRemoteKeys.filter((key) => knownKeys.has(key));
  if (Object.keys(products).length !== 686) throw new Error(`expected 686 ProductRefs, found ${Object.keys(products).length}`);
  if (!remote.updatedAt || !Number.isFinite(Date.parse(remote.updatedAt))) throw new Error("Gist ownership snapshot has no trustworthy updatedAt timestamp");
  if (!matchedRemoteKeys.length) throw new Error("Gist ownership keys do not match the current v2 catalog; refusing an all-missing sync");
  const collection = { schema: "tcg.collection-snapshot/v2", namespace: "collection-tracker", products };
  const preferences = {
    enabled: true,
    maxMarketRatio: COLLECTION_TARGET_MAX_MARKET_RATIO,
    buyAnywayMaxMarketRatio: BUY_ANYWAY_MAX_MARKET_RATIO,
    loosePackMaxMarketRatio: LOOSE_PACK_MAX_MARKET_RATIO,
    minimumConfidence: "medium",
    sources: ["ebay", "tcgplayer", "heritage", "store"],
    includeOptional: false,
    instantFixedPriceEmail: true,
    // The always-on collector is capture-only unless a direct provider is
    // explicitly configured.  The connected Gmail heartbeat owns the complete
    // daily digest; the collector retains only urgent events for that bridge.
    dailyDigest: { enabled: BACKGROUND_DAILY_DIGEST_ENABLED, time: "09:00", timezone: "America/Chicago" }
  };
  const stable = (value) => Array.isArray(value) ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
      : JSON.stringify(value);
  const revision = contentHash(stable({ preferences, collection }));
  return {
    subscription: { schema: "tcg.collection-monitor-subscription/v1", namespace: "collection-tracker", revision, generatedAt, preferences, collection },
    evidence: { source: remote.source || "gist", snapshotUpdatedAt: remote.updatedAt, activeRemoteKeyCount: activeRemoteKeys.length, matchedRemoteKeyCount: matchedRemoteKeys.length, lanes }
  };
}

if (process.argv.includes("--self-test")) {
  if (contentHash("test") !== "f9e6e6ef197c2b25") throw new Error("content hash regression");
  if (COLLECTION_TARGET_MAX_MARKET_RATIO !== 1) throw new Error("missing collection targets must allow verified exact Market after landed costs");
  if (BUY_ANYWAY_MAX_MARKET_RATIO !== 0.5) throw new Error("already-owned buy-anyway products must require a 50% verified Market discount");
  if (LOOSE_PACK_MAX_MARKET_RATIO !== 0.75) throw new Error("ordinary loose MTG booster packs must require a 25% verified Market discount while pack inventory is unquantified");
  if (BACKGROUND_DAILY_DIGEST_ENABLED !== false) {
    throw new Error("capture-only monitor must leave consolidated daily delivery to the Gmail heartbeat bridge");
  }
  const sample = { slots: [{ l: "Display", g: "Display" }] };
  if (!/^collector\|v2\|[0-9a-f]{16}$/.test(keyFor("collector", { ...sample, name: "Test", code: "TST" }, 0))) throw new Error("v2 key regression");
  const fixturePath = path.join(process.cwd(), ".tracker-export-self-test.json");
  fs.writeFileSync(fixturePath, JSON.stringify({ checks: {}, extras: {} }), { mode: 0o600 });
  try {
    const exported = readTrackerExport(fixturePath);
    if (exported.source !== "tracker-export" || !Number.isFinite(Date.parse(exported.updatedAt))) throw new Error("Tracker export evidence regression");
  } finally {
    fs.unlinkSync(fixturePath);
  }
  console.log("Local monitor Gist sync self-test passed");
  process.exit(0);
}

const trackerExportPath = argumentValue("--export");
let remote;
if (trackerExportPath) {
  remote = readTrackerExport(trackerExportPath);
} else {
  const nodeEnvPath = path.join(NODE_APP, ".env");
  if (fs.existsSync(nodeEnvPath)) {
    const localEnv = parseEnv(fs.readFileSync(nodeEnvPath, "utf8"));
    for (const [key, value] of Object.entries(localEnv)) if (process.env[key] === undefined) process.env[key] = value;
  }
  if (!process.env.GITHUB_TOKEN) throw new Error("node-app/.env does not contain GITHUB_TOKEN; use --export <Tracker progress JSON> for a browser-authenticated snapshot");
  const gist = require(path.join(NODE_APP, "lib", "gist.js"));
  remote = await gist.read();
}
const binder = JSON.parse(fs.readFileSync(path.join(NODE_APP, "data", "binder_data.json"), "utf8"));
const result = buildSubscription(binder, remote);
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ revision: result.subscription.revision, productCount: Object.keys(result.subscription.collection.products).length, ...result.evidence }, null, 2));
  process.exit(0);
}
const monitorEnv = parseEnv(fs.readFileSync(MONITOR_ENV, "utf8"));
const response = await fetch("http://127.0.0.1:3099/v1/collection-subscription", {
  method: "PUT",
  headers: { Authorization: `Bearer ${monitorEnv.TCG_MONITOR_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(result.subscription)
});
const reply = await response.json().catch(() => ({}));
if (!response.ok || reply.accepted !== true || reply.revision !== result.subscription.revision) {
  throw new Error(`monitor rejected collection subscription (HTTP ${response.status})`);
}
console.log(JSON.stringify({ accepted: true, revision: result.subscription.revision, productCount: Object.keys(result.subscription.collection.products).length, activeTargetCount: reply.activeTargetCount, ...result.evidence }, null, 2));
