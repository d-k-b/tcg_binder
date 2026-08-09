(function initPricingClient(root, factory) {
  const contracts = root.TCGPricingContracts ||
    (typeof require === "function" ? require("./pricing-contracts.js") : null);
  const api = factory(contracts);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TCGPricingClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function pricingClientFactory(contracts) {
  "use strict";
  if (!contracts) throw new Error("TCGPricingContracts is required");

  function randomRequestId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
    return "req-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function createClient(options) {
    const runtime = options && options.runtime;
    const extensionId = String(options && options.extensionId || "").trim();
    const apiToken = String(options && options.apiToken || "").trim();
    if (!runtime || typeof runtime.sendMessage !== "function") throw new Error("runtime.sendMessage is required");
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("a 32-character Chrome extension ID is required");
    if (!apiToken) throw new Error("apiToken is required");

    const send = async (type, fields) => {
      const request = {
        apiVersion: contracts.API_VERSION,
        type,
        requestId: randomRequestId(),
        apiToken,
        ...(fields || {})
      };
      return runtime.sendMessage(extensionId, request);
    };
    return {
      status: () => send("pricing.integration.status"),
      priceProduct: (target, requestOptions) => send("pricing.priceProduct", { target, options: requestOptions || {} }),
      listWatches: () => send("pricing.watch.list"),
      upsertWatch: (rule) => send("pricing.watch.upsert", { rule }),
      removeWatch: (watchId) => send("pricing.watch.remove", { watchId }),
      runWatches: (watchId) => send("pricing.watch.run", watchId ? { watchId } : {})
    };
  }

  return { createClient, randomRequestId };
});

