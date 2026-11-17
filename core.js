/*
 * daytime core helpers.
 *
 * Pure date, sun and formatting maths shared by the widget and the test suite.
 * Loaded as a classic script in the browser (window.DaytimeCore) and required
 * directly by Node in tests (module.exports).
 */
(function (root, factory) {
  "use strict";

  const api = factory();

  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DaytimeCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MS_PER_DAY = 86400000;

  function normalizeDegrees(value) {
    return ((value % 360) + 360) % 360;
  }

  function isDate(value) {
    return value instanceof Date && Number.isFinite(value.getTime());
  }

  /** Local calendar day as `YYYY-MM-DD`. Never use toISOString() for this. */
  function localDateKey(date) {
    if (!isDate(date)) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  /** Add whole days in local time; DST-safe because setDate keeps wall-clock time. */
  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return startOfLocalDay(next);
  }

  /**
   * Local midnight of the first day of the week containing `date`.
   * `weekStartsOn` is 0 = Sunday (default) … 6 = Saturday, so the strip can
   * follow the user's region (Monday in most of Europe, Sunday in the US).
   */
  function startOfWeek(date, weekStartsOn = 0) {
    const first = Number.isInteger(weekStartsOn) ? ((weekStartsOn % 7) + 7) % 7 : 0;
    const start = startOfLocalDay(date);
    start.setDate(start.getDate() - ((start.getDay() - first + 7) % 7));
    return start;
  }

  function dayOfYear(date) {
    const year = date.getFullYear();
    return Math.floor((Date.UTC(year, date.getMonth(), date.getDate()) - Date.UTC(year, 0, 0)) / MS_PER_DAY);
  }

  function daysInYear(year) {
    return new Date(year, 1, 29).getDate() === 29 ? 366 : 365;
  }

  /**
   * ISO 8601 week number: weeks start on Monday and week 1 is the week with
   * the year's first Thursday, so 1 Jan can belong to week 52/53 of the year
   * before. Returns the week and the year it belongs to.
   */
  function isoWeek(date) {
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const weekday = day.getUTCDay() || 7;
    day.setUTCDate(day.getUTCDate() + 4 - weekday);
    const year = day.getUTCFullYear();
    const week = Math.ceil(((day - Date.UTC(year, 0, 1)) / MS_PER_DAY + 1) / 7);
    return { week, year };
  }

  /* ---------------------------------------------------------------- *
   * Public holidays (Google's public holiday calendars, iCalendar)
   * ---------------------------------------------------------------- */

  // Every country Google publishes a holiday calendar for (checked 2026-11).
  const HOLIDAY_REGIONS = new Set(
    (
      "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ " +
      "BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR " +
      "CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FK FM FO FR " +
      "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID " +
      "IE IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA " +
      "LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
      "MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE " +
      "PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG " +
      "SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN " +
      "TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE " +
      "YT ZA ZM ZW"
    ).split(" ")
  );

  // Google's older calendars are named, not coded ("en.indian"); the newer
  // ones use the ISO code ("en.ae"). Note "en.sa" is South Africa.
  const HOLIDAY_CALENDAR_NAMES = {
    AT: "austrian", AU: "australian", BG: "bulgarian", BR: "brazilian", CA: "canadian",
    CN: "china", CZ: "czech", DE: "german", DK: "danish", ES: "spain", FI: "finnish",
    FR: "french", GB: "uk", GR: "greek", HK: "hong_kong", HR: "croatian", HU: "hungarian",
    ID: "indonesian", IE: "irish", IN: "indian", IT: "italian", JP: "japanese",
    KR: "south_korea", LT: "lithuanian", LV: "latvian", MX: "mexican", MY: "malaysia",
    NL: "dutch", NO: "norwegian", NZ: "new_zealand", PH: "philippines", PL: "polish",
    PT: "portuguese", RO: "romanian", RU: "russian", SA: "saudiarabian", SE: "swedish",
    SG: "singapore", SI: "slovenian", SK: "slovak", TR: "turkish", TW: "taiwan",
    UA: "ukrainian", US: "usa", VN: "vietnamese", ZA: "sa",
  };

  /** "IN" -> "en.indian", "AE" -> "en.ae"; null when Google has no calendar. */
  function holidayCalendarId(region) {
    const code = String(region || "").toUpperCase();
    if (!HOLIDAY_REGIONS.has(code)) return null;
    return `en.${HOLIDAY_CALENDAR_NAMES[code] || code.toLowerCase()}`;
  }

  function parseICSDate(value) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(value || "");
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isDate(date) ? date : null;
  }

  function unescapeICS(value) {
    return String(value || "").replace(/\\([nN,;\\])/g, (_, character) =>
      character === "n" || character === "N" ? "\n" : character
    );
  }

  const HOLIDAY_RANK = { public: 0, regional: 1, observance: 2 };

  /**
   * Parse a Google holiday calendar (.ics) into { "YYYY-MM-DD": [holiday] }.
   * Each holiday is { name, kind, note, tentative } where kind is "public"
   * (nationwide), "regional" (some states/provinces; note names them) or
   * "observance" (marked but not a day off). Google says which in DESCRIPTION.
   */
  function parseHolidayCalendar(text) {
    const byDate = {};
    const unfolded = String(text || "").replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "");

    for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
      const fields = {};
      for (const line of block.split("\n")) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const name = line.slice(0, colon).split(";")[0].toUpperCase();
        if (!(name in fields)) fields[name] = line.slice(colon + 1);
      }

      const start = parseICSDate(fields.DTSTART);
      const title = unescapeICS(fields.SUMMARY).trim();
      if (!start || !title || /^CANCELLED$/i.test(fields.STATUS || "")) continue;

      const description = unescapeICS(fields.DESCRIPTION);
      const firstLine = description.split("\n")[0].trim();
      let kind = "public";
      let note = "";
      if (/^observance/i.test(firstLine)) kind = "observance";
      else if (/^public holiday in /i.test(firstLine)) {
        kind = "regional";
        note = firstLine.replace(/^public holiday in /i, "");
      }
      const holiday = { name: title, kind, note, tentative: /tentative/i.test(description) };

      // DTEND is exclusive; a few holidays span several days.
      const end = parseICSDate(fields.DTEND);
      let day = start;
      for (let count = 0; count < 31 && (count === 0 || (end && day < end)); count += 1) {
        const key = localDateKey(day);
        const list = byDate[key] || (byDate[key] = []);
        const same = list.findIndex((entry) => entry.name.toLowerCase() === title.toLowerCase());
        if (same === -1) list.push(holiday);
        else if (HOLIDAY_RANK[kind] < HOLIDAY_RANK[list[same].kind]) list[same] = holiday;
        day = addDays(day, 1);
      }
    }

    for (const list of Object.values(byDate)) {
      list.sort((left, right) => HOLIDAY_RANK[left.kind] - HOLIDAY_RANK[right.kind]);
    }
    return byDate;
  }

  /**
   * Sunrise/sunset (NOAA / "sunrise equation") for a local calendar day.
   * Returns the UTC instant of the event, or null during polar day/night.
   */
  function localSolarTime(date, latitude, longitude, isSunrise) {
    if (!isDate(date) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

    const doy = dayOfYear(date);
    const longitudeHour = longitude / 15;
    const approximate = doy + ((isSunrise ? 6 : 18) - longitudeHour) / 24;
    const meanAnomaly = 0.9856 * approximate - 3.289;
    const trueLongitude = normalizeDegrees(
      meanAnomaly +
        1.916 * Math.sin(meanAnomaly * Math.PI / 180) +
        0.02 * Math.sin(2 * meanAnomaly * Math.PI / 180) +
        282.634
    );

    let rightAscension = normalizeDegrees(Math.atan(0.91764 * Math.tan(trueLongitude * Math.PI / 180)) * 180 / Math.PI);
    rightAscension += Math.floor(trueLongitude / 90) * 90 - Math.floor(rightAscension / 90) * 90;
    rightAscension /= 15;

    const sinDeclination = 0.39782 * Math.sin(trueLongitude * Math.PI / 180);
    const cosDeclination = Math.cos(Math.asin(sinDeclination));
    const latitudeRadians = latitude * Math.PI / 180;
    const cosineHourAngle =
      (Math.cos(90.833 * Math.PI / 180) - sinDeclination * Math.sin(latitudeRadians)) /
      (cosDeclination * Math.cos(latitudeRadians));

    if (!Number.isFinite(cosineHourAngle) || cosineHourAngle > 1 || cosineHourAngle < -1) return null;

    const hourAngle = (isSunrise
      ? 360 - Math.acos(cosineHourAngle) * 180 / Math.PI
      : Math.acos(cosineHourAngle) * 180 / Math.PI) / 15;

    const localMeanTime = hourAngle + rightAscension - 0.06571 * approximate - 6.622;
    const utcHours = ((localMeanTime - longitudeHour) % 24 + 24) % 24;
    const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return new Date(utcMidnight + utcHours * 60 * 60 * 1000);
  }

  /** Google Tasks returns `due` as UTC midnight for a date; the date part is the due day. */
  function taskDateKey(task) {
    if (!task || typeof task.due !== "string") return "";
    return task.due.slice(0, 10);
  }

  /** All-day items first, then chronological. Invalid dates sort last. */
  function compareAgendaItems(left, right) {
    if (Boolean(left.allDay) !== Boolean(right.allDay)) return left.allDay ? -1 : 1;
    const leftTime = isDate(left.date) ? left.date.getTime() : Number.MAX_SAFE_INTEGER;
    const rightTime = isDate(right.date) ? right.date.getTime() : Number.MAX_SAFE_INTEGER;
    return leftTime - rightTime;
  }

  const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
  }

  return {
    addDays,
    compareAgendaItems,
    dayOfYear,
    daysInYear,
    escapeHTML,
    HOLIDAY_REGIONS,
    holidayCalendarId,
    isDate,
    isoWeek,
    localDateKey,
    localSolarTime,
    normalizeDegrees,
    parseHolidayCalendar,
    startOfLocalDay,
    startOfWeek,
    taskDateKey,
  };
});
