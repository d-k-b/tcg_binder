#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_ENV_PATH = "/Users/dkb/.config/tcg-price-monitor/monitor.env";
const INTERNAL_DEFAULTS = {
  TCG_PROVIDER_AUTHORITY_URL: "http://127.0.0.1:3100/v1/resolve",
  TCG_MONITOR_INTERVAL_MINUTES: "30",
  TCG_STORE_CATALOGS_JSON: '[{"adapterId":"openboosters","url":"https://openboosters.myshopify.com/collections/mtg-sealed/products.json?limit=250"}]',
  EBAY_BROWSE_DAILY_CALL_BUDGET: "4500",
  EBAY_BROWSE_SEARCH_CALLS_PER_RUN: "80",
  EBAY_BROWSE_DETAIL_CALLS_PER_RUN: "20",
  HERITAGE_FEED_FILE: "/Users/dkb/.config/tcg-price-monitor/data/heritage-lots.json",
  HERITAGE_BUYER_PREMIUM_RATE: "0.25",
  HERITAGE_BUYER_PREMIUM_MINIMUM: "49",
  HERITAGE_FEED_MAX_AGE_MINUTES: "45"
};

function replaceEnvValue(contents, key, value) {
  const lines = contents.split(/\r?\n/);
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index < 0) lines.push(prefix + value);
  else lines[index] = prefix + value;
  return lines.join("\n");
}

function readEnvValue(contents, key) {
  const prefix = `${key}=`;
  const line = contents.split(/\r?\n/).find((row) => row.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().replace(/^(['"])(.*)\1$/, "$2") : "";
}

function updateInternalConfiguration(contents, tokenFactory = () => randomBytes(48).toString("base64url")) {
  let updated = contents;
  for (const key of ["TCG_MONITOR_TOKEN", "TCG_PROVIDER_AUTHORITY_TOKEN"]) {
    if (!readEnvValue(updated, key)) updated = replaceEnvValue(updated, key, tokenFactory());
  }
  for (const [key, value] of Object.entries(INTERNAL_DEFAULTS)) {
    if (!readEnvValue(updated, key)) updated = replaceEnvValue(updated, key, value);
  }
  return updated;
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = path.join(path.dirname(filePath), `.monitor.env.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tempPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

if (process.argv.includes("--self-test")) {
  let counter = 0;
  const updated = updateInternalConfiguration("A=1\nTCG_MONITOR_TOKEN=\n", () => `secret-${++counter}`);
  if (readEnvValue(updated, "TCG_MONITOR_TOKEN") !== "secret-1") throw new Error("monitor token generation regression");
  if (readEnvValue(updated, "TCG_PROVIDER_AUTHORITY_TOKEN") !== "secret-2") throw new Error("authority token generation regression");
  if (readEnvValue(updated, "TCG_PROVIDER_AUTHORITY_URL") !== INTERNAL_DEFAULTS.TCG_PROVIDER_AUTHORITY_URL) throw new Error("authority URL regression");
  if (readEnvValue(updated, "TCG_STORE_CATALOGS_JSON") !== INTERNAL_DEFAULTS.TCG_STORE_CATALOGS_JSON) throw new Error("OpenBoosters catalog regression");
  if (readEnvValue(updated, "EBAY_BROWSE_DAILY_CALL_BUDGET") !== "4500") throw new Error("eBay Browse budget regression");
  if (readEnvValue(updated, "HERITAGE_BUYER_PREMIUM_MINIMUM") !== "49") throw new Error("Heritage premium minimum regression");
  if (readEnvValue(updated, "HERITAGE_FEED_FILE") !== INTERNAL_DEFAULTS.HERITAGE_FEED_FILE) throw new Error("Heritage feed path regression");
  if (updated.includes("secret-3")) throw new Error("unexpected token generation");
  console.log("Local monitor configuration self-test passed");
  process.exit(0);
}

const envFlag = process.argv.indexOf("--env");
const envPath = envFlag >= 0 ? process.argv[envFlag + 1] : DEFAULT_ENV_PATH;
if (!envPath) throw new Error("--env requires a path");
const original = fs.readFileSync(envPath, "utf8");
atomicWrite(envPath, updateInternalConfiguration(original));
console.log("Internal monitor tokens and local authority defaults are configured. Secret values were not displayed.");
