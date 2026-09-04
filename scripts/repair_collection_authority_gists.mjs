#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { GitHubGistStore, CollectionAuthority } = require(path.join(ROOT, "node-app/lib/collection-authority.js"));
const EXPECTED_LANES = new Set(["collector", "boxes", "packs", "prerelease", "lorcana", "lorcana_pre", "lorcana_coll"]);
const DEFAULT_ENV = "/Users/dkb/.config/tcg-price-monitor/monitor.env";

function parseEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function repeated(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name) {
      const value = process.argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires lane=value`);
      values.push(value);
    }
  }
  return values;
}

function assignments(values, name) {
  const result = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const lane = separator > 0 ? value.slice(0, separator) : "";
    const assigned = separator > 0 ? value.slice(separator + 1) : "";
    if (!EXPECTED_LANES.has(lane) || !assigned) throw new Error(`${name} requires a canonical lane=value`);
    result[lane] = assigned;
  }
  return result;
}

const apply = process.argv.includes("--apply");
const envPath = option("--env", DEFAULT_ENV);
const env = { ...parseEnv(fs.readFileSync(envPath, "utf8")), ...process.env };
if (!env.TCG_TRACKER_GIST_TOKEN) throw new Error("protected TCG_TRACKER_GIST_TOKEN is not configured");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "node-app/data/binder_data.json"), "utf8"));
const dataDir = env.TCG_COLLECTION_AUTHORITY_DATA_DIR || path.join(ROOT, "node-app/.data/collection-authority");
const store = new GitHubGistStore({ token: env.TCG_TRACKER_GIST_TOKEN, catalog, dataDir });
const authority = new CollectionAuthority({ store, catalog, dataDir });

if (!apply) {
  console.log(JSON.stringify(await authority.repair({ apply: false }), null, 2));
  process.exit(0);
}

const sourceFiles = assignments(repeated("--source"), "--source");
const expectedHashes = assignments(repeated("--sha256"), "--sha256");
const sourcePayloads = {};
for (const [lane, filename] of Object.entries(sourceFiles)) {
  const bytes = fs.readFileSync(path.resolve(filename));
  const actual = crypto.createHash("sha256").update(bytes).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(expectedHashes[lane] || "") || expectedHashes[lane] !== actual) {
    throw new Error(`verified SHA-256 is required and must match for ${lane}`);
  }
  sourcePayloads[lane] = JSON.parse(bytes.toString("utf8"));
}
const result = await authority.repair({ apply: true, sourcePayloads });
console.log(JSON.stringify(result, null, 2));
