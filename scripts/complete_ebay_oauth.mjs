#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import process from "node:process";

const ENV_PATH = "/Users/dkb/.config/tcg-price-monitor/monitor.env";

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function extractAuthorizationCode(input) {
  let parsed;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error("Paste the complete redirected URL from the browser address bar.");
  }
  const oauthError = parsed.searchParams.get("error");
  if (oauthError) throw new Error("eBay reported that authorization was not approved.");
  const code = parsed.searchParams.get("code");
  if (!code) throw new Error("The redirected URL does not contain an eBay authorization code.");
  return code;
}

function replaceEnvValue(contents, key, value) {
  const lines = contents.split(/\r?\n/);
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index < 0) throw new Error(`${key} is missing from the protected environment file.`);
  lines[index] = prefix + value;
  return lines.join("\n");
}

if (process.argv.includes("--self-test")) {
  const code = extractAuthorizationCode("https://localhost/callback?code=v%5Etest%23value");
  if (code !== "v^test#value") throw new Error("callback decoding regression");
  const updated = replaceEnvValue("A=1\nEBAY_USER_REFRESH_TOKEN=\n", "EBAY_USER_REFRESH_TOKEN", "token");
  if (!updated.includes("EBAY_USER_REFRESH_TOKEN=token")) throw new Error("environment update regression");
  console.log("eBay OAuth helper self-test passed");
  process.exit(0);
}

const original = fs.readFileSync(ENV_PATH, "utf8");
const env = parseEnv(original);
for (const key of ["EBAY_CLIENT_ID", "EBAY_CLIENT_SECRET", "EBAY_REDIRECT_URI_NAME"]) {
  if (!env[key]) throw new Error(`${key} is not configured.`);
}

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
const redirectedUrl = await prompt.question("Paste the complete URL eBay redirected you to, then press Return:\n> ");
prompt.close();
const code = extractAuthorizationCode(redirectedUrl);

const body = new URLSearchParams({
  grant_type: "authorization_code",
  code,
  redirect_uri: env.EBAY_REDIRECT_URI_NAME
});
const credentials = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`, "utf8").toString("base64");
const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
  method: "POST",
  headers: {
    Authorization: `Basic ${credentials}`,
    "Content-Type": "application/x-www-form-urlencoded"
  },
  body
});

let tokenResult;
try {
  tokenResult = await response.json();
} catch {
  throw new Error(`eBay token exchange failed with HTTP ${response.status}.`);
}
if (!response.ok || !tokenResult.refresh_token || !tokenResult.access_token) {
  throw new Error(`eBay token exchange failed with HTTP ${response.status}; restart authorization and try again.`);
}

const updated = replaceEnvValue(original, "EBAY_USER_REFRESH_TOKEN", tokenResult.refresh_token);
const tempPath = path.join(path.dirname(ENV_PATH), `.monitor.env.${process.pid}.tmp`);
try {
  fs.writeFileSync(tempPath, updated, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, ENV_PATH);
  fs.chmodSync(ENV_PATH, 0o600);
} finally {
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
}

console.log("eBay authorization complete. The refresh token was stored locally and was not displayed.");
