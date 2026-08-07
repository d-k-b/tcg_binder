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
    GAMES,
    PRODUCT_TYPES,
    UNITS,
    CONFIDENCE,
    SOURCES,
    validateProductRef,
    validateWatchRule,
    validateApiEnvelope,
    apiError,
    finitePositive
  };
});
