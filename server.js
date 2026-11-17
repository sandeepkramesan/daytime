#!/usr/bin/env node
/*
 * Tiny static server for local development.
 *
 *   npm start            → http://127.0.0.1:4173
 *   PORT=8080 npm start  → http://127.0.0.1:8080
 *
 * Google OAuth requires an origin that matches the "Authorized JavaScript
 * origins" entry exactly, so keep the default port unless you also update it in
 * the Google Cloud Console.
 */
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { publicPath, isAllowedHost } = require("./public-files.js");

const ROOT = __dirname;
const PORT = Number.parseInt(process.env.PORT || "4173", 10);
const HOST = process.env.HOST || "127.0.0.1";
// Extra Host header names to accept besides localhost/127.0.0.1/[::1], e.g.
// ALLOWED_HOSTS=192.168.1.20 when HOST=0.0.0.0 for testing on a phone.
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function handleRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    send(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
    return;
  }

  if (!isAllowedHost(request.headers.host, ALLOWED_HOSTS)) {
    send(response, 421, "Misdirected request");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  const relative = publicPath(pathname);
  if (!relative) {
    send(response, 404, "Not found");
    return;
  }

  const filePath = path.join(ROOT, relative);
  let stats;
  try {
    stats = fs.statSync(filePath);
  } catch {
    send(response, 404, "Not found");
    return;
  }

  if (!stats.isFile()) {
    send(response, 404, "Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": stats.size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(filePath)
    .on("error", () => response.destroy())
    .pipe(response);
}

function createServer() {
  return http.createServer(handleRequest);
}

module.exports = { createServer, handleRequest };

if (require.main !== module) return;

const server = createServer();

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try: PORT=8080 npm start`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(PORT, HOST, () => {
  console.log(`daytime is running at http://${HOST}:${PORT}`);
  console.log("Add that exact origin under Authorized JavaScript origins in Google Cloud Console.");
});
