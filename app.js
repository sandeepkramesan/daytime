/*
 * daytime — calendar + tasks widget.
 *
 * Everything runs in the browser: no build step, no server, no analytics.
 * Google access is read-only and the OAuth token is kept in memory only.
 */
(() => {
  "use strict";

  const VERSION = "1.4.0";
  const core = window.DaytimeCore;
  const $ = (selector, scope = document) => scope.querySelector(selector);

  const elements = {
    weekday: $("#weekday"),
    dayNumber: $("#dayNumber"),
    month: $("#month"),
    year: $("#year"),
    clock: $("#clock"),
    sunrise: $("#sunriseTime"),
    sunset: $("#sunsetTime"),
    location: $("#locationButton"),
    sunStatus: $("#sunStatus"),
    prevWeek: $("#prevWeek"),
    nextWeek: $("#nextWeek"),
    weekDays: $("#weekDays"),
    heading: $("#agendaHeading"),
    todayButton: $("#todayButton"),
    calendarLink: $("#calendarLink"),
    content: $("#agendaContent"),
    refresh: $("#refreshButton"),
    about: $("#aboutButton"),
    backButton: $("#backButton"),
    closeButton: $("#closeButton"),
    weekLabels: $("#weekLabels"),
    live: $("#liveMessage"),
    welcomeTemplate: $("#welcomeTemplate"),
    connectDialog: $("#connectDialog"),
    connectBody: $("#connectBody"),
    closeConnect: $("#closeConnect"),
    aboutDialog: $("#aboutDialog"),
    aboutBody: $("#aboutBody"),
    closeAbout: $("#closeAbout"),
  };

  if (!core) {
    console.error("daytime: core.js did not load, so the widget cannot start.");
    return;
  }

  const config = Object.assign(
    { googleClientId: "", timeFormat: "locale", weekStart: "locale", location: null },
    window.daytime_CONFIG && typeof window.daytime_CONFIG === "object" ? window.daytime_CONFIG : {}
  );

  // The native desktop shell loads the page with ?shell=desktop: no frame,
  // fixed sizing, and the header becomes a window drag handle.
  const shellMode = new URLSearchParams(location.search).get("shell") === "desktop";
  if (shellMode) document.documentElement.classList.add("shell");

  const GOOGLE_SCOPE = [
    "https://www.googleapis.com/auth/calendar.events.readonly",
    // Lets daytime list which calendars you have (shared, family, work) so
    // their events show up too. If it is not granted, only the primary
    // calendar is read.
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    "https://www.googleapis.com/auth/tasks.readonly",
  ].join(" ");
  const CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/i;
  const STORAGE_KEY = "daytime.clientId";
  const LOCATION_KEY = "daytime.location";
  const REQUEST_TIMEOUT_MS = 20000;
  const LIST_TTL_MS = 10 * 60 * 1000;
  // A cheap one-second tick keeps the clock exact at the minute boundary;
  // the DOM is only touched when the displayed text changes.
  const TICK_MS = 1000;
  // Renew the Google token on the next user action when it is this close to expiring.
  const TOKEN_RENEW_MARGIN_MS = 5 * 60 * 1000;

  const state = {
    selectedDate: core.startOfLocalDay(new Date()),
    todayKey: core.localDateKey(new Date()),
    weekStartsOn: resolveWeekStart(config.weekStart),
    accessToken: null,
    tokenExpiresAt: 0,
    tokenClient: null,
    hadSession: false,
    connecting: false,
    libraryPromise: null,
    citiesPromise: null,
    location: readConfiguredLocation(config.location) || readSavedLocation(),
    agendaRun: 0,
    agendaController: null,
    calendars: null,
    calendarsFetchedAt: 0,
    taskLists: null,
    taskListsFetchedAt: 0,
    connectView: "intro",
    connectError: "",
  };

  class RequestError extends Error {
    constructor(message, { reconnect = false } = {}) {
      super(message);
      this.name = "RequestError";
      this.reconnect = reconnect;
    }
  }

  /* ------------------------------------------------------------------ *
   * Formatters
   * ------------------------------------------------------------------ */

  const formatters = (() => {
    const gregorian = { calendar: "gregory" };
    const hourCycle =
      config.timeFormat === "24h" ? "h23" : config.timeFormat === "12h" ? "h12" : null;
    const timeOptions = { hour: "2-digit", minute: "2-digit" };
    if (hourCycle) timeOptions.hourCycle = hourCycle;

    return {
      time: new Intl.DateTimeFormat(undefined, timeOptions),
      weekday: new Intl.DateTimeFormat(undefined, { ...gregorian, weekday: "long" }),
      month: new Intl.DateTimeFormat(undefined, { ...gregorian, month: "long" }),
      day: new Intl.DateTimeFormat(undefined, { ...gregorian, day: "numeric" }),
      year: new Intl.DateTimeFormat(undefined, { ...gregorian, year: "numeric" }),
      narrowWeekday: new Intl.DateTimeFormat(undefined, { ...gregorian, weekday: "narrow" }),
    };
  })();

  function formatTime(date) {
    if (!core.isDate(date)) return "—";
    try {
      return formatters.time.format(date);
    } catch {
      return "—";
    }
  }

  function longDay(date) {
    return `${formatters.weekday.format(date)}, ${formatters.month.format(date)} ${formatters.day.format(date)}`;
  }

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */

  function isConnected() {
    return Boolean(state.accessToken) && state.tokenExpiresAt > Date.now();
  }

  function isAbort(error) {
    return Boolean(error) && error.name === "AbortError";
  }

  function announce(message) {
    elements.live.textContent = message;
  }

  function readStoredClientId() {
    try {
      return localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function writeStoredClientId(value) {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Private browsing: the value simply won't persist. */
    }
  }

  function configuredClientId() {
    return String(config.googleClientId || "").trim();
  }

  /** A client ID the user pasted in-app wins over the deployer's default in config.js. */
  function activeClientId() {
    return readStoredClientId().trim() || configuredClientId();
  }

  /** 0 = Sunday … 6 = Saturday. "locale" follows the browser's region. */
  function resolveWeekStart(setting) {
    const named = { sunday: 0, monday: 1, saturday: 6 };
    const key = String(setting || "locale").toLowerCase();
    if (key in named) return named[key];
    try {
      const locale = new Intl.Locale(navigator.language || "en-US");
      const info = typeof locale.getWeekInfo === "function" ? locale.getWeekInfo() : locale.weekInfo;
      if (info && Number.isInteger(info.firstDay)) return info.firstDay % 7; // Intl uses 7 for Sunday.
    } catch {
      /* Older engines: fall through to Sunday. */
    }
    return 0;
  }

  function validCoordinates(latitude, longitude) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180
    );
  }

  function readConfiguredLocation(value) {
    if (!value || typeof value !== "object") return null;
    const latitude = Number(value.latitude ?? value.lat);
    const longitude = Number(value.longitude ?? value.lng ?? value.lon);
    if (!validCoordinates(latitude, longitude)) return null;
    return { latitude, longitude, source: "config", city: null };
  }

  /** A location the user chose to share earlier, kept on this device only. */
  function readSavedLocation() {
    try {
      const saved = JSON.parse(localStorage.getItem(LOCATION_KEY) || "null");
      if (!saved) return null;
      const latitude = Number(saved.latitude);
      const longitude = Number(saved.longitude);
      if (!validCoordinates(latitude, longitude)) return null;
      return { latitude, longitude, source: "saved", city: null };
    } catch {
      return null;
    }
  }

  function writeSavedLocation(latitude, longitude) {
    try {
      if (latitude === null) {
        localStorage.removeItem(LOCATION_KEY);
        return;
      }
      // Two decimals (~1 km) is plenty for sunrise/sunset and keeps less detail on disk.
      const round = (value) => Math.round(value * 100) / 100;
      localStorage.setItem(
        LOCATION_KEY,
        JSON.stringify({ latitude: round(latitude), longitude: round(longitude) })
      );
    } catch {
      /* Private browsing: the location simply won't be remembered. */
    }
  }

  /** cities.js is ~240 KB, so it is only fetched once a location is actually known. */
  function loadCities() {
    if (Array.isArray(window.DAYTIME_CITIES)) return Promise.resolve();
    if (state.citiesPromise) return state.citiesPromise;

    state.citiesPromise = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "./cities.js";
      script.async = true;
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () => {
        state.citiesPromise = null;
        resolve(); // No city name is fine: coordinates are shown instead.
      });
      document.head.append(script);
    });
    return state.citiesPromise;
  }

  function resolveCity(location) {
    if (!location) return;
    loadCities().then(() => {
      if (state.location !== location) return; // Replaced meanwhile.
      location.city = nearestCity(location.latitude, location.longitude);
      renderSunTimes();
    });
  }

  /**
   * Nearest city from the bundled GeoNames list (cities.js).
   * Entirely offline: coordinates never leave the device.
   */
  function nearestCity(latitude, longitude) {
    const cities = window.DAYTIME_CITIES;
    if (!Array.isArray(cities) || cities.length === 0) return null;

    const cosLat = Math.cos((latitude * Math.PI) / 180);
    let best = null;
    let bestScore = Infinity;

    for (const city of cities) {
      const dLat = (city[2] - latitude) * 111;
      const dLon = (city[3] - longitude) * 111 * cosLat;
      const score = dLat * dLat + dLon * dLon;
      if (score < bestScore) {
        bestScore = score;
        best = city;
      }
    }

    // Only claim a city when it is genuinely nearby; otherwise show the
    // coordinates rather than naming a place an hour away.
    const distanceKm = Math.sqrt(bestScore);
    if (!best || distanceKm > 120) return null;
    return { name: best[0], country: best[1], distanceKm: Math.round(distanceKm) };
  }

  function parseDateKey(key) {
    const date = new Date(`${key}T00:00:00`);
    return core.isDate(date) ? date : null;
  }

  function calendarUrl(date) {
    return `https://calendar.google.com/calendar/u/0/r/day/${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  /* ------------------------------------------------------------------ *
   * Date header, week strip and sun times
   * ------------------------------------------------------------------ */

  function renderHero() {
    const selected = state.selectedDate;
    elements.weekday.textContent = formatters.weekday.format(selected);
    elements.dayNumber.textContent = formatters.day.format(selected);
    elements.month.textContent = formatters.month.format(selected);
    elements.year.textContent = formatters.year.format(selected);
    renderClock();
    renderSunTimes();
  }

  function renderClock() {
    const text = formatTime(new Date());
    if (elements.clock.textContent !== text) elements.clock.textContent = text;
  }

  function renderSunTimes() {
    if (!state.location) {
      elements.sunrise.textContent = "--:--";
      elements.sunset.textContent = "--:--";
      elements.sunStatus.textContent = "LOCATION NEEDED";
      return;
    }

    const { latitude, longitude } = state.location;
    const sunrise = core.localSolarTime(state.selectedDate, latitude, longitude, true);
    const sunset = core.localSolarTime(state.selectedDate, latitude, longitude, false);

    elements.sunrise.textContent = sunrise ? formatTime(sunrise) : "—";
    elements.sunset.textContent = sunset ? formatTime(sunset) : "—";

    const city = state.location.city;
    if (city) {
      elements.sunStatus.textContent = `${city.name}, ${city.country}`;
    } else {
      elements.sunStatus.textContent =
        !sunrise && !sunset ? "POLAR DAY OR NIGHT" : "CALCULATED ON DEVICE";
    }
  }

  function requestLocation() {
    if (!navigator.geolocation) {
      elements.sunStatus.textContent = "LOCATION UNAVAILABLE";
      return;
    }

    elements.location.disabled = true;
    elements.location.textContent = "LOCATING…";

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        state.location = { latitude, longitude, source: "device", city: null };
        writeSavedLocation(latitude, longitude);
        elements.location.disabled = false;
        elements.location.textContent = "REFRESH LOCATION";
        renderSunTimes();
        resolveCity(state.location);
        announce("Sunrise and sunset updated for this location.");
      },
      (error) => {
        elements.location.disabled = false;
        elements.location.textContent = "TRY AGAIN";
        elements.sunStatus.textContent =
          error.code === error.PERMISSION_DENIED ? "ALLOW LOCATION ACCESS" : "LOCATION UNAVAILABLE";
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 15 * 60 * 1000 }
    );
  }

  function renderHeading() {
    const isToday = core.localDateKey(state.selectedDate) === state.todayKey;
    elements.heading.textContent = isToday
      ? "TODAY"
      : formatters.weekday.format(state.selectedDate).toLocaleUpperCase();
    elements.todayButton.hidden = isToday;
    elements.todayButton.setAttribute("aria-label", "Go to today");
    elements.calendarLink.href = calendarUrl(state.selectedDate);
    elements.calendarLink.title = isConnected()
      ? "Open this day in Google Calendar"
      : "Connect Google Calendar to open this day";
  }

  function renderWeekLabels() {
    if (!elements.weekLabels) return;
    const weekStart = core.startOfWeek(state.selectedDate, state.weekStartsOn);
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 7; index += 1) {
      const label = document.createElement("span");
      label.textContent = formatters.narrowWeekday.format(core.addDays(weekStart, index));
      fragment.append(label);
    }
    elements.weekLabels.replaceChildren(fragment);
  }

  function renderWeek() {
    const weekStart = core.startOfWeek(state.selectedDate, state.weekStartsOn);
    const selectedKey = core.localDateKey(state.selectedDate);
    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 7; index += 1) {
      const date = core.addDays(weekStart, index);
      const key = core.localDateKey(date);
      const button = document.createElement("button");
      const isToday = key === state.todayKey;
      const isSelected = key === selectedKey;

      button.type = "button";
      button.className = "week-day";
      button.dataset.date = key;
      button.textContent = formatters.day.format(date);
      button.setAttribute(
        "aria-label",
        `${longDay(date)}${isToday ? ", today" : ""}${isSelected && !isToday ? ", selected" : ""}`
      );

      if (isToday) {
        button.classList.add("is-today");
        button.setAttribute("aria-current", "date");
      }
      if (isSelected) {
        button.classList.add("is-selected");
        button.setAttribute("aria-pressed", "true");
      }
      // Roving tabindex keeps the strip to a single tab stop.
      button.tabIndex = isSelected ? 0 : -1;

      fragment.append(button);
    }

    elements.weekDays.replaceChildren(fragment);
  }

  function focusSelectedDay() {
    const key = core.localDateKey(state.selectedDate);
    const button = $(`[data-date="${key}"]`, elements.weekDays);
    button?.focus({ preventScroll: true });
  }

  function selectDate(date, { focusDay = false } = {}) {
    const next = core.startOfLocalDay(date);
    if (core.localDateKey(next) === core.localDateKey(state.selectedDate) && !focusDay) {
      if (isConnected()) loadAgenda();
      return;
    }

    state.selectedDate = next;
    renderHero();
    renderWeek();
    renderHeading();

    if (isConnected()) {
      if (!renewSessionIfNeeded()) loadAgenda();
    } else if (renewSessionIfNeeded()) {
      renderLoading();
    } else if (!elements.content.querySelector(".connect-card")) {
      renderWelcome();
    }

    announce(`${longDay(next)} selected.`);
    if (focusDay) focusSelectedDay();
  }

  function shiftWeek(days) {
    selectDate(core.addDays(state.selectedDate, days));
  }

  /* ------------------------------------------------------------------ *
   * Agenda rendering
   * ------------------------------------------------------------------ */

  function renderContent(html) {
    const hadFocus = elements.content.contains(document.activeElement);
    elements.content.innerHTML = html;
    if (hadFocus) {
      const target = $("h2, .action-button", elements.content);
      if (target) {
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }
    }
  }

  function renderWelcome(message = "") {
    const hadFocus = elements.content.contains(document.activeElement);
    const fragment = elements.welcomeTemplate.content.cloneNode(true);
    if (message) $("[data-message]", fragment).textContent = message;
    elements.content.replaceChildren(fragment);
    if (hadFocus) $("h2", elements.content)?.focus({ preventScroll: true });
  }

  function renderLoading() {
    renderContent(`
      <section class="status-card">
        <div class="status-title"><div><h2 tabindex="-1">Connecting to your data…</h2><p>Loading events and tasks for this day.</p></div><span class="status-tag">SYNC</span></div>
      </section>`);
    announce("Loading this day.");
  }

  function renderError(message, { reconnect = false } = {}) {
    renderContent(`
      <section class="status-card error-card">
        <div class="status-title"><div><h2 tabindex="-1">Calendar couldn’t load</h2><p>${core.escapeHTML(message)}</p></div><span class="status-tag">${reconnect ? "SIGN IN" : "RETRY"}</span></div>
        <button class="action-button" type="button" data-action="${reconnect ? "reconnect" : "retry"}">${reconnect ? "Reconnect Google Calendar" : "Try again"}</button>
      </section>`);
    announce(`Calendar couldn’t load. ${message}`);
  }

  function renderEvents(items, warning = "") {
    const warningMarkup = warning
      ? `<p class="agenda-warning" role="status">${core.escapeHTML(warning)}</p>`
      : "";

    if (!items.length) {
      renderContent(`
        <section class="status-card empty-state">
          <span class="empty-mark" aria-hidden="true">—</span>
          <h2 tabindex="-1">Nothing on the calendar</h2>
          <p>You’re all clear for this day. New events and tasks will show up here.</p>
          ${warningMarkup}
        </section>`);
      announce(`No events or tasks for ${longDay(state.selectedDate)}.${warning ? ` ${warning}` : ""}`);
      return;
    }

    const rows = items
      .map((item) => {
        const time = item.allDay ? "ALL DAY" : formatTime(item.date);
        const base = item.kind === "task" ? "TASK" : item.location || "EVENT";
        const detail = item.startsBeforeDay ? `${base} · FROM EARLIER` : base;
        const timeLabel = item.allDay
          ? "All day"
          : item.startsBeforeDay
            ? `Started earlier, ${time}`
            : time;

        return `<li class="event-item ${item.kind}">
          <span class="event-time" aria-label="${core.escapeHTML(timeLabel)}">${core.escapeHTML(time)}</span>
          <div class="event-copy"><p class="event-name">${core.escapeHTML(item.title)}</p><p class="event-meta">${core.escapeHTML(detail)}</p></div>
        </li>`;
      })
      .join("");

    renderContent(`
      <section class="status-card">
        <div class="status-title"><div><h2 tabindex="-1">${items.length} ${items.length === 1 ? "item" : "items"} for your day</h2><p>From your Google Calendar and Tasks</p></div><span class="status-tag">LIVE</span></div>
        <ul class="event-list">${rows}</ul>
        ${warningMarkup}
      </section>`);

    announce(`${items.length} ${items.length === 1 ? "item" : "items"} for ${longDay(state.selectedDate)}.`);
  }

  /* ------------------------------------------------------------------ *
   * Google Calendar data
   * ------------------------------------------------------------------ */

  async function apiJSON(url, { signal, service = "Calendar" } = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    if (signal) signal.addEventListener("abort", forwardAbort, { once: true });

    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${state.accessToken}` },
        signal: controller.signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error; // A newer request replaced this one.
      if (error.name === "AbortError") {
        throw new RequestError("Google took too long to respond. Check your connection and try again.");
      }
      throw new RequestError("Couldn’t reach Google. Check your connection and try again.");
    } finally {
      clearTimeout(timeoutId);
      if (signal) signal.removeEventListener("abort", forwardAbort);
    }

    if (response.status === 401) {
      state.accessToken = null;
      state.tokenExpiresAt = 0;
      throw new RequestError("Your Google access expired. Reconnect to continue.", { reconnect: true });
    }
    if (response.status === 403) {
      let detail = "";
      try {
        const body = await response.clone().json();
        if (body && body.error && body.error.message) detail = ` ${body.error.message}`;
      } catch {
        /* No JSON body. */
      }
      throw new RequestError(
        detail
          ? `Google refused access to ${service}.${detail}`
          : `Google refused access to ${service}. Make sure the ${service} API is enabled for this OAuth client.`
      );
    }
    if (response.status === 429) {
      throw new RequestError("Google is rate limiting daytime. Wait a minute, then refresh.");
    }
    if (!response.ok) {
      throw new RequestError(`Google couldn’t complete that request (${response.status}). Try again in a moment.`);
    }

    try {
      return await response.json();
    } catch {
      throw new RequestError("Google returned an unreadable response. Try again in a moment.");
    }
  }

  async function listAllPages(url, options) {
    const items = [];
    let pageToken = "";
    let guard = 0;

    do {
      const separator = url.includes("?") ? "&" : "?";
      const pageUrl = pageToken ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}` : url;
      const page = await apiJSON(pageUrl, options);
      items.push(...(Array.isArray(page.items) ? page.items : []));
      pageToken = page.nextPageToken || "";
      guard += 1;
    } while (pageToken && guard < 20);

    return items;
  }

  /**
   * Calendars the user shows in Google Calendar (primary, shared, family…).
   * Falls back to just the primary calendar when the calendar-list scope was
   * not granted or the list cannot be read.
   */
  async function getCalendars(signal) {
    if (state.calendars && Date.now() - state.calendarsFetchedAt < LIST_TTL_MS) {
      return state.calendars;
    }

    let calendars = [];
    try {
      const entries = await listAllPages(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250&fields=nextPageToken,items(id,primary,selected,hidden,deleted)",
        { signal, service: "Calendar" }
      );
      calendars = entries
        .filter((entry) => entry && typeof entry.id === "string" && entry.id)
        .filter((entry) => !entry.deleted && !entry.hidden && (entry.primary || entry.selected))
        .map((entry) => entry.id);
    } catch (error) {
      if (isAbort(error) || error.reconnect) throw error;
      /* Scope not granted or list unavailable: read the primary calendar only. */
    }

    if (!calendars.length) calendars = ["primary"];
    state.calendars = calendars;
    state.calendarsFetchedAt = Date.now();
    return calendars;
  }

  async function fetchCalendarEvents(date, signal) {
    const start = core.startOfLocalDay(date);
    const end = core.addDays(start, 1);
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      showDeleted: "false",
      fields: "nextPageToken,items(id,iCalUID,status,summary,location,start)",
    });

    const calendarIds = await getCalendars(signal);
    const results = await Promise.allSettled(
      calendarIds.map((id) =>
        listAllPages(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${params}`,
          { signal, service: "Calendar" }
        )
      )
    );

    // One unreadable shared calendar must not hide the others, but if every
    // calendar failed the day genuinely could not load.
    const loaded = results.filter((result) => result.status === "fulfilled");
    if (!loaded.length) throw results[0].reason;

    // The same meeting appears once per calendar it was invited to.
    const seen = new Set();
    const events = loaded
      .flatMap((result) => result.value)
      .filter((event) => {
        const key = event.iCalUID
          ? `${event.iCalUID}|${(event.start && (event.start.dateTime || event.start.date)) || ""}`
          : null;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return events
      .filter((event) => event.status !== "cancelled")
      .map((event) => {
        const startInfo = event.start || {};
        const allDay = Boolean(startInfo.date);
        const raw = allDay ? `${startInfo.date}T00:00:00` : startInfo.dateTime;
        const when = raw ? new Date(raw) : null;
        if (!core.isDate(when)) return null;

        return {
          kind: "event",
          title: event.summary || "Untitled event",
          date: when,
          allDay,
          location: event.location || "",
          startsBeforeDay: !allDay && when < start,
        };
      })
      .filter(Boolean);
  }

  async function getTaskLists(signal) {
    if (state.taskLists && Date.now() - state.taskListsFetchedAt < LIST_TTL_MS) {
      return state.taskLists;
    }

    const lists = await listAllPages(
      "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100&fields=nextPageToken,items(id,title)",
      { signal, service: "Tasks" }
    );

    state.taskLists = lists;
    state.taskListsFetchedAt = Date.now();
    return lists;
  }

  async function fetchTasks(date, signal) {
    const lists = await getTaskLists(signal);
    const dueKey = core.localDateKey(date);
    // Google stores a task's due date as UTC midnight of that date, so ask the
    // API for just that window instead of downloading every open task.
    const params = new URLSearchParams({
      maxResults: "100",
      showCompleted: "false",
      showHidden: "false",
      dueMin: `${dueKey}T00:00:00.000Z`,
      dueMax: `${dueKey}T23:59:59.999Z`,
      fields: "nextPageToken,items(id,title,status,due)",
    });
    const groups = await Promise.all(
      lists.map(async (list) => {
        const tasks = await listAllPages(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
          { signal, service: "Tasks" }
        );

        return tasks
          .filter((task) => task.status !== "completed" && core.taskDateKey(task) === dueKey)
          .map((task) => ({
            kind: "task",
            title: task.title || "Untitled task",
            date: new Date(`${dueKey}T00:00:00`),
            allDay: true,
            startsBeforeDay: false,
          }));
      })
    );

    return groups.flat();
  }

  function describeError(error, service = "calendar") {
    if (error instanceof RequestError) return error.message;
    return `Something went wrong loading ${service} data. Try again in a moment.`;
  }

  async function loadAgenda() {
    if (!isConnected()) {
      setBusy(false);
      if (renewSessionIfNeeded()) {
        renderLoading();
        return;
      }
      renderWelcome("Your Google session ended. Connect again to load this day.");
      return;
    }

    const run = (state.agendaRun += 1);
    state.agendaController?.abort();
    const controller = new AbortController();
    state.agendaController = controller;

    renderLoading();
    setBusy(true);

    try {
      const [eventsResult, tasksResult] = await Promise.allSettled([
        fetchCalendarEvents(state.selectedDate, controller.signal),
        fetchTasks(state.selectedDate, controller.signal),
      ]);

      if (run !== state.agendaRun) return;
      if (eventsResult.status === "rejected") throw eventsResult.reason;
      if (!isConnected()) {
        throw new RequestError("Your Google access expired. Reconnect to continue.", { reconnect: true });
      }

      const tasks = tasksResult.status === "fulfilled" ? tasksResult.value : [];
      let warning = "";
      if (tasksResult.status === "rejected" && !isAbort(tasksResult.reason)) {
        warning = describeError(tasksResult.reason, "tasks");
      }

      const items = [...eventsResult.value, ...tasks].sort(core.compareAgendaItems);
      renderEvents(items, warning);
    } catch (error) {
      if (run !== state.agendaRun || isAbort(error)) return;
      renderError(describeError(error), { reconnect: Boolean(error.reconnect) || !isConnected() });
    } finally {
      if (run === state.agendaRun) {
        state.agendaController = null;
        setBusy(false);
      }
    }
  }

  function setBusy(busy) {
    elements.refresh.disabled = busy;
    elements.refresh.classList.toggle("spin", busy);
    elements.refresh.setAttribute("aria-busy", String(busy));
    elements.content.setAttribute("aria-busy", String(busy));
  }

  /* ------------------------------------------------------------------ *
   * Google sign-in
   * ------------------------------------------------------------------ */

  function loadGoogleLibrary() {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (state.libraryPromise) return state.libraryPromise;

    state.libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        script.remove();
        state.libraryPromise = null; // Let the next attempt retry cleanly.
        reject(new Error(message));
      };

      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.addEventListener("load", () => {
        if (settled) return;
        if (window.google?.accounts?.oauth2) {
          settled = true;
          resolve();
        } else {
          fail("Google sign-in loaded but is unavailable. Try again in a moment.");
        }
      });
      script.addEventListener("error", () => {
        fail("Google sign-in couldn’t load. Check your connection and try again.");
      });

      document.head.append(script);
    });

    return state.libraryPromise;
  }

  function openConnectDialog(message = "") {
    state.connectError = message;
    state.connectView = "intro";
    if (!elements.connectDialog.open) elements.connectDialog.showModal();
    renderConnectView();
  }

  function setConnectView(view, error = "") {
    state.connectView = view;
    state.connectError = error;
    renderConnectView();
  }

  function renderConnectView() {
    const error = state.connectError;
    const errorMarkup = error ? `<p class="sheet-error" role="alert">${core.escapeHTML(error)}</p>` : "";

    if (state.connectView === "working") {
      elements.connectBody.innerHTML = `
        <p>Finish signing in with Google in the window that just opened. daytime will load this day as soon as access is granted.</p>
        <div class="sheet-actions"><button class="button" type="button" data-connect-action="close">Cancel</button></div>`;
    } else if (state.connectView === "setup") {
      const existing = activeClientId();
      elements.connectBody.innerHTML = `
        <p>One-time setup: daytime needs a Google OAuth client ID from your own Google Cloud project. Paste it here — it is saved in this browser only, so you never have to edit a file.</p>
        <div class="field">
          <label for="clientIdInput">Google OAuth client ID</label>
          <input id="clientIdInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="1234567890-abcd.apps.googleusercontent.com" value="${core.escapeHTML(existing)}" aria-describedby="clientIdHelp" />
          <p class="field-hint" id="clientIdHelp">Create a <strong>Web application</strong> OAuth client in the <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer noopener">Google Cloud Console</a> and add this page’s URL under <em>Authorized JavaScript origins</em>. Full steps are in README.md.</p>
        </div>
        <p class="sheet-error" id="clientIdError" role="alert" hidden></p>
        <div class="sheet-actions">
          <button class="button primary" type="button" data-connect-action="save">Save and continue</button>
          ${configuredClientId() && readStoredClientId() ? '<button class="button" type="button" data-connect-action="reset-client">Use the default client ID</button>' : ""}
          <button class="button" type="button" data-connect-action="close">Cancel</button>
        </div>`;
    } else if (state.connectView === "error") {
      elements.connectBody.innerHTML = `
        ${errorMarkup || '<p class="sheet-error" role="alert">Google sign-in could not start.</p>'}
        <div class="sheet-actions">
          <button class="button primary" type="button" data-connect-action="authorize">Try again</button>
          <button class="button" type="button" data-connect-action="setup">Change client ID</button>
        </div>`;
    } else {
      elements.connectBody.innerHTML = `
        <p>daytime shows the events and tasks for the day you pick. It asks Google for <strong>read-only</strong> access to Calendar and Tasks, and the sign-in token stays in this tab only.</p>
        ${errorMarkup}
        <div class="sheet-actions">
          <button class="button primary" type="button" data-connect-action="authorize">Continue with Google</button>
          <button class="button" type="button" data-connect-action="close">Not now</button>
        </div>
        <p class="fine-print">Nothing is written to your calendar, and no event data is stored on this device.</p>
        <p class="fine-print"><button class="today-link" type="button" data-connect-action="setup">Change client ID</button></p>`;
    }

    const focusTarget =
      state.connectView === "setup"
        ? elements.connectBody.querySelector("input")
        : elements.connectBody.querySelector(".button.primary");
    focusTarget?.focus({ preventScroll: true });
  }

  /**
   * Google access tokens last about an hour and the browser token flow has no
   * refresh token. When the user acts on an expiring or expired session we ask
   * Google again without the consent screen. This must run synchronously
   * inside a click so the popup is not blocked. Returns true when a renewal
   * started (its callback loads the agenda).
   */
  function renewSessionIfNeeded() {
    if (!state.tokenClient || !state.hadSession || state.connecting) return false;
    if (state.accessToken && state.tokenExpiresAt - Date.now() > TOKEN_RENEW_MARGIN_MS) return false;

    state.connecting = true;
    state.renewing = true;
    try {
      state.tokenClient.requestAccessToken({ prompt: "" });
      return true;
    } catch {
      state.connecting = false;
      state.renewing = false;
      return false;
    }
  }

  function handleTokenFailure(message) {
    const wasRenewing = state.renewing;
    state.connecting = false;
    state.renewing = false;
    if (wasRenewing && !elements.connectDialog.open) {
      setBusy(false);
      renderError(message, { reconnect: true });
      return;
    }
    setConnectView("error", message);
  }

  async function authorize() {
    const clientId = activeClientId();

    if (!clientId) {
      setConnectView("setup");
      return;
    }
    if (state.connecting) return;

    state.connecting = true;
    state.renewing = false;
    state.connectError = "";
    setConnectView("working");

    try {
      await loadGoogleLibrary();
      state.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_SCOPE,
        callback: (response) => {
          if (response.error) {
            handleTokenFailure("Google didn’t grant access. You can try again.");
            return;
          }
          const renewed = state.renewing;
          state.connecting = false;
          state.renewing = false;
          state.accessToken = response.access_token;
          state.tokenExpiresAt = Date.now() + Number(response.expires_in || 3600) * 1000;
          state.hadSession = true;
          if (!renewed) {
            state.taskLists = null;
            state.calendars = null;
          }
          if (elements.connectDialog.open) elements.connectDialog.close();
          announce(renewed ? "Google session renewed." : "Google Calendar connected.");
          loadAgenda();
        },
        error_callback: (error) => {
          const message =
            error?.type === "popup_closed"
              ? "The Google sign-in window was closed before access was granted."
              : "Google sign-in couldn’t open. Allow pop-ups for this site and try again.";
          handleTokenFailure(message);
        },
      });
      state.tokenClient.requestAccessToken({ prompt: "" });
    } catch (error) {
      state.connecting = false;
      setConnectView("error", error.message || "Google sign-in could not start.");
    }
  }

  function saveClientId() {
    const input = $("#clientIdInput");
    const value = (input?.value || "").trim();
    const errorNode = $("#clientIdError");

    if (!CLIENT_ID_PATTERN.test(value)) {
      if (errorNode) {
        errorNode.hidden = false;
        errorNode.textContent =
          "That doesn’t look like an OAuth client ID. It should end with .apps.googleusercontent.com.";
      }
      input?.focus();
      return;
    }

    writeStoredClientId(value);
    state.connectError = "";
    authorize();
  }

  function disconnect() {
    if (state.accessToken && window.google?.accounts?.oauth2?.revoke) {
      try {
        window.google.accounts.oauth2.revoke(state.accessToken, () => {});
      } catch {
        /* Revoking is best effort; the token is dropped locally either way. */
      }
    }

    state.accessToken = null;
    state.tokenExpiresAt = 0;
    state.hadSession = false;
    state.renewing = false;
    state.taskLists = null;
    state.calendars = null;
    state.agendaRun += 1;
    state.agendaController?.abort();
    state.agendaController = null;
    setBusy(false);
    if (elements.aboutDialog.open) elements.aboutDialog.close();
    renderWelcome("You’re disconnected. Connect again whenever you want to see your calendar.");
    announce("Disconnected from Google Calendar.");
  }

  /* ------------------------------------------------------------------ *
   * About sheet
   * ------------------------------------------------------------------ */

  function renderAbout() {
    const connected = isConnected();
    const access = connected
      ? "Connected, read-only"
      : state.accessToken
        ? "Session expired"
        : "Not connected";
    const locationText = state.location
      ? state.location.city
        ? `${state.location.city.name}, ${state.location.city.country}`
        : `${state.location.latitude.toFixed(2)}, ${state.location.longitude.toFixed(2)}`
      : "Not set";

    elements.aboutBody.innerHTML = `
      <dl class="about-rows">
        <div class="about-row"><dt>Google Calendar</dt><dd class="${connected ? "" : "muted"}">${access}</dd></div>
        <div class="about-row"><dt>Location</dt><dd class="${state.location ? "" : "muted"}">${core.escapeHTML(locationText)}</dd></div>
      </dl>
      <p>daytime keeps your Google token in memory only. Events and tasks are read when you open a day and are never written here. Sunrise and sunset are calculated on this device; if you share your location, a rounded copy is remembered in this browser only and never sent anywhere.</p>
      <div class="sheet-actions">
        ${connected ? '<button class="button" type="button" data-about-action="disconnect">Disconnect Google Calendar</button>' : ""}
        ${state.location && state.location.source !== "config" ? '<button class="button" type="button" data-about-action="forget-location">Forget location</button>' : ""}
        <button class="button" type="button" data-about-action="close">Done</button>
      </div>
      <p class="fine-print">daytime ${VERSION} · a Nothing-inspired calendar widget.</p>`;
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  elements.content.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;

    const action = trigger.dataset.action;
    if (action === "connect" || action === "reconnect") {
      if (action === "reconnect" && renewSessionIfNeeded()) {
        renderLoading();
        return;
      }
      openConnectDialog(
        action === "reconnect" ? "Your Google session ended. Connect again to load this day." : ""
      );
    } else if (action === "retry") {
      if (isConnected()) loadAgenda();
      else if (renewSessionIfNeeded()) renderLoading();
      else openConnectDialog("Connect Google Calendar to load this day.");
    }
  });

  elements.connectBody.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-connect-action]");
    if (!trigger) return;

    const action = trigger.dataset.connectAction;
    if (action === "authorize") authorize();
    else if (action === "save") saveClientId();
    else if (action === "setup") setConnectView("setup");
    else if (action === "reset-client") {
      writeStoredClientId("");
      authorize();
    } else if (action === "close") elements.connectDialog.close();
  });

  elements.aboutBody.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-about-action]");
    if (!trigger) return;
    const action = trigger.dataset.aboutAction;
    if (action === "disconnect") disconnect();
    else if (action === "forget-location") forgetLocation();
    else if (action === "close") elements.aboutDialog.close();
  });

  function forgetLocation() {
    writeSavedLocation(null);
    state.location = readConfiguredLocation(config.location);
    resolveCity(state.location);
    elements.location.textContent = "USE LOCATION";
    renderSunTimes();
    renderAbout();
    announce("Location forgotten.");
  }

  elements.closeConnect.addEventListener("click", () => elements.connectDialog.close());
  elements.closeAbout.addEventListener("click", () => elements.aboutDialog.close());

  for (const dialog of [elements.connectDialog, elements.aboutDialog]) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  elements.connectDialog.addEventListener("close", () => {
    if (state.connectView === "working") state.connecting = false;
  });

  elements.weekDays.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-date]");
    if (!button) return;
    const date = parseDateKey(button.dataset.date);
    if (date) selectDate(date, { focusDay: true });
  });

  elements.weekDays.addEventListener("keydown", (event) => {
    const button = event.target.closest("button[data-date]");
    if (!button) return;

    if (event.key === "Home") {
      event.preventDefault();
      selectDate(core.startOfLocalDay(new Date()), { focusDay: true });
      return;
    }

    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    selectDate(core.addDays(parseDateKey(button.dataset.date) || new Date(), delta), { focusDay: true });
  });

  elements.prevWeek.addEventListener("click", () => shiftWeek(-7));
  elements.nextWeek.addEventListener("click", () => shiftWeek(7));
  elements.todayButton.addEventListener("click", () => {
    selectDate(core.startOfLocalDay(new Date()), { focusDay: true });
  });
  elements.location.addEventListener("click", requestLocation);

  elements.refresh.addEventListener("click", () => {
    if (renewSessionIfNeeded()) renderLoading();
    else if (isConnected()) loadAgenda();
    else openConnectDialog("Connect Google Calendar to load this day.");
  });

  elements.calendarLink.addEventListener("click", (event) => {
    if (isConnected()) return;
    event.preventDefault();
    openConnectDialog("Connect Google Calendar to open days, events and tasks from here.");
  });

  elements.about.addEventListener("click", () => {
    renderAbout();
    elements.aboutDialog.showModal();
    elements.aboutBody.querySelector("button")?.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------------ *
   * Clock, rollover and startup
   * ------------------------------------------------------------------ */

  function tick() {
    renderClock();

    const todayKey = core.localDateKey(new Date());
    if (todayKey === state.todayKey) return;

    const wasShowingPreviousToday = core.localDateKey(state.selectedDate) === state.todayKey;
    state.todayKey = todayKey;

    if (wasShowingPreviousToday) {
      state.selectedDate = core.startOfLocalDay(new Date());
      renderHero();
      renderHeading();
      if (isConnected()) loadAgenda();
      announce(`A new day. ${longDay(state.selectedDate)}.`);
    }
    renderWeekLabels();
    renderWeek();
  }

  function clearOldServiceWorkers() {
    // Earlier versions installed a service worker for offline use. The app now
    // always runs from local files, so remove it and its caches: a stale cache
    // would otherwise keep serving an old version.
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => Promise.all(registrations.map((entry) => entry.unregister())))
      .catch(() => {});
    if (window.caches && typeof window.caches.keys === "function") {
      window.caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => window.caches.delete(key))))
        .catch(() => {});
    }
  }

  function wireDesktopShell() {
    if (!shellMode) return;
    if (!window.chrome || !window.chrome.webview) return;

    const post = (message) => {
      try {
        window.chrome.webview.postMessage(message);
      } catch {
        /* Not running inside WebView2. */
      }
    };

    if (elements.backButton) {
      elements.backButton.addEventListener("click", () => post("back"));
    }
    if (elements.closeButton) {
      elements.closeButton.addEventListener("click", () => post("quit"));
    }

    // The page cannot move a native window, so the shell starts the drag loop
    // when the header or the big date is pressed.
    const zones = [$(".topbar"), $(".date-hero")];
    for (const zone of zones) {
      if (!zone) continue;
      zone.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (event.target.closest("button, a, input")) return;
        event.preventDefault();
        post("drag");
      });
    }
  }

  function init() {
    if (["h11", "h12"].includes(formatters.time.resolvedOptions().hourCycle)) {
      $(".widget")?.classList.add("uses-12h");
    }

    renderHero();
    renderWeekLabels();
    renderWeek();
    renderHeading();
    renderWelcome();
    resolveCity(state.location);
    if (state.location && state.location.source === "saved") {
      elements.location.textContent = "REFRESH LOCATION";
    }
    wireDesktopShell();

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tick();
    });

    window.setInterval(tick, TICK_MS);

    clearOldServiceWorkers();
  }

  init();
})();
