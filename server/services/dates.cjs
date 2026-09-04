'use strict';

// The local calendar day as 'YYYY-MM-DD'.
//
// NOT new Date().toISOString().slice(0, 10) — that is the UTC day. This server
// runs Asia/Dubai (UTC+4), so between midnight and 4am the UTC day is still
// yesterday. Anything recording "what day is it" that way is a day early for
// the night shift: audit entries filed under the wrong date, a date field
// pre-filled with yesterday, a validator rejecting today as being in the future.
//
// This is only for "now". Converting an EXISTING Date to its ISO day is a
// different question — a Date built from a UTC-anchored epoch (an Excel serial,
// say) is correctly read with toISOString(), and rewriting those would shift
// every imported date by a day.
function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

module.exports = { todayLocal };
