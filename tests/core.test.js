"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

const MINUTE = 60 * 1000;

function assertNear(actual, expectedIso, toleranceMinutes = 3) {
  assert.ok(core.isDate(actual), `expected a valid Date, got ${actual}`);
  const difference = Math.abs(actual.getTime() - Date.parse(expectedIso));
  assert.ok(
    difference <= toleranceMinutes * MINUTE,
    `${actual.toISOString()} is not within ${toleranceMinutes} min of ${expectedIso}`
  );
}

test("localDateKey pads months and days in local time", () => {
  assert.equal(core.localDateKey(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(core.localDateKey(new Date(2026, 11, 31, 23, 59)), "2026-12-31");
});

test("localDateKey returns an empty string for invalid dates", () => {
  assert.equal(core.localDateKey(new Date("nope")), "");
  assert.equal(core.localDateKey(null), "");
});

test("startOfWeek returns the Sunday of that week", () => {
  const sunday = new Date(2026, 9, 25);
  assert.equal(core.localDateKey(core.startOfWeek(sunday)), "2026-10-25");
  assert.equal(core.localDateKey(core.startOfWeek(new Date(2026, 9, 31))), "2026-10-25");
});

test("startOfWeek can start on Monday or Saturday", () => {
  const saturday = new Date(2026, 9, 31);
  assert.equal(core.localDateKey(core.startOfWeek(saturday, 1)), "2026-10-26");
  assert.equal(core.localDateKey(core.startOfWeek(saturday, 6)), "2026-10-31");
  const sunday = new Date(2026, 10, 1);
  assert.equal(core.localDateKey(core.startOfWeek(sunday, 1)), "2026-10-26");
});

test("addDays keeps local midnight across month and year boundaries", () => {
  assert.equal(core.localDateKey(core.addDays(new Date(2026, 9, 31), 1)), "2026-11-01");
  assert.equal(core.localDateKey(core.addDays(new Date(2026, 11, 31), 1)), "2027-01-01");
  assert.equal(core.localDateKey(core.addDays(new Date(2026, 0, 1), -1)), "2025-12-31");
  const next = core.addDays(new Date(2026, 2, 28), 1);
  assert.equal(next.getHours(), 0);
  assert.equal(next.getMinutes(), 0);
});

test("dayOfYear counts from 1", () => {
  assert.equal(core.dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(core.dayOfYear(new Date(2026, 11, 31)), 365);
});

test("sunrise and sunset match published almanac times", () => {
  const day = new Date(2026, 9, 31);

  assertNear(core.localSolarTime(day, 12.97, 77.59, true), "2026-10-31T00:42:54Z");
  assertNear(core.localSolarTime(day, 12.97, 77.59, false), "2026-10-31T12:23:34Z");

  assertNear(core.localSolarTime(day, 51.507, -0.128, true), "2026-10-31T06:51:33Z");
  assertNear(core.localSolarTime(day, 51.507, -0.128, false), "2026-10-31T16:35:54Z");

  assertNear(core.localSolarTime(day, 69.65, 18.96, true), "2026-10-31T07:03:41Z");
  assertNear(core.localSolarTime(day, 69.65, 18.96, false), "2026-10-31T13:49:35Z");

  assertNear(core.localSolarTime(day, -36.85, 174.76, true), "2026-10-31T17:17:41Z");
});

test("polar day and polar night return null instead of a wrong time", () => {
  const midsummer = new Date(2026, 5, 21);
  const midwinter = new Date(2026, 11, 21);
  assert.equal(core.localSolarTime(midsummer, 69.65, 18.96, true), null);
  assert.equal(core.localSolarTime(midsummer, 69.65, 18.96, false), null);
  assert.equal(core.localSolarTime(midwinter, 69.65, 18.96, true), null);
  assert.equal(core.localSolarTime(midwinter, 69.65, 18.96, false), null);
});

test("solar calculations reject out-of-range coordinates", () => {
  const day = new Date(2026, 9, 31);
  assert.equal(core.localSolarTime(day, 120, 0, true), null);
  assert.equal(core.localSolarTime(day, 0, 200, true), null);
  assert.equal(core.localSolarTime(day, Number.NaN, 0, true), null);
});

test("taskDateKey reads the date part of a Google Tasks due stamp", () => {
  assert.equal(core.taskDateKey({ due: "2026-10-31T00:00:00.000Z" }), "2026-10-31");
  assert.equal(core.taskDateKey({ due: "2026-10-31" }), "2026-10-31");
  assert.equal(core.taskDateKey({ title: "No due date" }), "");
  assert.equal(core.taskDateKey(null), "");
});

test("agenda sorting puts all-day items first, then the earliest time", () => {
  const items = [
    { kind: "event", allDay: false, date: new Date(2026, 9, 31, 17, 0) },
    { kind: "task", allDay: true, date: new Date(2026, 9, 31) },
    { kind: "event", allDay: false, date: new Date(2026, 9, 31, 9, 0) },
  ].sort(core.compareAgendaItems);

  assert.equal(items[0].allDay, true);
  assert.equal(items[1].date.getHours(), 9);
  assert.equal(items[2].date.getHours(), 17);
});

test("agenda sorting keeps invalid dates last", () => {
  const items = [
    { allDay: false, date: new Date("nope") },
    { allDay: false, date: new Date(2026, 9, 31, 8, 0) },
  ].sort(core.compareAgendaItems);

  assert.equal(items[0].date.getHours(), 8);
  assert.ok(Number.isNaN(items[1].date.getTime()));
});

test("escapeHTML neutralises markup in event titles and locations", () => {
  assert.equal(core.escapeHTML('<img src=x onerror="alert(1)">'), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  assert.equal(core.escapeHTML("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
  assert.equal(core.escapeHTML(null), "");
});

test("normalizeDegrees wraps into 0-360", () => {
  assert.equal(core.normalizeDegrees(-10), 350);
  assert.equal(core.normalizeDegrees(370), 10);
  assert.equal(core.normalizeDegrees(0), 0);
});

test("isDate rejects invalid dates", () => {
  assert.equal(core.isDate(new Date()), true);
  assert.equal(core.isDate(new Date("nope")), false);
  assert.equal(core.isDate(0), false);
});

test("isoWeek follows ISO 8601, including weeks that cross the new year", () => {
  assert.deepEqual(core.isoWeek(new Date(2026, 10, 18)), { week: 47, year: 2026 });
  assert.deepEqual(core.isoWeek(new Date(2026, 0, 1)), { week: 1, year: 2026 }); // a Thursday
  assert.deepEqual(core.isoWeek(new Date(2027, 0, 1)), { week: 53, year: 2026 }); // a Friday
  assert.deepEqual(core.isoWeek(new Date(2024, 11, 30)), { week: 1, year: 2025 }); // a Monday
  assert.deepEqual(core.isoWeek(new Date(2026, 2, 29, 23, 30)), { week: 13, year: 2026 }); // DST night in Europe
});

test("dayOfYear and daysInYear handle leap years", () => {
  assert.equal(core.dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(core.dayOfYear(new Date(2026, 10, 18)), 322);
  assert.equal(core.dayOfYear(new Date(2028, 11, 31)), 366);
  assert.equal(core.daysInYear(2026), 365);
  assert.equal(core.daysInYear(2028), 366);
  assert.equal(core.daysInYear(2100), 365);
});

test("holidayCalendarId maps countries to Google's calendar names", () => {
  assert.equal(core.holidayCalendarId("IN"), "en.indian");
  assert.equal(core.holidayCalendarId("in"), "en.indian");
  assert.equal(core.holidayCalendarId("US"), "en.usa");
  assert.equal(core.holidayCalendarId("GB"), "en.uk");
  assert.equal(core.holidayCalendarId("AE"), "en.ae");
  // "en.sa" is South Africa, so Saudi Arabia needs its own name.
  assert.equal(core.holidayCalendarId("SA"), "en.saudiarabian");
  assert.equal(core.holidayCalendarId("ZA"), "en.sa");
  assert.equal(core.holidayCalendarId("IL"), null);
  assert.equal(core.holidayCalendarId(""), null);
  assert.equal(core.holidayCalendarId(null), null);
});

test("parseHolidayCalendar reads Google's holiday feed", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261108",
    "DTEND;VALUE=DATE:20261109",
    "DESCRIPTION:Public holiday",
    "SUMMARY:Diwali/Deepavali",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261108",
    "DESCRIPTION:Observance\\nTo hide observances\\, go to Google Calendar Setting",
    " s > Holidays in India",
    "SUMMARY:Naraka Chaturdasi",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260504",
    "DESCRIPTION:Public holiday in England\\, Wales",
    "SUMMARY:Early May Bank Holiday",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20260504",
    "DESCRIPTION:Public holiday\\nDate is tentative and may change.",
    "SUMMARY:Early May Bank Holiday",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "DTSTART;VALUE=DATE:20261230",
    "DTEND;VALUE=DATE:20270102",
    "DESCRIPTION:Public holiday",
    "SUMMARY:Year-end break",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const byDate = core.parseHolidayCalendar(ics);

  assert.deepEqual(byDate["2026-11-08"].map((holiday) => [holiday.name, holiday.kind]), [
    ["Diwali/Deepavali", "public"],
    ["Naraka Chaturdasi", "observance"],
  ]);
  // A nationwide entry wins over a regional one with the same name.
  assert.equal(byDate["2026-05-04"].length, 1);
  assert.equal(byDate["2026-05-04"][0].kind, "public");
  assert.equal(byDate["2026-05-04"][0].tentative, true);
  // DTEND is exclusive.
  assert.ok(byDate["2026-12-30"] && byDate["2026-12-31"] && byDate["2027-01-01"]);
  assert.equal(byDate["2027-01-02"], undefined);

  const regional = core.parseHolidayCalendar(
    "BEGIN:VEVENT\nDTSTART;VALUE=DATE:20260317\nDESCRIPTION:Public holiday in Northern Ireland\nSUMMARY:St Patrick's Day\nEND:VEVENT"
  );
  assert.deepEqual(regional["2026-03-17"][0], {
    name: "St Patrick's Day",
    kind: "regional",
    note: "Northern Ireland",
    tentative: false,
  });
  assert.deepEqual(core.parseHolidayCalendar(""), {});
  assert.deepEqual(core.parseHolidayCalendar("<html>error</html>"), {});
});
