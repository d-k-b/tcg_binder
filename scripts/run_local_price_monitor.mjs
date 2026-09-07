#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENV_PATH = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
const DEFAULT_PROVIDER_ROOT = "/Users/dkb/Apps/Extensions/TcgPriceComparisons";
const DEFAULT_AUTHORITY_URL = "http://127.0.0.1:3100/v1/resolve";
const DEFAULT_COLLECTION_AUTHORITY_URL = "http://127.0.0.1:3102";
const TRACKER_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const COLLECTION_SYNC_SCRIPT = path.join(TRACKER_ROOT, "scripts", "sync_local_monitor_from_gist.mjs");
const EBAY_TOKEN_TIMEOUT_MS = 20000;
const EBAY_AUTH_ATTEMPTS = 3;
const EBAY_AUTH_BASE_DELAY_MS = 750;
const COLLECTION_AUTHORITY_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 5_000, 10_000, 30_000]);
const COLLECTION_AUTHORITY_STARTUP_ATTEMPTS = 12;
const COLLECTION_AUTHORITY_STARTUP_DELAY_MS = 250;
const COLLECTION_AUTHORITY_STATUS_SCHEMA = "tcg.local-supervisor-status/v1";
const REQUIRED_KEYS = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "TCG_MONITOR_TOKEN",
  "TCG_PROVIDER_AUTHORITY_TOKEN",
  "TCG_COLLECTION_AUTHORITY_TOKEN",
  "TCG_TRACKER_GIST_TOKEN"
];
const EMAIL_KEYS = ["RESEND_API_KEY", "ALERT_EMAIL_FROM", "ALERT_EMAIL_TO"];
const DISCORD_KEYS = ["DISCORD_WEBHOOK_URL"];

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadSetup(envPath, processEnv = process.env) {
  const fileEnv = parseEnv(fs.readFileSync(envPath, "utf8"));
  const env = { ...fileEnv, ...processEnv };
  const providerRoot = env.TCG_PROVIDER_REPO || DEFAULT_PROVIDER_ROOT;
  const serverPath = path.join(providerRoot, "services/price-monitor/server.js");
  const authorityServerPath = path.join(providerRoot, "services/provider-authority/server.js");
  const collectionAuthorityServerPath = path.join(TRACKER_ROOT, "node-app/services/collection-authority/server.js");
  const gatewayServerPath = path.join(TRACKER_ROOT, "node-app/services/tcg-gateway/server.js");
  env.TCG_PROVIDER_AUTHORITY_URL = env.TCG_PROVIDER_AUTHORITY_URL || DEFAULT_AUTHORITY_URL;
  env.TCG_COLLECTION_AUTHORITY_URL = env.TCG_COLLECTION_AUTHORITY_URL || DEFAULT_COLLECTION_AUTHORITY_URL;
  const missing = REQUIRED_KEYS.filter((key) => !String(env[key] || "").trim());
  if (!fs.existsSync(serverPath)) missing.push("TCG_PROVIDER_REPO (monitor server not found)");
  if (env.TCG_PROVIDER_AUTHORITY_URL === DEFAULT_AUTHORITY_URL && !fs.existsSync(authorityServerPath)) {
    missing.push("TCG_PROVIDER_REPO (local authority server not found)");
  }
  if (env.TCG_COLLECTION_AUTHORITY_URL === DEFAULT_COLLECTION_AUTHORITY_URL && !fs.existsSync(collectionAuthorityServerPath)) {
    missing.push("Tracker repository (local collection authority server not found)");
  }
  if (!fs.existsSync(gatewayServerPath)) missing.push("Tracker repository (local TCG gateway server not found)");
  return { envPath, env, providerRoot, serverPath, authorityServerPath, collectionAuthorityServerPath, gatewayServerPath, missing };
}

