#!/usr/bin/env node

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE_APP = path.join(ROOT, "node-app");
const { CollectionAuthorityClient } = require(path.join(NODE_APP, "lib", "collection-authority-client.js"));
const DEFAULT_MONITOR_ENV = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
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
// Fanatics Collect is the live successor to PWCC.  The monitor enables the
// auction houses through its fail-closed sanitized feed adapters; no account
// session is required for public discovery/history.
const AUCTION_MONITOR_SOURCES = ["heritage", "fanatics", "hakes", "goldin", "pristine", "hibid"];

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

function expectedProductCount(binder) {
  return (binder.checklists || [])
    .filter((checklist) => CHECKLISTS.has(checklist.id))
    .reduce((total, checklist) => total + (checklist.eras || []).reduce((eraTotal, era) => eraTotal
      + (era.items || []).reduce((itemTotal, item) => itemTotal + (item.pricingProducts || []).length, 0), 0), 0);
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
  const expectedCount = expectedProductCount(binder);
  if (Object.keys(products).length !== expectedCount) throw new Error(`expected ${expectedCount} ProductRefs, found ${Object.keys(products).length}`);
  if (!remote.updatedAt || !Number.isFinite(Date.parse(remote.updatedAt))) throw new Error("Gist ownership snapshot has no trustworthy updatedAt timestamp");
  if (!matchedRemoteKeys.length) throw new Error("Gist ownership keys do not match the current v2 catalog; refusing an all-missing sync");
  const collection = { schema: "tcg.collection-snapshot/v2", namespace: "collection-tracker", products };
  const preferences = {
    enabled: true,
    maxMarketRatio: COLLECTION_TARGET_MAX_MARKET_RATIO,
    buyAnywayMaxMarketRatio: BUY_ANYWAY_MAX_MARKET_RATIO,
    loosePackMaxMarketRatio: LOOSE_PACK_MAX_MARKET_RATIO,
    minimumConfidence: "medium",
    sources: ["ebay", "tcgplayer", ...AUCTION_MONITOR_SOURCES, "craigslist", "store"],
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

function buildSubscriptionFromAuthority(response, generatedAt = new Date().toISOString()) {
  if (!response || response.schema !== "tcg.collection-snapshot-response/v1" ||
      !response.snapshot || response.snapshot.schema !== "tcg.collection-snapshot/v2") {
    throw new Error("collection authority returned an unsupported snapshot contract");
  }
  if (Object.keys(response.snapshot.products || {}).length !== 689) {
    throw new Error("collection authority snapshot is incomplete; refusing monitor update");
  }
  const authority = response.authority && typeof response.authority === "object" ? response.authority : {};
  const cache = response.cache && typeof response.cache === "object" ? response.cache : {};
  const authoritative = authority.state === "fresh" && authority.consumerStatus === "AUTHORITATIVE" &&
    cache.mode === "snapshot-refresh" && cache.eligibleForMutation === true;
  const ownershipPolicy = {
    schema: "tcg.collection-ownership-policy/v1",
    snapshotRevision: response.revision,
    consumerStatus: authoritative ? "AUTHORITATIVE" : "CONDITIONAL",
    reviewOnly: !authoritative,
    mayInferOwnership: authoritative,
    eligibleForAction: authoritative,
    degradedReasonCodes: [...new Set(Array.isArray(authority.degradedReasonCodes)
      ? authority.degradedReasonCodes.filter((code) => typeof code === "string" && code.length <= 80)
      : [])].slice(0, 20),
    verifiedAt: response.generatedAt,
    oldestSourceAt: typeof authority.oldestSourceAt === "string" ? authority.oldestSourceAt : null,
    maxAgeMs: Number.isInteger(authority.maxAgeMs) && authority.maxAgeMs >= 0 ? authority.maxAgeMs : null
  };
  const preferences = {
    enabled: authoritative,
    maxMarketRatio: COLLECTION_TARGET_MAX_MARKET_RATIO,
    buyAnywayMaxMarketRatio: BUY_ANYWAY_MAX_MARKET_RATIO,
    loosePackMaxMarketRatio: LOOSE_PACK_MAX_MARKET_RATIO,
    minimumConfidence: "medium",
    sources: ["ebay", "tcgplayer", ...AUCTION_MONITOR_SOURCES, "craigslist", "store"],
    includeOptional: false,
    instantFixedPriceEmail: authoritative,
    dailyDigest: { enabled: authoritative && BACKGROUND_DAILY_DIGEST_ENABLED, time: "09:00", timezone: "America/Chicago" }
  };
  const collection = {
    schema: response.snapshot.schema,
    namespace: response.snapshot.namespace,
    products: response.snapshot.products
  };
  const revisionPolicy = { ...ownershipPolicy };
  delete revisionPolicy.verifiedAt;
  delete revisionPolicy.oldestSourceAt;
  const revision = `${authoritative ? "authoritative" : "conditional"}:${contentHash(stableValue({ preferences, collection, ownershipPolicy: revisionPolicy }))}`;
  return {
    subscription: { schema: "tcg.collection-monitor-subscription/v1", namespace: "collection-tracker", revision, generatedAt, preferences, collection, ownershipPolicy },
    requestedPreferences: {
      ...preferences,
      enabled: true,
      instantFixedPriceEmail: true,
      dailyDigest: { ...preferences.dailyDigest, enabled: BACKGROUND_DAILY_DIGEST_ENABLED }
    },
    evidence: {
      source: "collection-authority-api",
      snapshotUpdatedAt: response.generatedAt,
      snapshotRevision: response.revision,
      ownershipStatus: ownershipPolicy.consumerStatus,
      reviewOnly: ownershipPolicy.reviewOnly,
      effectiveMonitorEnabled: preferences.enabled,
      degradedReasonCodes: ownershipPolicy.degradedReasonCodes,
      lanes: response.snapshot.lanes
    }
  };
}

function stableValue(value) {
  return Array.isArray(value) ? `[${value.map(stableValue).join(",")}]`
    : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`
      : JSON.stringify(value);
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
  const expectedCount = expectedProductCount(JSON.parse(fs.readFileSync(path.join(NODE_APP, "data", "binder_data.json"), "utf8")));
  if (expectedCount !== 689) throw new Error(`current Tracker ProductRef catalog regression: expected 689, found ${expectedCount}`);
  const products = {};
  for (let index = 0; index < 689; index += 1) products[`fixture:${index}`] = { product: { productId: `fixture:${index}` }, target: 1, owned: 0, missing: 1, requirement: "required", status: "missing" };
  const conditionalSnapshotFixture = {
    schema: "tcg.collection-snapshot-response/v1", generatedAt: new Date().toISOString(), revision: "a".repeat(64),
    authority: { state: "stale", consumerStatus: "CONDITIONAL", degradedReasonCodes: ["COLLECTION_SNAPSHOT_STALE"], oldestSourceAt: "2026-07-19T16:47:29.183Z" },
    cache: { mode: "snapshot-refresh", eligibleForMutation: true },
    snapshot: { schema: "tcg.collection-snapshot/v2", revision: "a".repeat(64), products, lanes: {} }
  };
  const authorityFixture = buildSubscriptionFromAuthority(conditionalSnapshotFixture);
  if (authorityFixture.evidence.ownershipStatus !== "CONDITIONAL" || authorityFixture.evidence.reviewOnly !== true ||
      authorityFixture.subscription.preferences.enabled !== false || authorityFixture.subscription.ownershipPolicy.eligibleForAction !== false ||
      !authorityFixture.subscription.revision.startsWith("conditional:") || Object.keys(authorityFixture.subscription.collection.products).length !== 689) {
    throw new Error("collection authority monitor-consumer regression");
  }
  const laterAuthorityFixture = buildSubscriptionFromAuthority({
    ...conditionalSnapshotFixture, generatedAt: "2026-09-04T04:00:00.000Z"
  }, "2026-09-04T04:00:01.000Z");
  if (laterAuthorityFixture.subscription.revision !== authorityFixture.subscription.revision ||
      laterAuthorityFixture.subscription.ownershipPolicy.verifiedAt === authorityFixture.subscription.ownershipPolicy.verifiedAt) {
    throw new Error("monitor revision must ignore observation time while retaining current verification evidence");
  }
  if (!["fanatics", "hakes", "goldin", "pristine", "hibid"].every((source) => authorityFixture.subscription.preferences.sources.includes(source)) ||
      authorityFixture.subscription.preferences.sources.includes("pwcc")) {
    throw new Error("auction-house monitor source subscription regression");
  }
  console.log("Local monitor Gist sync self-test passed");
  process.exit(0);
}

if (process.argv.includes("--export")) throw new Error("direct Tracker exports are no longer a monitor authority; use the authenticated collection authority API");
const monitorEnvPath = argumentValue("--env") || DEFAULT_MONITOR_ENV;
const monitorEnv = parseEnv(fs.readFileSync(monitorEnvPath, "utf8"));
const authorityClient = new CollectionAuthorityClient({
  baseUrl: monitorEnv.TCG_COLLECTION_AUTHORITY_URL || "http://127.0.0.1:3102",
  token: monitorEnv.TCG_COLLECTION_AUTHORITY_TOKEN,
  attempts: 6,
  baseDelayMs: 500
});
const result = buildSubscriptionFromAuthority(await authorityClient.snapshot());
if (process.argv.includes("--dry-run")) {
  console.log(JSON.stringify({ revision: result.subscription.revision, productCount: Object.keys(result.subscription.collection.products).length, ...result.evidence }, null, 2));
  process.exit(0);
}
const reply = await authorityClient.syncMonitor(result.requestedPreferences);
console.log(JSON.stringify({
  accepted: true,
  revision: reply.revision,
  productCount: reply.productCount,
  activeTargetCount: reply.activeTargetCount,
  requestedMonitorEnabled: reply.requestedMonitorEnabled,
  effectiveMonitorEnabled: reply.effectiveMonitorEnabled,
  ownershipPolicy: reply.ownershipPolicy,
  authorityCache: reply.authorityCache,
  ...result.evidence
}, null, 2));
