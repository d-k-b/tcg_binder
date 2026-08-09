(function initPricingBridge(root, factory) {
  const contracts = root.TCGPricingContracts ||
    (typeof require === "function" ? require("./pricing-contracts.js") : null);
  const api = factory(contracts);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TCGPricingBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function pricingBridgeFactory(contracts) {
  "use strict";
  if (!contracts) throw new Error("TCGPricingContracts is required");

  const CHANNEL = "tcg-pricing/v1";

  function createDashboardBridge(options) {
    const windowObject = options && options.windowObject;
    const frame = options && options.frame;
    const client = options && options.client;
    const origins = new Set(options && options.allowedOrigins || []);
    if (!windowObject || typeof windowObject.addEventListener !== "function") throw new Error("windowObject is required");
    if (!frame || !frame.contentWindow) throw new Error("dashboard frame is required");
    if (!client) throw new Error("pricing client is required");
    if (!origins.size || [...origins].some((origin) => !/^https?:\/\//.test(origin))) throw new Error("at least one explicit HTTP(S) origin is required");

    const respond = (event, request, payload) => {
      event.source.postMessage({
        channel: CHANNEL,
        type: request.type + "Result",
        requestId: request.requestId || null,
        ...payload
      }, event.origin);
    };

    const listener = async (event) => {
      if (!origins.has(event.origin) || event.source !== frame.contentWindow) return;
      const request = event.data;
      if (!request || request.channel !== CHANNEL || typeof request.type !== "string") return;
      try {
        if (request.type === "priceProduct") {
          const checked = contracts.validateProductRef(request.target);
          if (!checked.ok) return respond(event, request, { error: { code: "INVALID_PRODUCT", message: checked.errors.join("; ") } });
          return respond(event, request, { result: await client.priceProduct(checked.value, request.options || {}) });
        }
        if (request.type === "watchUpsert") return respond(event, request, { result: await client.upsertWatch(request.rule) });
        if (request.type === "watchRemove") return respond(event, request, { result: await client.removeWatch(request.watchId) });
        if (request.type === "watchRun") return respond(event, request, { result: await client.runWatches(request.watchId) });
        respond(event, request, { error: { code: "UNKNOWN_METHOD", message: "Unknown pricing bridge method" } });
      } catch (error) {
        respond(event, request, { error: { code: "BRIDGE_FAILURE", message: String(error && error.message || error) } });
      }
    };

    windowObject.addEventListener("message", listener);
    return {
      dispose() { windowObject.removeEventListener("message", listener); },
      listener
    };
  }

  return { CHANNEL, createDashboardBridge };
});

