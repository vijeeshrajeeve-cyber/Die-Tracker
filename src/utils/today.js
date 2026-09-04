// The local calendar day as 'YYYY-MM-DD'.
//
// NOT toISOString().slice(0, 10) — that is the UTC day. This app runs in
// Asia/Dubai (UTC+4), so between midnight and 4am the UTC day is still
// yesterday: a date picker capped at "today" would refuse the real today, and
// a stamped date would be a day early. Reading the local components avoids it.
export const todayLocal = (now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
