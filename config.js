/*
 * daytime configuration — optional.
 *
 * A client ID is filled in below, so connecting is one tap: click
 * "Connect Google Calendar", sign into the Google account, done. No file
 * editing and no Google Cloud setup for anyone using the app.
 *
 * The client ID is public information; it is not a secret. A client ID that a
 * user pastes in the app (Connect -> Change client ID) takes precedence over
 * this default and can be reset from the same screen.
 */
window.daytime_CONFIG = {
  googleClientId: "1002364694862-8tao8ab3ojrknhtrh54rlgsea2hpqo89.apps.googleusercontent.com",

  // "locale" follows the device (recommended). Force "24h" or "12h" if you prefer.
  timeFormat: "locale",

  // First day of the week strip: "locale" follows the browser's region
  // (Monday in most of Europe, Sunday in the US), or "sunday" / "monday" / "saturday".
  weekStart: "locale",

  // Optional fixed coordinates: sunrise/sunset then work without a location prompt.
  // location: { latitude: 12.9716, longitude: 77.5946 },
  location: null,
};