function printSetup(setup) {
  console.log(`Monitor prerequisites: ${setup.missing.length ? "INCOMPLETE" : "READY"}`);
  for (const key of REQUIRED_KEYS) console.log(`${key}: ${setup.env[key] ? "SET" : "EMPTY"}`);
  for (const key of EMAIL_KEYS) console.log(`${key}: ${setup.env[key] ? "SET" : "EMPTY"}`);
  for (const key of DISCORD_KEYS) console.log(`${key}: ${setup.env[key] ? "SET" : "EMPTY"}`);
  console.log(`EBAY_USER_REFRESH_TOKEN: ${setup.env.EBAY_USER_REFRESH_TOKEN ? "SET" : "EMPTY"}`);
  const emailReady = EMAIL_KEYS.every((key) => setup.env[key]);
  const discordReady = DISCORD_KEYS.every((key) => setup.env[key]);
  console.log(`ALERT_DELIVERY: ${emailReady && discordReady ? "RESEND+DISCORD" : emailReady ? "RESEND" : discordReady ? "DISCORD" : "CAPTURE_ONLY"}`);
  console.log(`TCG_PROVIDER_AUTHORITY_URL: ${setup.env.TCG_PROVIDER_AUTHORITY_URL === DEFAULT_AUTHORITY_URL ? "LOCAL" : "SET"}`);
  console.log(`TCG_COLLECTION_AUTHORITY_URL: ${setup.env.TCG_COLLECTION_AUTHORITY_URL === DEFAULT_COLLECTION_AUTHORITY_URL ? "LOCAL" : "SET"}`);
  console.log(`STORE_CATALOGS: ${setup.env.TCG_STORE_CATALOGS_JSON ? "SET" : "EMPTY"}`);
  console.log(`EBAY_BROWSE_BUDGET: ${setup.env.EBAY_BROWSE_DAILY_CALL_BUDGET || "DEFAULT"} daily / ${setup.env.EBAY_BROWSE_SEARCH_CALLS_PER_RUN || "DEFAULT"} search / ${setup.env.EBAY_BROWSE_DETAIL_CALLS_PER_RUN || "DEFAULT"} detail per run`);
  const heritageFeed = String(setup.env.HERITAGE_FEED_FILE || "").trim();
  console.log(`HERITAGE_FEED: ${heritageFeed && fs.existsSync(heritageFeed) ? "FOUND" : heritageFeed ? "NOT_FOUND" : "EMPTY"}`);
  console.log(`TCG_PROVIDER_REPO: ${fs.existsSync(setup.serverPath) ? "FOUND" : "MISSING"}`);
  console.log("Secrets were not displayed.");
}

function childFailureExitCode(code) {
  return Number.isInteger(code) && code > 0 ? code : 1;
}

function collectionSyncInvocation(envPath) {
  if (!String(envPath || "").trim()) throw new Error("collection startup sync requires the protected environment path");
  return { command: process.execPath, args: [COLLECTION_SYNC_SCRIPT, "--env", envPath], cwd: TRACKER_ROOT };
}

function retryableHttpStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectionAuthorityRetryDelay(attempt) {
  const index = Math.max(0, Math.min(COLLECTION_AUTHORITY_RETRY_DELAYS_MS.length - 1, Number(attempt || 1) - 1));
  return COLLECTION_AUTHORITY_RETRY_DELAYS_MS[index];
}

function collectionAuthorityExitErrorCode(stderr) {
  return /Unknown system error -11|\bEAGAIN\b|errno[^\n]*-11|syscall[^\n]*read/i.test(String(stderr || ""))
    ? "RUNTIME_READ_EAGAIN"
    : "PROCESS_EXITED";
}

function collectionAuthorityStatus(state, fields = {}, now = new Date()) {
  const allowedStates = new Set(["starting", "ready", "degraded", "external", "stopped"]);
  const safeState = allowedStates.has(state) ? state : "degraded";
  return {
    schema: COLLECTION_AUTHORITY_STATUS_SCHEMA,
    collectionAuthority: {
      state: safeState,
      attempts: Number.isInteger(fields.attempts) && fields.attempts >= 0 ? fields.attempts : 0,
      retryAt: typeof fields.retryAt === "string" ? fields.retryAt : null,
      lastErrorCode: typeof fields.lastErrorCode === "string" && /^[A-Z0-9_]{1,64}$/.test(fields.lastErrorCode) ? fields.lastErrorCode : null,
      message: typeof fields.message === "string" ? fields.message.slice(0, 240) : null,
      updatedAt: now.toISOString()
    }
  };
}

function writeSupervisorStatus(filename, status) {
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
  fs.chmodSync(filename, 0o600);
}

