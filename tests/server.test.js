"use strict";

/*
 * The local servers must only serve the web app itself. The repository also
 * holds OAuth secrets (.data/), Android keystores, .git and browser profiles.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { publicPath, isAllowedHost, holidayIdFromPath } = require("../public-files.js");
const { createServer } = require("../server.js");
const { readVersions } = require("../tools/sync-version.js");

test("publicPath allows the app files only", () => {
  assert.equal(publicPath("/"), "index.html");
  assert.equal(publicPath("/index.html"), "index.html");
  assert.equal(publicPath("/app.js"), "app.js");
  assert.equal(publicPath("/logo.svg"), "logo.svg");

  for (const blocked of [
    "/.data/client_secret_daytime.json",
    "/android/keystore.properties",
    "/android/release.keystore",
    "/.git/config",
    "/desktop/data/Network/Cookies",
    "/server.js",
    "/package.json",
    "/../secret",
    "/icons/icon-192.png",
    "/desktop/daytime.ico",
    "/x/../.data/x",
    "/x" + String.fromCharCode(92) + "app.js", // a Windows-style backslash path
    "/.env",
  ]) {
    assert.equal(publicPath(blocked), null, blocked);
  }
});

test("isAllowedHost accepts loopback names and rejects rebinding hosts", () => {
  assert.ok(isAllowedHost("127.0.0.1:4173"));
  assert.ok(isAllowedHost("localhost:4173"));
  assert.ok(isAllowedHost("[::1]:4173"));
  assert.ok(isAllowedHost("LOCALHOST"));
  assert.equal(isAllowedHost("evil.example:4173"), false);
  assert.equal(isAllowedHost("127.0.0.1.evil.example"), false);
  assert.equal(isAllowedHost(""), false);
  assert.equal(isAllowedHost(undefined), false);
  assert.ok(isAllowedHost("192.168.1.20:4173", ["192.168.1.20"]));
});

function request(port, pathname, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: host } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("the dev server refuses secrets, traversal and foreign Host headers", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    assert.equal(await request(port, "/"), 200);
    assert.equal(await request(port, "/index.html"), 200);
    assert.equal(await request(port, "/logo.svg"), 200);
    assert.equal(await request(port, "/.data/client_secret_daytime.json"), 404);
    assert.equal(await request(port, "/android/keystore.properties"), 404);
    assert.equal(await request(port, "/.git/config"), 404);
    assert.equal(await request(port, "/%2e%2e/%2e%2e/Windows/win.ini"), 404);
    assert.equal(await request(port, "/index.html", "attacker.example"), 421);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("app.js carries the package.json version", () => {
  for (const result of readVersions()) {
    assert.equal(result.actual, result.expected, `${result.file} — run npm run sync-version`);
  }
});

test("holidayIdFromPath only accepts Google holiday calendar names", () => {
  assert.equal(holidayIdFromPath("/holidays/en.indian.ics"), "en.indian");
  assert.equal(holidayIdFromPath("/holidays/en.new_zealand.ics"), "en.new_zealand");
  for (const blocked of [
    "/holidays/en.indian",
    "/holidays/../config.js",
    "/holidays/en.indian.ics/x",
    "/holidays/en.x%23y.ics",
    "/holidays/en.evil.example.ics",
    "/holidays/https://evil.example/x.ics",
    "/holidays/EN.INDIAN.ics",
    "/holidays/en.indian.ics\n",
  ]) {
    assert.equal(holidayIdFromPath(blocked), null, blocked);
  }
});

function get(port, pathname, host = `127.0.0.1:${port}`) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, method: "GET", headers: { Host: host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("the dev server relays one Google holiday calendar and caches it", async () => {
  const requested = [];
  const server = createServer({
    fetchHolidays: async (id) => {
      requested.push(id);
      if (id === "en.usa") throw new Error("offline");
      return "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n";
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const first = await get(port, "/holidays/en.indian.ics");
    assert.equal(first.status, 200);
    assert.match(first.type, /^text\/calendar/);
    assert.match(first.body, /^BEGIN:VCALENDAR/);
    assert.equal((await get(port, "/holidays/en.indian.ics")).status, 200);
    assert.deepEqual(requested, ["en.indian"]);

    assert.equal((await get(port, "/holidays/en.usa.ics")).status, 502);
    assert.equal((await get(port, "/holidays/evil.ics")).status, 404);
    assert.equal((await get(port, "/holidays/en.indian.ics", "attacker.example")).status, 421);
    assert.deepEqual(requested, ["en.indian", "en.usa"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
