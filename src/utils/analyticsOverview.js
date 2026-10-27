import { localDay } from './today.js';

// Counting rules for the Analytics Overview tab, kept out of the component so
// they can be tested.

export const isCancelled = (order) => order?.STATUS === 'CANCELLED';

export const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

export const parseOrderCalendarDate = (raw) => {
  if (raw == null) return null;
  const s0 = String(raw).trim();
  if (!s0) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s0)) {
    const head = s0.slice(0, 10);
    if (!Number.isNaN(Date.parse(head))) return head;
  }
  // Last resort: a format the ISO branch above did not recognise, such as
  // "Sep 4 2026". Date.parse reads those as LOCAL time, so reading the day
  // back with toISOString() returned the day before. This parser must agree
  // with the one in DieOrderingSystem.jsx or analytics and the register
  // disagree about which month an order falls in.
  //
  // Unreachable for real data — DATE columns arrive as raw 'YYYY-MM-DD' and
  // are caught above — so this is junk tolerance, not a live code path.
  const t = Date.parse(s0);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const y = d.getFullYear();
    if (y >= 1990 && y <= 2100) return localDay(d);
  }
  return null;
};

export const hasDesignApprovedDate = (order) =>
  parseOrderCalendarDate(order?.['Design Approved Date'] ?? order?.design_approved_date) != null;

// The year an order belongs to, from the same date its month comes from (Die
// Requested Date), so the Year and Month filters always agree with each other
// and with the register.
export const orderYear = (order) => parseOrderCalendarDate(order?.['Die Requested Date'])?.slice(0, 4) ?? null;

// Whole days between two calendar dates. Both parse as UTC midnight, so no
// timezone or daylight-saving shift can creep in. A pair out of order is a
// data entry error and gives null rather than a negative lead time.
export const daysBetween = (fromRaw, toRaw) => {
  const from = parseOrderCalendarDate(fromRaw);
  const to = parseOrderCalendarDate(toRaw);
  if (!from || !to) return null;
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  return days >= 0 ? days : null;
};

export const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Median lead time per group. A median, not a mean: one die that took 243
// days dragged a supplier's average up by a week. Each row carries how many
// orders it rests on, since a median of one order is not a track record.
export const leadTimesBy = (orders, keyOf, fromOf, toOf) => {
  const groups = {};
  for (const o of orders) {
    const key = keyOf(o);
    if (!key) continue;
    const days = daysBetween(fromOf(o), toOf(o));
    if (days == null) continue;
    (groups[key] ||= []).push(days);
  }
  return Object.entries(groups)
    .map(([name, days]) => {
      const medianDays = Math.round(median(days));
      return { name, medianDays, count: days.length, label: `${medianDays}d (${days.length})` };
    })
    .sort((a, b) => a.medianDays - b.medianDays);
};

// One supplier's orders split by where they stand. Before approval and with
// the supplier are kept apart because only the second is the supplier's to
// deliver: an order still waiting on design approval is not late on their side.
export const supplierProgress = (orders) => {
  const row = { total: 0, received: 0, withSupplier: 0, beforeApproval: 0 };
  for (const o of orders) {
    if (isCancelled(o)) continue;
    row.total += 1;
    if (hasDieReceivedDate(o)) row.received += 1;
    else if (hasDesignApprovedDate(o)) row.withSupplier += 1;
    else row.beforeApproval += 1;
  }
  return row;
};