async function collectionAuthorityIsReady(url, child, fetchImpl = fetch) {
  const healthUrl = new URL("/healthz", url).toString();
  for (let attempt = 0; attempt < COLLECTION_AUTHORITY_STARTUP_ATTEMPTS; attempt++) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const response = await fetchImpl(healthUrl, { signal: AbortSignal.timeout(750) });
      if (response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body && body.schema === "tcg.collection-authority-health/v1" && body.ok === true) return true;
      }
    } catch (_error) {
      // A module-read EAGAIN normally exits the child during this short probe.
    }
    await sleep(COLLECTION_AUTHORITY_STARTUP_DELAY_MS);
  }
  return false;
}

async function retryEbayAuthorization(request, { attempts = EBAY_AUTH_ATTEMPTS, baseDelayMs = EBAY_AUTH_BASE_DELAY_MS } = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await request();
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.access_token) return { response, result };
      lastError = new Error(`HTTP ${response.status}`);
      if (!retryableHttpStatus(response.status) || attempt === attempts) break;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await sleep(Math.min(baseDelayMs * (2 ** (attempt - 1)), 5_000));
  }
  const failure = new Error(`eBay authorization retry exhausted: ${lastError && lastError.message ? lastError.message : "unknown failure"}`);
  failure.code = "EBAY_AUTH_RETRY_EXHAUSTED";
  throw failure;
}

async function mintEbayToken(env, retryOptions = {}) {
  const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const { result } = await retryEbayAuthorization(() => fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(EBAY_TOKEN_TIMEOUT_MS)
  }), retryOptions);
  return { accessToken: result.access_token, expiresIn: Number(result.expires_in) || 7200 };
}

