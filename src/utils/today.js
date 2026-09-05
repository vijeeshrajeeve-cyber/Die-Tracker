// Format a Date by its LOCAL calendar day, as 'YYYY-MM-DD'.
//
// NOT toISOString().slice(0, 10) — that reports the UTC day. The difference
// bites twice in this app, which runs in Asia/Dubai (UTC+4):
//
//   1. For "now", the UTC day is still yesterday between midnight and 4am.
//   2. For a Date parsed from a non-ISO string ("Sep 4 2026", "2026/09/04"),
//      the spec says Date.parse treats it as LOCAL time — so toISOString()
//      reports the previous day for every such value, at any hour of the day.
//
// The exception is a Date built from a UTC-anchored epoch, such as an Excel
// serial via (serial - 25569) * 86400 * 1000. Those are correctly read with
// toISOString(), and parseExcelDate deliberately still does.
export const localDay = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// The local calendar day right now.
export const todayLocal = (now = new Date()) => localDay(now);
