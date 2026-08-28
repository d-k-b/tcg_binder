#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "com.dkb.tcg-price-monitor";
const RUNNER = path.join(ROOT, "scripts", "run_local_price_monitor.mjs");
const CONFIG_ROOT = path.join(os.homedir(), ".config", "tcg-price-monitor");
const LOG_ROOT = path.join(CONFIG_ROOT, "logs");
const AGENT_PATH = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function plist(nodePath = process.execPath) {
  const stdout = path.join(LOG_ROOT, "monitor.stdout.log");
  const stderr = path.join(LOG_ROOT, "monitor.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(RUNNER)}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(stdout)}</string>
  <key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict>
</plist>
`;
}

function launchctl(args, allowFailure = false) {
  const result = spawnSync("/bin/launchctl", args, { encoding: "utf8" });
  if (!allowFailure && result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "launchctl failed").trim();
    throw new Error(`${args.join(" ")}: ${detail}`);
  }
  return result;
}

if (process.argv.includes("--self-test")) {
  const rendered = plist("/test/node&binary");
  if (!rendered.includes("/test/node&amp;binary")) throw new Error("plist XML escaping regression");
  if (!rendered.includes(`<string>${LABEL}</string>`)) throw new Error("launch agent label regression");
  if (!rendered.includes("<key>KeepAlive</key><true/>")) throw new Error("launch agent persistence regression");
  console.log("Local monitor LaunchAgent installer self-test passed");
  process.exit(0);
}

if (!fs.existsSync(RUNNER)) throw new Error(`monitor runner not found: ${RUNNER}`);
fs.mkdirSync(path.dirname(AGENT_PATH), { recursive: true, mode: 0o755 });
fs.mkdirSync(LOG_ROOT, { recursive: true, mode: 0o700 });
const temporary = `${AGENT_PATH}.tmp-${process.pid}`;
fs.writeFileSync(temporary, plist(), { mode: 0o644 });
fs.renameSync(temporary, AGENT_PATH);
fs.chmodSync(AGENT_PATH, 0o644);

const domain = `gui/${process.getuid()}`;
const service = `${domain}/${LABEL}`;
if (launchctl(["print", service], true).status === 0) launchctl(["bootout", service]);
launchctl(["bootstrap", domain, AGENT_PATH]);
launchctl(["enable", service]);
launchctl(["kickstart", "-k", service]);
console.log(JSON.stringify({ installed: true, label: LABEL, plist: AGENT_PATH, logs: LOG_ROOT }, null, 2));
