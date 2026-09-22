// Die delivery follow-up rules for the In Manufacturing page.
//
// die_orders.eta is free text and may hold "TBC", so nothing here treats a
// string as a date unless normalizeEta says it is one. The server keeps the
// same rules in server/services/deliveryFollowup.cjs; the test checks both.

export const CAUSES = [
  { value: 'supplier_delay', label: 'Supplier delay' },
  { value: 'our_change', label: 'Our change (design revision, hold)' },
  { value: 'logistics', label: 'Shipping / logistics' },
  { value: 'other', label: 'Other' },
];

export const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'other', label: 'Other' },
];

export const DUE_SOON_DAYS = 7;

const labelOf = (list, value) => list.find((item) => item.value === value)?.label || value || '';
export const causeLabel = (value) => labelOf(CAUSES, value);
export const channelLabel = (value) => labelOf(CHANNELS, value);

export function normalizeEta(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  let y; let m; let d;
  if (iso) [, y, m, d] = iso;
  else if (dmy) [, d, m, y] = dmy;
  else return null;
  const date = new Date(Date.UTC(+y, +m - 1, +d));
  if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export function etaChip(eta, today, format = (d) => d) {
  const date = normalizeEta(eta);
  if (!date) return { bucket: 'no_eta', tone: 'muted', text: 'No ETA' };
  const days = daysBetween(today, date);
  if (days < 0) return { bucket: 'overdue', tone: 'danger', text: `${-days}d overdue` };
  if (days <= DUE_SOON_DAYS) return { bucket: 'due_soon', tone: 'warning', text: days === 0 ? 'Due today' : `Due in ${days}d` };
  return { bucket: 'later', tone: 'neutral', text: format(date) };
}

const BUCKET_RANK = { overdue: 0, due_soon: 1, later: 2, no_eta: 3 };

// Most overdue first, then soonest due, then later, then no ETA by die number.
export function compareByUrgency(a, b, today) {
  const rank = BUCKET_RANK[etaChip(a.ETA, today).bucket] - BUCKET_RANK[etaChip(b.ETA, today).bucket];
  if (rank) return rank;
  const ea = normalizeEta(a.ETA);
  const eb = normalizeEta(b.ETA);
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  return String(a['DIE NO'] || '').localeCompare(String(b['DIE NO'] || ''), undefined, { numeric: true });
}

export function countBuckets(orders, today) {
  const counts = { overdue: 0, due_soon: 0, later: 0, no_eta: 0 };
  for (const order of orders) counts[etaChip(order.ETA, today).bucket] += 1;
  return counts;
}

// Saving `next` over `current` needs a cause when the die already had a real
// ETA and the new value is a different date or no date at all.
export function needsCause(current, next) {
  const before = normalizeEta(current);
  return !!before && before !== normalizeEta(next);
}

export function validateFollowUpForm(form, currentEta, today) {
  const contactDate = normalizeEta(form.contactDate);
  if (!contactDate) return 'Enter the follow-up date';
  if (contactDate > today) return 'The follow-up date cannot be in the future';
  if (!CHANNELS.some((c) => c.value === form.channel)) return 'Pick how the supplier was contacted';
  const note = String(form.note || '').trim();
  const rawEta = String(form.newEta || '').trim();
  if (rawEta && !normalizeEta(rawEta)) return 'The new ETA is not a valid date';
  if (!note && !rawEta) return "Write the supplier's reply or give a new ETA";
  if (rawEta && needsCause(currentEta, rawEta)) {
    if (!CAUSES.some((c) => c.value === form.cause)) return 'Pick the cause of the ETA change';
    if (form.cause === 'other' && !String(form.causeNote || '').trim()) return 'Say what the other cause is';
  }
  return null;
}

export function formatSlip(days) {
  if (!days) return '0d';
  return days > 0 ? `+${days}d` : `−${-days}d`;
}
