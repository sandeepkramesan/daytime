#!/usr/bin/env node
/*
 * Copy the version from package.json into app.js (VERSION), which the About
 * sheet shows.
 *
 *   npm version minor --no-git-tag-version && npm run sync-version
 *   npm run sync-version -- --check     (exit 1 if they disagree)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  { file: "app.js", pattern: /(const VERSION = ")[^"]*(";)/, format: (v) => v },
];

function readVersions() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  return TARGETS.map((target) => {
    const source = fs.readFileSync(path.join(ROOT, target.file), "utf8");
    const match = source.match(target.pattern);
    return { ...target, source, expected: target.format(version), actual: match && source.slice(match.index + match[1].length, match.index + match[0].length - match[2].length) };
  });
}

function main() {
  const check = process.argv.includes("--check");
  const results = readVersions();
  let mismatched = false;

  for (const result of results) {
    if (result.actual === result.expected) continue;
    if (check) {
      console.error(`${result.file}: ${result.actual} (expected ${result.expected})`);
      mismatched = true;
      continue;
    }
    const updated = result.source.replace(result.pattern, `$1${result.expected}$2`);
    fs.writeFileSync(path.join(ROOT, result.file), updated);
    console.log(`${result.file}: ${result.actual} -> ${result.expected}`);
  }

  if (mismatched) process.exitCode = 1;
}

module.exports = { readVersions };

if (require.main === module) main();
