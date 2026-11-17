#!/usr/bin/env node
"use strict";

/*
 * Launcher for the daytime desktop note.
 *
 * ELECTRON_RUN_AS_NODE makes electron.exe behave like plain Node and crash the
 * app before a window exists. Windows environment variables are case-insensitive,
 * so the variable is filtered case-insensitively rather than deleted by an exact
 * name. Everything the child prints is mirrored to desktop/launch.log.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOG = path.join(__dirname, "launch.log");
fs.writeFileSync(LOG, "");

function log(line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  process.stdout.write(text);
  try {
    fs.appendFileSync(LOG, text);
  } catch {
    /* Logging must never stop the app. */
  }
}

log("daytime desktop launcher");

const electron = require("electron");
if (typeof electron !== "string") {
  log("This launcher must run with Node, not inside Electron.");
  process.exit(1);
}
log(`electron binary: ${electron}`);

try {
  const stats = fs.statSync(electron);
  log(`binary size: ${Math.round(stats.size / 1024 / 1024)} MB`);
} catch (error) {
  log(`electron binary missing: ${error.message}`);
  log("Install it with: npm install   (or: node node_modules/electron/install.js)");
  process.exit(1);
}

const env = {};
for (const [key, value] of Object.entries(process.env)) {
  if (key.toUpperCase() === "ELECTRON_RUN_AS_NODE") continue;
  env[key] = value;
}
log(`ELECTRON_RUN_AS_NODE removed from child env: ${!("ELECTRON_RUN_AS_NODE" in env)}`);

// Chromium can fail hard (0x80000003 / STATUS_BREAKPOINT) on machines with a
// restricted GPU sandbox, older AMD drivers, or aggressive exploit protection.
// Try progressively safer flags before giving up.
const ATTEMPTS = [
  { label: "default", args: [] },
  { label: "no-sandbox", args: ["--no-sandbox"] },
  { label: "no-sandbox + software rendering", args: ["--no-sandbox", "--disable-gpu", "--disable-gpu-compositing"] },
];

function runAttempt(index) {
  if (index >= ATTEMPTS.length) {
    log("Electron failed with every fallback. See desktop/launch.log for details.");
    process.exit(1);
  }

  const attempt = ATTEMPTS[index];
  log(`launching (${attempt.label})`);
  const startedAt = Date.now();

  let child;
  try {
    child = spawn(electron, [__dirname, ...process.argv.slice(2), ...attempt.args], {
      cwd: __dirname,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    log(`spawn threw: ${error.message}`);
    log("If an antivirus quarantined electron.exe, restore it or add an exclusion.");
    process.exit(1);
  }

  child.stdout.on("data", (data) => log(`electron: ${data.toString().trimEnd()}`));
  child.stderr.on("data", (data) => log(`electron: ${data.toString().trimEnd()}`));

  child.on("error", (error) => {
    log(`spawn failed: ${error.message}`);
    log("If an antivirus quarantined electron.exe, restore it or add an exclusion.");
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    const elapsed = Date.now() - startedAt;
    log(`electron exited: code=${code} signal=${signal} after ${elapsed} ms`);

    // A fast non-zero exit means it never got as far as a window.
    if (code !== 0 && elapsed < 15000 && index < ATTEMPTS.length - 1) {
      log("retrying with safer Chromium flags");
      runAttempt(index + 1);
      return;
    }
    process.exit(code ?? 0);
  });
}

runAttempt(0);
