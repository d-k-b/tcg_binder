(function initTCGPricingRestClient(root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TCGPricingRestClient = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function pricingRestClientFactory(root) {
  "use strict";

  const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

  class PricingRestError extends Error {
    constructor(message, { status = null, code = "REST_FAILURE", body = null } = {}) {
      super(message);
      this.name = "PricingRestError";
      this.status = status;
      this.code = code;
      this.body = body;
    }
  }

  function normalizeBaseUrl(value) {
    let url;
    try { url = new URL(String(value || "").trim()); }
    catch (_error) { throw new TypeError("baseUrl must be an absolute http(s) URL"); }
    if (!new Set(["http:", "https:"]).has(url.protocol) || !url.hostname) throw new TypeError("baseUrl must be an absolute http(s) URL");
    if (url.username || url.password || url.search || url.hash) throw new TypeError("baseUrl must not contain credentials, a query, or a fragment");
    if (url.protocol === "http:" && !LOOPBACK.has(url.hostname.toLowerCase())) throw new TypeError("plain HTTP is permitted only for loopback; use HTTPS otherwise");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  }

  function createClient({ baseUrl, accessToken, timeoutMs = 60_000, fetchImpl = root.fetch } = {}) {
    const endpoint = normalizeBaseUrl(baseUrl);
    const token = String(accessToken || "").trim();
    if (token.length < 32) throw new TypeError("accessToken must contain at least 32 characters");
    if (typeof fetchImpl !== "function") throw new TypeError("fetch is required");

    async function request(path, { method = "GET", body, requestId = null } = {}) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      let response;
      try {
        response = await fetchImpl(endpoint + path, {
          method,
          headers: { Accept: "application/json", Authorization: "Bearer " + token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(controller ? { signal: controller.signal } : {})
        });
      } catch (error) {
        throw new PricingRestError(error && error.name === "AbortError" ? "pricing request timed out" : "could not reach pricing service", { code: error && error.name === "AbortError" ? "REST_TIMEOUT" : "REST_UNAVAILABLE" });
      } finally { if (timer) clearTimeout(timer); }
      let result;
      try { result = await response.json(); }
      catch (_error) { throw new PricingRestError("pricing service returned invalid JSON", { status: response.status, code: "INVALID_RESPONSE" }); }
      if (!response.ok) throw new PricingRestError(result && result.error && result.error.message || "pricing service rejected the request", { status: response.status, code: result && result.error && result.error.code || "REST_REJECTED", body: result });
      if (!result || typeof result !== "object" || Number(result.apiVersion) !== 1) throw new PricingRestError("pricing service returned an incompatible response", { status: response.status, code: "INVALID_RESPONSE", body: result });
      if (requestId != null && result.requestId !== requestId) throw new PricingRestError("pricing service returned a mismatched requestId", { status: response.status, code: "INVALID_RESPONSE", body: result });
      return result;
    }

    return {
      readiness() { return request("/v1/readiness"); },
      diagnostics(product, options = {}) {
        if (!product || typeof product !== "object" || !product.productId) throw new TypeError("product must be a canonical ProductRef with productId");
        const requestId = String(options.requestId || `browser-diagnostics-${Date.now().toString(36)}`).slice(0, 128);
        return request("/v1/diagnostics", {
          method: "POST",
          requestId,
          body: { apiVersion: 1, schema: "tcg.pricing-diagnostics-request/v1", type: "pricing.diagnostics", requestId, target: product }
        });
      },
      async priceProduct(product, options = {}) {
        if (!product || typeof product !== "object" || !product.productId) throw new TypeError("product must be a canonical ProductRef with productId");
        const requestId = String(options.requestId || `browser-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 128);
        const result = await request("/v1/price", {
          method: "POST",
          requestId,
          body: {
            apiVersion: 1,
            schema: "tcg.price-request/v1",
            type: "pricing.priceProduct",
            requestId,
            target: product,
            options: {
              includeActive: options.includeActive !== false,
              includeRecentSales: options.includeRecentSales !== false,
              includePackOut: options.includePackOut === true
            }
          }
        });
        if (!result.error && (!result.product || result.product.productId !== product.productId)) throw new PricingRestError("pricing service returned a different ProductRef", { code: "PRODUCT_MISMATCH", body: result });
        return result;
      },
      async priceViaBrowser(product, options = {}) {
        if (!product || typeof product !== "object" || !product.productId) throw new TypeError("product must be a canonical ProductRef with productId");
        const requestId = String(options.requestId || `browser-agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`).slice(0, 128);
        let job = await request("/v1/browser-price", {
          method: "POST",
          requestId,
          body: {
            apiVersion: 1,
            schema: "tcg.browser-price-request/v1",
            type: "pricing.browserPriceProduct",
            requestId,
            target: product,
            options: { includeActive: options.includeActive !== false, includePackOut: options.includePackOut === true }
          }
        });
        const timeout = Math.max(30_000, Number(options.browserTimeoutMs) || 5 * 60_000);
        const interval = Math.max(250, Number(options.pollIntervalMs) || 1000);
        const deadline = Date.now() + timeout;
        while (job.status === "queued" || job.status === "running") {
          if (Date.now() >= deadline) throw new PricingRestError("browser pricing job timed out", { code: "BROWSER_JOB_TIMEOUT", body: job });
          await new Promise((resolve) => setTimeout(resolve, interval));
          job = await request("/v1/browser-price/" + encodeURIComponent(job.jobId), { requestId });
        }
        if (job.status === "failed") throw new PricingRestError(job.error && job.error.message || "browser pricing failed", { code: job.error && job.error.code || "BROWSER_ANALYSIS_FAILED", body: job });
        const result = job.result;
        if (job.status !== "complete" || !result || result.schema !== "tcg.valuation/v1" || !result.product || result.product.productId !== product.productId) {
          throw new PricingRestError("browser pricing returned an incompatible result", { code: "INVALID_RESPONSE", body: job });
        }
        return result;
      }
    };
  }

  return { createClient, normalizeBaseUrl, PricingRestError };
});
