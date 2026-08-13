#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENV_PATH = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
const DEFAULT_PROVIDER_ROOT = "/Users/dkb/Apps/Extensions/TcgPriceComparisons";
const REQUIRED_KEYS = [
  "EBAY_CLIENT_ID",
  "EBAY_CLIENT_SECRET",
  "RESEND_API_KEY",
  "ALERT_EMAIL_FROM",
  "ALERT_EMAIL_TO",
  "TCG_MONITOR_TOKEN",
  "TCG_PROVIDER_AUTHORITY_URL",
  "TCG_PROVIDER_AUTHORITY_TOKEN"
];

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
  const missing = REQUIRED_KEYS.filter((key) => !String(env[key] || "").trim());
  if (!fs.existsSync(serverPath)) missing.push("TCG_PROVIDER_REPO (monitor server not found)");
  return { env, providerRoot, serverPath, missing };
}

function printSetup(setup) {
  console.log(`Monitor prerequisites: ${setup.missing.length ? "INCOMPLETE" : "READY"}`);
  for (const key of REQUIRED_KEYS) console.log(`${key}: ${setup.env[key] ? "SET" : "EMPTY"}`);
  console.log(`TCG_PROVIDER_REPO: ${fs.existsSync(setup.serverPath) ? "FOUND" : "MISSING"}`);
  console.log("Secrets were not displayed.");
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
    body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.access_token) throw new Error(`eBay application-token request failed with HTTP ${response.status}.`);
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

  let child = null;
  let stopping = false;
  let expectedExit = false;
  let refreshTimer = null;

  const start = async () => {
    const token = await mintEbayToken(setup.env);
    child = spawn(process.execPath, [setup.serverPath], {
      cwd: setup.providerRoot,
      env: {
        ...process.env,
        ...setup.env,
        EBAY_OAUTH_TOKEN: token.accessToken,
        TCG_MONITOR_HOST: "127.0.0.1",
        TCG_MONITOR_PORT: setup.env.TCG_MONITOR_PORT || "3099",
        TCG_MONITOR_INTERVAL_MINUTES: setup.env.TCG_MONITOR_INTERVAL_MINUTES || "5",
        TCG_MONITOR_DATA_DIR: dataDir
      },
      stdio: "inherit"
    });
    child.once("exit", (code, signal) => {
      if (!stopping && !expectedExit) {
        console.error(`Monitor exited unexpectedly (${signal || code}).`);
        process.exitCode = code || 1;
      }
    });
    const refreshAfterMs = Math.max(300000, (token.expiresIn - 300) * 1000);
    refreshTimer = setTimeout(async () => {
      refreshTimer = null;
      expectedExit = true;
      await stopChild(child);
      expectedExit = false;
      if (!stopping) await start();
    }, refreshAfterMs);
    refreshTimer.unref();
  };

  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (refreshTimer) clearTimeout(refreshTimer);
    await stopChild(child);
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
