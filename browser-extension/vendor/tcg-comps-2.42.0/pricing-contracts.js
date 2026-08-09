(function initPricingContracts(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TCGPricingContracts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function pricingContractsFactory() {
  "use strict";

  const API_VERSION = 1;
  const PRODUCT_SCHEMA = "tcg.product/v1";
  const VALUATION_SCHEMA = "tcg.valuation/v1";
  const WATCH_SCHEMA = "tcg.watch-rule/v1";
  const ALERT_SCHEMA = "tcg.alert/v1";
  const COLLECTION_SNAPSHOT_SCHEMA = "tcg.collection-snapshot/v2";
  const COLLECTION_DECORATION_RESULT_SCHEMA = "tcg.collection-decoration-result/v2";
  const MONITOR_SUBSCRIPTION_SCHEMA = "tcg.collection-monitor-subscription/v1";
  const MONITOR_SYNC_RESULT_SCHEMA = "tcg.collection-monitor-sync-result/v1";
  const MONITOR_STATUS_SCHEMA = "tcg.collection-monitor-status/v1";
  const MONITOR_RUN_RESULT_SCHEMA = "tcg.collection-monitor-run-result/v1";
  const MAX_COLLECTION_PRODUCTS = 1200;

  const GAMES = new Set(["mtg", "pokemon", "lorcana", "yugioh", "other"]);
  const PRODUCT_TYPES = new Set([
    "booster",
    "collector_booster",
    "draft_booster",
    "play_booster",
    "set_booster",
    "theme_booster",
    "jumpstart_booster",
    "epilogue_booster",
    "beyond_booster",
    "mystery_booster",
    "sample_booster",
    "prerelease_kit",
    "elite_trainer_box",
    "bundle",
    "other_sealed"
  ]);
  const UNITS = new Set(["pack", "kit", "display", "box", "bundle", "case"]);
  const CONFIDENCE = new Set(["low", "medium", "high"]);
  const SOURCES = new Set(["ebay", "tcgplayer", "heritage", "store"]);

  const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const cleanText = (value, max) => String(value == null ? "" : value).trim().slice(0, max);
  const nullableText = (value, max) => {
    const out = cleanText(value, max);
    return out || null;
  };
  const finitePositive = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const finiteRatio = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : null;
  };
  const validProductId = (value) => /^[a-z0-9][a-z0-9:._-]{5,199}$/.test(value || "");

  function validateProductRef(input) {
    const errors = [];
    if (!isObject(input)) return { ok: false, errors: ["product must be an object"], value: null };
    const value = {
      schema: cleanText(input.schema, 40),
      productId: cleanText(input.productId, 200).toLowerCase(),
      game: cleanText(input.game, 30).toLowerCase(),
      setCode: nullableText(input.setCode, 30),
      setName: cleanText(input.setName, 160),
      productName: cleanText(input.productName, 220),
      productType: cleanText(input.productType, 60).toLowerCase(),
      unit: cleanText(input.unit, 30).toLowerCase(),
      language: cleanText(input.language || "en", 20).toLowerCase(),
      variant: nullableText(input.variant, 160)
    };

    if (value.schema !== PRODUCT_SCHEMA) errors.push("schema must be " + PRODUCT_SCHEMA);
    if (!validProductId(value.productId)) errors.push("productId is invalid");
    if (!GAMES.has(value.game)) errors.push("game is unsupported");
    if (!value.setName) errors.push("setName is required");
    if (!value.productName) errors.push("productName is required");
    if (!PRODUCT_TYPES.has(value.productType)) errors.push("productType is unsupported");
    if (!UNITS.has(value.unit)) errors.push("unit is unsupported");
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/.test(value.language)) errors.push("language is invalid");

    return { ok: errors.length === 0, errors, value: errors.length ? null : value };
  }

  function validateWatchRule(input) {
    const errors = [];
    if (!isObject(input)) return { ok: false, errors: ["watch rule must be an object"], value: null };
    const product = validateProductRef(input.product);
    if (!product.ok) errors.push(...product.errors.map((error) => "product: " + error));
    const thresholdInput = isObject(input.threshold) ? input.threshold : {};
    const threshold = {
      maxLandedPrice: finitePositive(thresholdInput.maxLandedPrice),
      maxUnitPrice: finitePositive(thresholdInput.maxUnitPrice),
      maxMarketRatio: finiteRatio(thresholdInput.maxMarketRatio)
    };
    if (!threshold.maxLandedPrice && !threshold.maxUnitPrice && !threshold.maxMarketRatio) {
      errors.push("at least one positive threshold is required");
    }
    const watchId = cleanText(input.watchId, 160);
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{3,159}$/.test(watchId)) errors.push("watchId is invalid");
    const sources = Array.isArray(input.sources)
      ? [...new Set(input.sources.map((source) => cleanText(source, 30).toLowerCase()))]
      : ["ebay", "tcgplayer"];
    if (!sources.length || sources.some((source) => !SOURCES.has(source))) errors.push("sources contain an unsupported value");
    const minimumConfidence = cleanText(input.minimumConfidence || "medium", 20).toLowerCase();
    if (!CONFIDENCE.has(minimumConfidence)) errors.push("minimumConfidence is invalid");
    const cooldown = Number(input.cooldownMinutes == null ? 1440 : input.cooldownMinutes);
    if (!Number.isFinite(cooldown) || cooldown < 1 || cooldown > 525600) errors.push("cooldownMinutes is invalid");
    const deliveryInput = isObject(input.delivery) ? input.delivery : {};
    const value = {
      schema: WATCH_SCHEMA,
      watchId,
      product: product.value,
      enabled: input.enabled !== false,
      threshold,
      sources,
      minimumConfidence,
      cooldownMinutes: Number.isFinite(cooldown) ? Math.round(cooldown) : 1440,
      delivery: {
        chrome: deliveryInput.chrome !== false,
        monitorWebhook: deliveryInput.monitorWebhook === true
      }
    };
    if (!value.delivery.chrome && !value.delivery.monitorWebhook) {
      errors.push("at least one delivery channel is required");
    }
    if (input.schema && input.schema !== WATCH_SCHEMA) errors.push("schema must be " + WATCH_SCHEMA);
    return { ok: errors.length === 0, errors, value: errors.length ? null : value };
  }

  function validateApiEnvelope(input) {
    if (!isObject(input)) return { ok: false, error: "request must be an object" };
    if (Number(input.apiVersion) !== API_VERSION) return { ok: false, error: "unsupported API version" };
    const type = cleanText(input.type, 80);
    if (!type.startsWith("pricing.")) return { ok: false, error: "invalid message type" };
    return {
      ok: true,
      value: {
        ...input,
        apiVersion: API_VERSION,
        type,
        requestId: nullableText(input.requestId, 160),
        apiToken: nullableText(input.apiToken, 300)
      }
    };
  }

  function validateCollectionSnapshot(input) {
    const errors = [];
    if (!isObject(input)) return { ok: false, errors: ["snapshot must be an object"], value: null };
    const schema = cleanText(input.schema, 60);
    const namespace = cleanText(input.namespace, 80).toLowerCase();
    if (schema !== COLLECTION_SNAPSHOT_SCHEMA) errors.push("schema must be " + COLLECTION_SNAPSHOT_SCHEMA);
    if (!/^[a-z0-9][a-z0-9._:-]{1,79}$/.test(namespace)) errors.push("namespace is invalid");
    const source = isObject(input.products) ? input.products : null;
    if (!source) errors.push("products must be a productId-to-status object");
    const entries = source ? Object.entries(source) : [];
    if (!entries.length) errors.push("at least one product status is required");
    if (entries.length > MAX_COLLECTION_PRODUCTS) errors.push("no more than " + MAX_COLLECTION_PRODUCTS + " catalog products are allowed");
    const products = {};
    entries.slice(0, MAX_COLLECTION_PRODUCTS).forEach(([rawProductId, rawStatus]) => {
      const productId = cleanText(rawProductId, 200).toLowerCase();
      if (!validProductId(productId)) { errors.push("productId is invalid: " + cleanText(rawProductId, 60)); return; }
      if (!isObject(rawStatus)) { errors.push(productId + ": status must be an object"); return; }
      const product = validateProductRef(rawStatus.product);
      if (!product.ok) errors.push(...product.errors.map((error) => productId + ": product: " + error));
      if (product.ok && product.value.productId !== productId) errors.push(productId + ": product.productId must equal its catalog key");
      const count = (name) => {
        if (rawStatus[name] == null) return 0;
        const value = Number(rawStatus[name]);
        if (!Number.isInteger(value) || value < 0 || value > 100000) errors.push(productId + ": " + name + " is invalid");
        return Number.isInteger(value) && value >= 0 && value <= 100000 ? value : 0;
      };
      const requirement = cleanText(rawStatus.requirement || "optional", 20).toLowerCase();
      if (!/^(?:required|optional)$/.test(requirement)) errors.push(productId + ": requirement is invalid");
      const target = count("target"), owned = count("owned"), missing = count("missing");
      const status = cleanText(rawStatus.status || (missing > 0 ? "missing" : (owned > 0 ? "owned" : "target")), 20).toLowerCase();
      if (!/^(?:target|owned|missing)$/.test(status)) errors.push(productId + ": status is invalid");
      products[productId] = { product: product.value, status, target, owned, missing, requirement };
    });
    return {
      ok: errors.length === 0,
      errors,
      value: errors.length ? null : { schema: COLLECTION_SNAPSHOT_SCHEMA, namespace, products }
    };
  }

  function validateMonitorSubscription(input) {
    const errors = [];
    if (!isObject(input)) return { ok: false, errors: ["subscription must be an object"], value: null };
    const schema = cleanText(input.schema, 80);
    const namespace = cleanText(input.namespace, 80).toLowerCase();
    const revision = cleanText(input.revision, 200).toLowerCase();
    const generatedAt = cleanText(input.generatedAt, 60);
    if (schema !== MONITOR_SUBSCRIPTION_SCHEMA) errors.push("schema must be " + MONITOR_SUBSCRIPTION_SCHEMA);
    if (!/^[a-z0-9][a-z0-9._:-]{1,79}$/.test(namespace)) errors.push("namespace is invalid");
    if (!/^[a-z0-9][a-z0-9:._-]{7,199}$/.test(revision)) errors.push("revision is invalid");
    if (!generatedAt || !Number.isFinite(Date.parse(generatedAt))) errors.push("generatedAt must be an ISO date-time");

    const rawPreferences = isObject(input.preferences) ? input.preferences : {};
    const rawDigest = isObject(rawPreferences.dailyDigest) ? rawPreferences.dailyDigest : {};
    ["enabled", "includeOptional", "instantFixedPriceEmail"].forEach((field) => {
      if (rawPreferences[field] != null && typeof rawPreferences[field] !== "boolean") errors.push("preferences." + field + " must be boolean");
    });
    if (rawDigest.enabled != null && typeof rawDigest.enabled !== "boolean") errors.push("preferences.dailyDigest.enabled must be boolean");
    const sources = Array.isArray(rawPreferences.sources)
      ? [...new Set(rawPreferences.sources.map((source) => cleanText(source, 30).toLowerCase()))]
      : ["ebay", "tcgplayer", "heritage", "store"];
    const minimumConfidence = cleanText(rawPreferences.minimumConfidence || "medium", 20).toLowerCase();
    const maxMarketRatio = finiteRatio(rawPreferences.maxMarketRatio == null ? 0.8 : rawPreferences.maxMarketRatio);
    const digestTime = cleanText(rawDigest.time || "07:00", 5);
    const timezone = cleanText(rawDigest.timezone || "America/Chicago", 80);
    if (!maxMarketRatio) errors.push("preferences.maxMarketRatio must be greater than 0 and no more than 1");
    if (!CONFIDENCE.has(minimumConfidence)) errors.push("preferences.minimumConfidence is invalid");
    if (!sources.length || sources.some((source) => !SOURCES.has(source))) errors.push("preferences.sources contain an unsupported value");
    if (!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(digestTime)) errors.push("preferences.dailyDigest.time is invalid");
    if (timezone !== "America/Chicago") errors.push("preferences.dailyDigest.timezone must be America/Chicago for v1");

    const collection = validateCollectionSnapshot(input.collection);
    if (!collection.ok) errors.push(...collection.errors.map((error) => "collection: " + error));
    if (collection.ok && collection.value.namespace !== namespace) errors.push("collection.namespace must equal subscription namespace");

    const preferences = {
      enabled: rawPreferences.enabled !== false,
      maxMarketRatio: maxMarketRatio || 0.8,
      minimumConfidence,
      sources,
      includeOptional: rawPreferences.includeOptional === true,
      instantFixedPriceEmail: rawPreferences.instantFixedPriceEmail !== false,
      dailyDigest: {
        enabled: rawDigest.enabled !== false,
        time: digestTime,
        timezone
      }
    };
    return {
      ok: errors.length === 0,
      errors,
      value: errors.length ? null : {
        schema: MONITOR_SUBSCRIPTION_SCHEMA,
        namespace,
        revision,
        generatedAt: new Date(generatedAt).toISOString(),
        preferences,
        collection: collection.value
      }
    };
  }

  function activeMonitorTargets(subscription) {
    const checked = validateMonitorSubscription(subscription);
    if (!checked.ok || !checked.value.preferences.enabled) return [];
    const includeOptional = checked.value.preferences.includeOptional;
    return Object.values(checked.value.collection.products).filter((status) =>
      status.missing > 0 && (status.requirement === "required" || includeOptional)
    );
  }

  function apiError(code, message, requestId) {
    return {
      apiVersion: API_VERSION,
      requestId: requestId || null,
      error: { code: cleanText(code, 80), message: cleanText(message, 500) }
    };
  }

  return {
    API_VERSION,
    PRODUCT_SCHEMA,
    VALUATION_SCHEMA,
    WATCH_SCHEMA,
    ALERT_SCHEMA,
    COLLECTION_SNAPSHOT_SCHEMA,
    COLLECTION_DECORATION_RESULT_SCHEMA,
    MONITOR_SUBSCRIPTION_SCHEMA,
    MONITOR_SYNC_RESULT_SCHEMA,
    MONITOR_STATUS_SCHEMA,
    MONITOR_RUN_RESULT_SCHEMA,
    MAX_COLLECTION_PRODUCTS,
    GAMES,
    PRODUCT_TYPES,
    UNITS,
    CONFIDENCE,
    SOURCES,
    validateProductRef,
    validateWatchRule,
    validateApiEnvelope,
    validateCollectionSnapshot,
    validateMonitorSubscription,
    activeMonitorTargets,
    apiError,
    finitePositive
  };
});
