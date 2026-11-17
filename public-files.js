/*
 * The only files the local servers (server.js, desktop/main.js) may serve.
 *
 * The repository also holds keystores, OAuth secrets, .git and browser
 * profiles, so the servers use an allowlist instead of "everything under the
 * folder". Keep this list in sync with APP_SHELL in sw.js and PublicFiles in
 * desktop/native/DaytimeNote.cs.
 */
"use strict";

const PUBLIC_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "cities.js",
  "config.js",
  "sw.js",
  "logo.svg",
  "manifest.webmanifest",
]);

const PUBLIC_PATTERNS = [/^icons\/[a-z0-9-]+\.png$/i];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Map a decoded URL pathname to a servable relative path, or null.
 * "/" maps to index.html. Anything outside the allowlist is refused.
 */
function publicPath(pathname) {
  if (typeof pathname !== "string") return null;
  let relative = pathname.replace(/^\/+/, "");
  if (relative === "") relative = "index.html";
  if (relative.includes("\\") || relative.includes("\0")) return null;
  if (relative.split("/").some((segment) => segment === "" || segment.startsWith("."))) return null;
  if (PUBLIC_FILES.has(relative)) return relative;
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(relative))) return relative;
  return null;
}

/**
 * Reject requests whose Host header is not a loopback name (or an explicitly
 * allowed one). This blocks DNS-rebinding pages from reading the server.
 */
function isAllowedHost(hostHeader, extraHosts = []) {
  if (typeof hostHeader !== "string" || hostHeader === "") return false;
  const host = hostHeader.trim().toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (LOOPBACK_HOSTS.has(name)) return true;
  return extraHosts.some((extra) => String(extra).trim().toLowerCase() === name);
}

module.exports = { PUBLIC_FILES, publicPath, isAllowedHost };