async function mintEbayUserToken(env, retryOptions = {}) {
  if (!String(env.EBAY_USER_REFRESH_TOKEN || "").trim()) return null;
  const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.EBAY_USER_REFRESH_TOKEN,
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const { result } = await retryEbayAuthorization(() => fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(EBAY_TOKEN_TIMEOUT_MS)
  }), retryOptions);
  return { accessToken: result.access_token, expiresIn: Number(result.expires_in) || 7200 };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function run(setup) {
  if (setup.missing.length) {
    printSetup(setup);
    throw new Error(`Complete the missing monitor configuration: ${setup.missing.join(", ")}`);
  }

  const dataDir = setup.env.TCG_MONITOR_DATA_DIR || "/Users/dkb/.config/tcg-price-monitor/data";
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);

  let monitorChild = null;
  let authorityChild = null;
  let collectionAuthorityChild = null;
  let gatewayChild = null;
  let collectionSyncChild = null;
  let stopping = false;
  let expectedExit = false;
  let refreshTimer = null;
  let collectionAuthorityRetryTimer = null;
  let collectionAuthorityAttempt = 0;
  let collectionAuthorityGeneration = 0;
  let collectionAuthorityReady = false;
  let monitorStarted = false;
  let failureHandled = false;
  const supervisorStatusFile = path.join(dataDir, "supervisor-status.json");

  const publishCollectionAuthorityStatus = (state, fields = {}) => {
    try {
      writeSupervisorStatus(supervisorStatusFile, collectionAuthorityStatus(state, fields));
    } catch (error) {
      console.error(`Collection authority supervisor status could not be written: ${error.message}`);
    }
  };

  const handleUnexpectedExit = async (name, code, signal) => {
    if (stopping || expectedExit || failureHandled) return;
    failureHandled = true;
    stopping = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    console.error(`${name} exited unexpectedly (${signal || code}). Restarting the supervised service pair.`);
    await stopChild(monitorChild);
    await stopChild(authorityChild);
    await stopChild(collectionAuthorityChild);
    await stopChild(gatewayChild);
    await stopChild(collectionSyncChild);
    process.exit(childFailureExitCode(code));
  };

  const runInitialCollectionSync = (monitorSafeSetupEnv) => {
    if (!collectionAuthorityReady || !monitorStarted || collectionSyncChild || stopping || expectedExit) return;
    const syncInvocation = collectionSyncInvocation(setup.envPath);
    collectionSyncChild = spawn(syncInvocation.command, syncInvocation.args, {
      cwd: syncInvocation.cwd,
      env: { ...monitorSafeSetupEnv },
      stdio: "inherit"
    });
    collectionSyncChild.once("error", (error) => {
      console.error(`Initial collection monitor sync could not start: ${error.message}`);
      collectionSyncChild = null;
    });
    collectionSyncChild.once("exit", (code) => {
      if (code !== 0 && !stopping) console.error(`Initial collection monitor sync failed (${code}); prior monitor state was retained.`);
      collectionSyncChild = null;
    });
  };

  const start = async () => {
    console.log("Refreshing eBay application authorization...");
    let token = null;
    try {
      token = await mintEbayToken(setup.env);
      console.log("eBay application authorization ready.");
    } catch (error) {
      console.error(`${error.message} eBay public discovery is degraded; continuing with TCGplayer, Heritage, and stores.`);
    }
    let userToken = null;
    try {
      userToken = await mintEbayUserToken(setup.env);
      console.log(userToken ? "eBay read-only buying-account authorization ready." : "eBay buying-account authorization not configured; bid/watch state will remain unknown.");
    } catch (error) {
      console.error(`${error.message} Public Browse discovery will continue; bid/watch state will remain unknown.`);
    }
    const collectionAuthorityEnv = {
      ...process.env,
      ...setup.env,
      TCG_COLLECTION_AUTHORITY_HOST: "127.0.0.1",
      TCG_COLLECTION_AUTHORITY_PORT: setup.env.TCG_COLLECTION_AUTHORITY_PORT || "3102"
    };
    const monitorSafeSetupEnv = { ...process.env, ...setup.env };
    delete monitorSafeSetupEnv.TCG_TRACKER_GIST_TOKEN;
    delete monitorSafeSetupEnv.TCG_COLLECTION_AUTHORITY_ADMIN_TOKEN;
    delete monitorSafeSetupEnv.GITHUB_TOKEN;
    const sharedEnv = {
      ...monitorSafeSetupEnv,
      EBAY_OAUTH_TOKEN: token && token.accessToken || "",
      EBAY_USER_OAUTH_TOKEN: userToken && userToken.accessToken || "",
      TCG_PROVIDER_AUTHORITY_HOST: "127.0.0.1",
      TCG_PROVIDER_AUTHORITY_PORT: setup.env.TCG_PROVIDER_AUTHORITY_PORT || "3100"
    };
    const scheduleCollectionAuthorityRetry = (lastErrorCode, detail) => {
      if (stopping || expectedExit || collectionAuthorityRetryTimer) return;
      collectionAuthorityAttempt += 1;
      const delay = collectionAuthorityRetryDelay(collectionAuthorityAttempt);
      const retryAt = new Date(Date.now() + delay).toISOString();
      const message = "Collection Authority is unavailable; provider pricing and monitoring remain active while it retries.";
      publishCollectionAuthorityStatus("degraded", { attempts: collectionAuthorityAttempt, retryAt, lastErrorCode, message });
      console.error(`${detail} Retrying Collection Authority in ${Math.round(delay / 1000)}s without restarting provider pricing or monitoring.`);
      collectionAuthorityRetryTimer = setTimeout(() => {
        collectionAuthorityRetryTimer = null;
        void startCollectionAuthority();
      }, delay);
      collectionAuthorityRetryTimer.unref();
    };
    const startCollectionAuthority = async () => {
      if (stopping || expectedExit || collectionAuthorityChild) return;
      const generation = ++collectionAuthorityGeneration;
      collectionAuthorityReady = false;
      publishCollectionAuthorityStatus("starting", { attempts: collectionAuthorityAttempt });
      let startupStderr = "";
      const child = spawn(process.execPath, [setup.collectionAuthorityServerPath], {
        cwd: TRACKER_ROOT,
        env: collectionAuthorityEnv,
        stdio: ["inherit", "inherit", "pipe"]
      });
      collectionAuthorityChild = child;
      child.stderr.on("data", (chunk) => {
        process.stderr.write(chunk);
        startupStderr = `${startupStderr}${chunk}`.slice(-4_096);
      });
      child.once("error", (error) => {
        if (collectionAuthorityChild === child) collectionAuthorityChild = null;
        if (generation === collectionAuthorityGeneration) scheduleCollectionAuthorityRetry("PROCESS_START_FAILED", `Collection Authority could not start (${error.message}).`);
      });
      child.once("exit", (code, signal) => {
        if (collectionAuthorityChild === child) collectionAuthorityChild = null;
        collectionAuthorityReady = false;
        if (stopping || expectedExit || generation !== collectionAuthorityGeneration) return;
        const errorCode = collectionAuthorityExitErrorCode(startupStderr);
        scheduleCollectionAuthorityRetry(errorCode, `Collection Authority exited unexpectedly (${signal || code}; ${errorCode}).`);
      });
      if (await collectionAuthorityIsReady(setup.env.TCG_COLLECTION_AUTHORITY_URL, child)) {
        if (stopping || expectedExit || generation !== collectionAuthorityGeneration || collectionAuthorityChild !== child) return;
        collectionAuthorityAttempt = 0;
        collectionAuthorityReady = true;
        publishCollectionAuthorityStatus("ready", { message: "Collection Authority is healthy." });
        console.log("Collection Authority supervisor is ready; provider pricing and monitoring remained independent.");
        runInitialCollectionSync(monitorSafeSetupEnv);
        return;
      }
      if (collectionAuthorityChild === child && child.exitCode === null) {
        collectionAuthorityGeneration += 1;
        collectionAuthorityChild = null;
        await stopChild(child);
        scheduleCollectionAuthorityRetry("STARTUP_TIMEOUT", "Collection Authority did not become healthy during its startup window.");
      }
    };
    if (setup.env.TCG_COLLECTION_AUTHORITY_URL === DEFAULT_COLLECTION_AUTHORITY_URL) {
      void startCollectionAuthority();
    } else {
      collectionAuthorityReady = true;
      publishCollectionAuthorityStatus("external", { message: "Collection Authority uses an externally supervised endpoint." });
    }
    if (setup.env.TCG_PROVIDER_AUTHORITY_URL === DEFAULT_AUTHORITY_URL) {
      authorityChild = spawn(process.execPath, [setup.authorityServerPath], {
        cwd: setup.providerRoot,
        env: sharedEnv,
        stdio: "inherit"
      });
      authorityChild.once("exit", (code, signal) => {
        void handleUnexpectedExit("Provider authority", code, signal);
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    monitorChild = spawn(process.execPath, [setup.serverPath], {
      cwd: setup.providerRoot,
      env: {
        ...sharedEnv,
        TCG_MONITOR_HOST: "127.0.0.1",
        TCG_MONITOR_PORT: setup.env.TCG_MONITOR_PORT || "3099",
        TCG_MONITOR_INTERVAL_MINUTES: setup.env.TCG_MONITOR_INTERVAL_MINUTES || "30",
        TCG_MONITOR_DATA_DIR: dataDir
      },
      stdio: "inherit"
    });
    monitorChild.once("exit", (code, signal) => {
      void handleUnexpectedExit("Monitor", code, signal);
    });
    monitorStarted = true;
    runInitialCollectionSync(monitorSafeSetupEnv);
    gatewayChild = spawn(process.execPath, [setup.gatewayServerPath], {
      cwd: TRACKER_ROOT,
      env: { ...monitorSafeSetupEnv, TCG_GATEWAY_HOST: "127.0.0.1", TCG_GATEWAY_PORT: setup.env.TCG_GATEWAY_PORT || "3180", TCG_SUPERVISOR_STATUS_FILE: supervisorStatusFile },
      stdio: "inherit"
    });
    gatewayChild.once("exit", (code, signal) => {
      void handleUnexpectedExit("TCG gateway", code, signal);
    });
    const effectiveExpiresIn = token ? (userToken ? Math.min(token.expiresIn, userToken.expiresIn) : token.expiresIn) : 900;
    const refreshAfterMs = Math.max(300000, (effectiveExpiresIn - 300) * 1000);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      expectedExit = true;
      if (collectionAuthorityRetryTimer) clearTimeout(collectionAuthorityRetryTimer);
      collectionAuthorityRetryTimer = null;
      collectionAuthorityGeneration += 1;
      collectionAuthorityReady = false;
      monitorStarted = false;
      await stopChild(monitorChild);
      await stopChild(authorityChild);
      await stopChild(collectionAuthorityChild);
      await stopChild(gatewayChild);
      await stopChild(collectionSyncChild);
      expectedExit = false;
      if (!stopping) await start();
    }, refreshAfterMs);
    refreshTimer.unref();
  };

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    if (collectionAuthorityRetryTimer) clearTimeout(collectionAuthorityRetryTimer);
    collectionAuthorityRetryTimer = null;
    collectionAuthorityGeneration += 1;
    collectionAuthorityReady = false;
    monitorStarted = false;
    publishCollectionAuthorityStatus("stopped", { message: "Local supervisor is stopping." });
    await stopChild(monitorChild);
    await stopChild(authorityChild);
    await stopChild(collectionAuthorityChild);
    await stopChild(gatewayChild);
    await stopChild(collectionSyncChild);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  await start();
}

