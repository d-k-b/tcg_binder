#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENV_PATH = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
const DEFAULT_PROVIDER_ROOT = "/Users/dkb/Apps/Extensions/TcgPriceComparisons";
const DEFAULT_AUTHORITY_URL = "http://127.0.0.1:3100/v1/resolve";
const EBAY_TOKEN_TIMEOUT_MS = 20000;
const REQUIRED_KEYS = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "TCG_MONITOR_TOKEN",
  "TCG_PROVIDER_AUTHORITY_TOKEN"
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
  env.TCG_PROVIDER_AUTHORITY_URL = env.TCG_PROVIDER_AUTHORITY_URL || DEFAULT_AUTHORITY_URL;
  const missing = REQUIRED_KEYS.filter((key) => !String(env[key] || "").trim());
  if (!fs.existsSync(serverPath)) missing.push("TCG_PROVIDER_REPO (monitor server not found)");
  if (env.TCG_PROVIDER_AUTHORITY_URL === DEFAULT_AUTHORITY_URL && !fs.existsSync(authorityServerPath)) {
    missing.push("TCG_PROVIDER_REPO (local authority server not found)");
  }
  return { env, providerRoot, serverPath, authorityServerPath, missing };
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

async function mintEbayToken(env) {
  const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(EBAY_TOKEN_TIMEOUT_MS)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`eBay application-token request failed with HTTP ${response.status}.`);
  return { accessToken: result.access_token, expiresIn: Number(result.expires_in) || 7200 };
}

async function mintEbayUserToken(env) {
  if (!String(env.EBAY_USER_REFRESH_TOKEN || "").trim()) return null;
  const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`, "utf8").toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.EBAY_USER_REFRESH_TOKEN,
    scope: "https://api.ebay.com/oauth/api_scope"
  });
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body,
    signal: AbortSignal.timeout(EBAY_TOKEN_TIMEOUT_MS)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`eBay user-token refresh failed with HTTP ${response.status}.`);
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
  let stopping = false;
  let expectedExit = false;
  let refreshTimer = null;
  let failureHandled = false;

  const handleUnexpectedExit = async (name, code, signal) => {
    if (stopping || expectedExit || failureHandled) return;
    failureHandled = true;
    stopping = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    console.error(`${name} exited unexpectedly (${signal || code}). Restarting the supervised service pair.`);
    await stopChild(monitorChild);
    await stopChild(authorityChild);
    process.exit(childFailureExitCode(code));
  };

  const start = async () => {
    console.log("Refreshing eBay application authorization...");
    const token = await mintEbayToken(setup.env);
    console.log("eBay application authorization ready.");
    let userToken = null;
    try {
      userToken = await mintEbayUserToken(setup.env);
      console.log(userToken ? "eBay read-only buying-account authorization ready." : "eBay buying-account authorization not configured; bid/watch state will remain unknown.");
    } catch (error) {
      console.error(`${error.message} Public Browse discovery will continue; bid/watch state will remain unknown.`);
    }
    const sharedEnv = {
      ...process.env,
      ...setup.env,
      EBAY_OAUTH_TOKEN: token.accessToken,
      EBAY_USER_OAUTH_TOKEN: userToken && userToken.accessToken || "",
      TCG_PROVIDER_AUTHORITY_HOST: "127.0.0.1",
      TCG_PROVIDER_AUTHORITY_PORT: setup.env.TCG_PROVIDER_AUTHORITY_PORT || "3100"
    };
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
    const effectiveExpiresIn = userToken ? Math.min(token.expiresIn, userToken.expiresIn) : token.expiresIn;
    const refreshAfterMs = Math.max(300000, (effectiveExpiresIn - 300) * 1000);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      expectedExit = true;
      await stopChild(monitorChild);
      await stopChild(authorityChild);
      expectedExit = false;
      if (!stopping) await start();
    }, refreshAfterMs);
    refreshTimer.unref();
  };

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    await stopChild(monitorChild);
    await stopChild(authorityChild);
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
  if (EBAY_TOKEN_TIMEOUT_MS !== 20000) throw new Error("eBay token timeout regression");
  if (await mintEbayUserToken({}) !== null) throw new Error("blank eBay user authorization must remain optional");
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
