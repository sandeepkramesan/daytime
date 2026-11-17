/*
 * The only files the local servers (server.js, desktop/DaytimeNote.cs) may serve.
 *
 * The repository also holds keystores, OAuth secrets, .git and browser
 * profiles, so the servers use an allowlist instead of "everything under the
 * folder". Keep this list in sync with PublicFiles in desktop/DaytimeNote.cs
 * and $webFiles in desktop/daytime.ps1.
 */
"use strict";

const PUBLIC_FILES = new Set([
  "index.html",
  "styles.css",
  "app.js",
  "core.js",
  "cities.js",
  "config.js",
  "logo.svg",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Besides the files, the servers answer /holidays/<id>.ics by fetching that one
// Google public holiday calendar (Google sends no CORS headers, so the page
// cannot read it directly). Only this fixed Google URL is ever fetched.
const HOLIDAY_PATH = /^\/holidays\/(en\.[a-z_]{2,24})\.ics$/;

/** "/holidays/en.indian.ics" -> "en.indian"; anything else -> null. */
function holidayIdFromPath(pathname) {
  const match = typeof pathname === "string" ? HOLIDAY_PATH.exec(pathname) : null;
  return match ? match[1] : null;
}

function googleHolidayUrl(id) {
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(`${id}#holiday@group.v.calendar.google.com`)}/public/basic.ics`;
}

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
  return PUBLIC_FILES.has(relative) ? relative : null;
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

module.exports = { PUBLIC_FILES, publicPath, isAllowedHost, holidayIdFromPath, googleHolidayUrl };