if (process.argv.includes("--self-test")) {
  const parsed = parseEnv("A=one\nB='two words'\nC=\"three words\"\n# D=no\n");
  if (parsed.A !== "one" || parsed.B !== "two words" || parsed.C !== "three words" || parsed.D) {
    throw new Error("environment parser regression");
  }
  const setup = { env: { TCG_PROVIDER_AUTHORITY_URL: DEFAULT_AUTHORITY_URL }, missing: [], serverPath: process.argv[1] };
  if (setup.env.TCG_PROVIDER_AUTHORITY_URL !== DEFAULT_AUTHORITY_URL) throw new Error("local authority default regression");
  const syncInvocation = collectionSyncInvocation("/tmp/monitor.env");
  if (!syncInvocation.args.join(" ").endsWith("/scripts/sync_local_monitor_from_gist.mjs --env /tmp/monitor.env") || syncInvocation.cwd !== TRACKER_ROOT) {
    throw new Error("collection startup sync invocation regression");
  }
  if (EBAY_TOKEN_TIMEOUT_MS !== 20000) throw new Error("eBay token timeout regression");
  if (!retryableHttpStatus(429) || !retryableHttpStatus(503) || retryableHttpStatus(400)) throw new Error("eBay retry classification regression");
  const retryDelays = [1, 2, 3, 4, 5, 99].map(collectionAuthorityRetryDelay);
  if (retryDelays.join(",") !== "1000,2000,5000,10000,30000,30000") throw new Error("collection authority bounded backoff regression");
  if (collectionAuthorityExitErrorCode("Error: Unknown system error -11\n errno: -11, syscall: read") !== "RUNTIME_READ_EAGAIN" || collectionAuthorityExitErrorCode("ordinary exit") !== "PROCESS_EXITED") {
    throw new Error("collection authority transient runtime-read classification regression");
  }
  const degraded = collectionAuthorityStatus("degraded", { attempts: 3, retryAt: "2026-09-07T00:00:00.000Z", lastErrorCode: "RUNTIME_READ_EAGAIN", message: "retrying" }, new Date("2026-09-07T00:00:01.000Z"));
  if (degraded.schema !== COLLECTION_AUTHORITY_STATUS_SCHEMA || degraded.collectionAuthority.state !== "degraded" || degraded.collectionAuthority.attempts !== 3 || degraded.collectionAuthority.lastErrorCode !== "RUNTIME_READ_EAGAIN") {
    throw new Error("collection authority degraded status regression");
  }
  const sanitized = collectionAuthorityStatus("unknown", { lastErrorCode: "unsafe code", message: "x".repeat(300) });
  if (sanitized.collectionAuthority.state !== "degraded" || sanitized.collectionAuthority.lastErrorCode !== null || sanitized.collectionAuthority.message.length !== 240) {
    throw new Error("collection authority status allowlist regression");
  }
  if (await mintEbayUserToken({}) !== null) throw new Error("blank eBay user authorization must remain optional");
  let attempts = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    attempts += 1;
    return { ok: attempts === 2, status: attempts === 2 ? 200 : 503, json: async () => attempts === 2 ? { access_token: "self-test", expires_in: 60 } : {} };
  };
  try {
    const token = await mintEbayToken({ EBAY_CLIENT_ID: "id", EBAY_CLIENT_SECRET: "secret" }, { attempts: 2, baseDelayMs: 0 });
    if (token.accessToken !== "self-test" || attempts !== 2) throw new Error("eBay bounded retry regression");
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (childFailureExitCode(7) !== 7 || childFailureExitCode(0) !== 1 || childFailureExitCode(null) !== 1) throw new Error("child failure exit-code regression");
  console.log("Local monitor runner self-test passed");
  process.exit(0);
}

const envFlag = process.argv.indexOf("--env");
const envPath = envFlag >= 0 ? process.argv[envFlag + 1] : DEFAULT_ENV_PATH;
if (!envPath) throw new Error("--env requires a path");
const setup = loadSetup(envPath);

if (process.argv.includes("--check")) {
  printSetup(setup);
  process.exit(setup.missing.length ? 2 : 0);
}

await run(setup);
