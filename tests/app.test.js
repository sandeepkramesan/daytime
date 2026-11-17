"use strict";

/*
 * Behavioural tests for the widget itself.
 *
 * They run app.js against tests/fake-dom.js — enough DOM to exercise the
 * startup path, the connect flow and the network edge cases that used to be
 * broken (partial API failure, expired sessions, stale responses, midnight
 * reset). No browser required.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHarness, wait } = require("./fake-dom.js");

const CLIENT_ID = "1234567890-abcd.apps.googleusercontent.com";

function localKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekdayLabel(date) {
  return new Intl.DateTimeFormat(undefined, { calendar: "gregory", weekday: "long" })
    .format(date)
    .toLocaleUpperCase();
}

function json(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function clickAction(harness, attribute, action) {
  harness.query("#connectBody").dispatch("click", {
    target: { closest: () => ({ dataset: { [attribute]: action } }) },
  });
}

function clickDay(harness, date) {
  harness.query("#weekDays").dispatch("click", {
    target: { closest: () => ({ dataset: { date: localKey(date) } }) },
  });
}

async function connect(harness) {
  harness.query("#calendarLink").dispatch("click", { preventDefault() {} });
  clickAction(harness, "connectAction", "authorize");
  harness.query("#clientIdInput").value = CLIENT_ID;
  clickAction(harness, "connectAction", "save");
  await wait(60);
}

function dayFetch(dayKey) {
  return async (url) => {
    if (url.includes("calendar/v3")) {
      return json({
        items: [
          {
            status: "confirmed",
            summary: "Design review",
            location: "Studio",
            start: { dateTime: `${dayKey}T10:00:00` },
          },
        ],
      });
    }
    return json({});
  };
}

test("starts on today with a seven-day strip", () => {
  const harness = createHarness();
  assert.equal(harness.query("#agendaHeading").textContent, "TODAY");
  assert.match(harness.query("#dayNumber").textContent, /^\d+$/);
  assert.ok(harness.query("#weekday").textContent.length > 2);
  assert.equal(harness.query("#sunStatus").textContent, "LOCATION NEEDED");
});

test("the Google Calendar link starts the connect flow instead of doing nothing", () => {
  const harness = createHarness();
  const dialog = harness.query("#connectDialog");

  harness.query("#calendarLink").dispatch("click", { preventDefault() {} });

  assert.equal(dialog.open, true);
  assert.match(harness.query("#connectBody").innerHTML, /Continue with Google/);
  assert.doesNotMatch(harness.query("#connectBody").innerHTML, /config\.js/);
});

test("without a configured client ID the widget asks for one in-app, then loads the day", async () => {
  const today = new Date();
  const harness = createHarness({ fetch: dayFetch(localKey(today)) });

  harness.query("#calendarLink").dispatch("click", { preventDefault() {} });
  clickAction(harness, "connectAction", "authorize");

  assert.match(harness.query("#connectBody").innerHTML, /id="clientIdInput"/);
  assert.equal(harness.store.size, 0);

  harness.query("#clientIdInput").value = CLIENT_ID;
  clickAction(harness, "connectAction", "save");
  await wait(80);

  assert.equal(harness.store.get("daytime.clientId"), CLIENT_ID);
  assert.ok(harness.calls.includes("initTokenClient"));
  assert.ok(harness.calls.includes("requestAccessToken"));
  assert.equal(harness.query("#connectDialog").open, false);
  assert.ok(harness.calls.some((call) => call.includes("calendar/v3")));
  assert.ok(harness.calls.some((call) => call.includes("tasks/v1")));
  assert.match(harness.content.innerHTML, /Design review/);
  assert.match(harness.content.innerHTML, /Studio/);
});

test("tasks failing does not take the calendar down", async () => {
  const today = new Date();
  const harness = createHarness({
    fetch: async (url) => {
      if (url.includes("calendar/v3")) return dayFetch(localKey(today))(url);
      return json({ error: { message: "Tasks API disabled" } }, 403);
    },
  });

  await connect(harness);

  assert.match(harness.content.innerHTML, /Design review/);
  assert.match(harness.content.innerHTML, /Google refused access to Tasks/);
  assert.match(harness.content.innerHTML, /agenda-warning/);
});

test("an expired session shows a reconnect action", async () => {
  const harness = createHarness({ fetch: async () => json({ error: "invalid_token" }, 401) });

  await connect(harness);

  assert.match(harness.content.innerHTML, /Your Google access expired/);
  assert.match(harness.content.innerHTML, /Reconnect Google Calendar/);
});

test("a slow response for an earlier day cannot overwrite the latest selection", async () => {
  const today = new Date();
  const todayKey = localKey(today);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yesterdayKey = localKey(yesterday);

  const harness = createHarness({
    fetch: async (url) => {
      if (!url.includes("calendar/v3")) return json({ items: [] });
      const start = new Date(new URL(url).searchParams.get("timeMin"));
      const key = localKey(start);
      await wait(key === todayKey ? 120 : 10); // The first day is the slow one.
      return json({
        items: [{ status: "confirmed", summary: `${key} event`, start: { dateTime: `${key}T09:00:00` } }],
      });
    },
  });

  await connect(harness);

  clickDay(harness, today);
  clickDay(harness, yesterday);
  await wait(200);

  assert.doesNotMatch(harness.content.innerHTML, new RegExp(`${todayKey} event`));
  assert.match(harness.content.innerHTML, new RegExp(`${yesterdayKey} event`));
});

test("browsing another day survives the minute tick", () => {
  const harness = createHarness();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2);

  clickDay(harness, yesterday);
  assert.equal(harness.query("#agendaHeading").textContent, weekdayLabel(yesterday));

  harness.tick();

  assert.equal(harness.query("#agendaHeading").textContent, weekdayLabel(yesterday));
  assert.equal(harness.query("#dayNumber").textContent, String(yesterday.getDate()));
});

test("today keeps the white pill while another day is ringed", () => {
  const harness = createHarness();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  clickDay(harness, yesterday);

  assert.equal(harness.query("#todayButton").hidden, false);
  assert.equal(harness.query("#agendaHeading").textContent, weekdayLabel(yesterday));
});

test("disconnecting clears the session and offers the connect flow again", async () => {
  const today = new Date();
  const harness = createHarness({ fetch: dayFetch(localKey(today)) });

  await connect(harness);
  harness.query("#aboutButton").dispatch("click", {});
  harness.query("#aboutBody").dispatch("click", {
    target: { closest: () => ({ dataset: { aboutAction: "disconnect" } }) },
  });

  assert.equal(harness.query("#aboutDialog").open, false);
  assert.equal(harness.query("#refreshButton").disabled, false);
  assert.equal(harness.content.children.length, 1);

  harness.query("#refreshButton").dispatch("click", {});
  assert.equal(harness.query("#connectDialog").open, true);
});

test("a client ID pasted in the app wins over the default in config.js", async () => {
  const today = new Date();
  const harness = createHarness({
    fetch: dayFetch(localKey(today)),
    config: { googleClientId: "999-default.apps.googleusercontent.com" },
    storage: { "daytime.clientId": CLIENT_ID },
  });

  harness.query("#calendarLink").dispatch("click", { preventDefault() {} });
  clickAction(harness, "connectAction", "authorize");
  await wait(60);

  assert.ok(harness.calls.includes(`client:${CLIENT_ID}`));
  assert.ok(!harness.calls.includes("client:999-default.apps.googleusercontent.com"));
});

test("events from every shown calendar are merged, and shared invites appear once", async () => {
  const dayKey = localKey(new Date());
  const harness = createHarness({
    fetch: async (url) => {
      if (url.includes("/calendarList")) {
        return json({
          items: [
            { id: "me@example.com", primary: true },
            { id: "family#group", selected: true },
            { id: "hidden-cal", selected: true, hidden: true },
            { id: "unselected-cal", selected: false },
          ],
        });
      }
      if (url.includes("/calendars/me%40example.com/events")) {
        return json({
          items: [
            { iCalUID: "shared-1", status: "confirmed", summary: "Team sync", start: { dateTime: `${dayKey}T09:00:00` } },
          ],
        });
      }
      if (url.includes("/calendars/family%23group/events")) {
        return json({
          items: [
            { iCalUID: "shared-1", status: "confirmed", summary: "Team sync", start: { dateTime: `${dayKey}T09:00:00` } },
            { iCalUID: "fam-1", status: "confirmed", summary: "School pickup", start: { dateTime: `${dayKey}T15:00:00` } },
          ],
        });
      }
      if (url.includes("calendar/v3")) throw new Error(`unexpected calendar ${url}`);
      return json({});
    },
  });

  await connect(harness);

  const html = harness.content.innerHTML;
  assert.match(html, /School pickup/);
  assert.equal(html.match(/Team sync/g).length, 1);
  assert.match(html, /2 items for your day/);
  assert.ok(!harness.calls.some((call) => call.includes("hidden-cal") || call.includes("unselected-cal")));
});

test("without calendar-list access only the primary calendar is read", async () => {
  const dayKey = localKey(new Date());
  const harness = createHarness({
    fetch: async (url) => {
      if (url.includes("/calendarList")) return json({ error: { message: "Insufficient scopes" } }, 403);
      return dayFetch(dayKey)(url);
    },
  });

  await connect(harness);

  assert.ok(harness.calls.some((call) => call.includes("/calendars/primary/events")));
  assert.match(harness.content.innerHTML, /Design review/);
});

test("tasks are requested for the selected day only", async () => {
  const today = new Date();
  const dayKey = localKey(today);
  const harness = createHarness({
    fetch: async (url) => {
      if (url.includes("/users/@me/lists")) return json({ items: [{ id: "list-1", title: "My Tasks" }] });
      if (url.includes("/lists/list-1/tasks")) {
        return json({ items: [{ id: "t1", title: "Pay rent", status: "needsAction", due: `${dayKey}T00:00:00.000Z` }] });
      }
      return dayFetch(dayKey)(url);
    },
  });

  await connect(harness);

  const taskCall = harness.calls.find((call) => call.includes("/lists/list-1/tasks"));
  const params = new URL(taskCall).searchParams;
  assert.equal(params.get("dueMin"), `${dayKey}T00:00:00.000Z`);
  assert.equal(params.get("dueMax"), `${dayKey}T23:59:59.999Z`);
  assert.match(harness.content.innerHTML, /Pay rent/);
});

test("the week strip can start on Monday", () => {
  const harness = createHarness({ config: { weekStart: "monday" } });
  const labels = harness.query("#weekLabels").children.map((child) => child.textContent);
  const days = harness.query("#weekDays").children;

  assert.equal(labels.length, 7);
  assert.equal(new Date(`${days[0].dataset.date}T00:00:00`).getDay(), 1);
  assert.equal(new Date(`${days[6].dataset.date}T00:00:00`).getDay(), 0);
});

test("a location shared earlier is remembered for sunrise and sunset", () => {
  const harness = createHarness({
    storage: { "daytime.location": JSON.stringify({ latitude: 51.51, longitude: -0.13 }) },
  });

  assert.match(harness.query("#sunriseTime").textContent, /\d/);
  assert.match(harness.query("#sunsetTime").textContent, /\d/);
  assert.notEqual(harness.query("#sunStatus").textContent, "LOCATION NEEDED");
});

test("an expired session renews on the next click instead of asking to sign in again", async () => {
  const dayKey = localKey(new Date());
  let calendarCalls = 0;
  const harness = createHarness({
    fetch: async (url) => {
      if (url.includes("calendar/v3")) {
        calendarCalls += 1;
        if (calendarCalls === 1) return json({ error: "invalid_token" }, 401);
      }
      return dayFetch(dayKey)(url);
    },
  });

  await connect(harness);
  assert.match(harness.content.innerHTML, /Reconnect Google Calendar/);

  harness.content.dispatch("click", { target: { closest: () => ({ dataset: { action: "reconnect" } }) } });
  await wait(60);

  assert.equal(harness.calls.filter((call) => call === "requestAccessToken").length, 2);
  assert.equal(harness.query("#connectDialog").open, false);
  assert.match(harness.content.innerHTML, /Design review/);
});
