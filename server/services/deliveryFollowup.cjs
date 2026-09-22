'use strict';
/**
 * Die delivery follow-up — the rules shared by the order routes, the
 * follow-up routes and the supplier chaser.
 *
 * die_orders.eta is TEXT and may hold "TBC", so nothing here treats a string
 * as a date unless normalizeEta says it is one. src/utils/deliveryFollowup.js
 * holds the client copy; its test checks the two agree.
 */

const CAUSES = Object.freeze(['supplier_delay', 'our_change', 'logistics', 'other']);
const CHANNELS = Object.freeze(['email', 'phone', 'whatsapp', 'meeting', 'other']);

class DeliveryRuleError extends Error {
  constructor(message, code = 'INVALID') {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

// A real calendar date as 'YYYY-MM-DD', or null. Accepts the forms the order
// routes' sanitizeDate accepts: YYYY-MM-DD, an ISO datetime, DD/MM/YYYY,
// DD-MM-YYYY and DD.MM.YYYY. A day that does not exist (31/02) is null.
function normalizeEta(value) {
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

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function validateCause(change) {
  const cause = change && typeof change.cause === 'string' ? change.cause.trim() : '';
  const note = change && change.note != null ? String(change.note).trim().slice(0, 1000) : '';
  if (!cause) throw new DeliveryRuleError('A cause is required to change an ETA that was already set', 'ETA_CAUSE_REQUIRED');
  if (!CAUSES.includes(cause)) throw new DeliveryRuleError(`Unknown ETA change cause: ${cause}`, 'ETA_CAUSE_REQUIRED');
  if (cause === 'other' && !note) throw new DeliveryRuleError('Say what the other cause is in the note', 'ETA_CAUSE_REQUIRED');
  return { cause, note: note || null };
}

// What an incoming ETA means against the stored one. A first real date is
// logged without a cause; moving or clearing a real date needs one.
function planEtaChange(stored, incoming, change) {
  const before = normalizeEta(stored);
  const after = normalizeEta(incoming);
  if (before === after) return null;
  if (!before) return { kind: 'eta_set', before: null, after };
  return { kind: 'eta_revised', before, after, ...validateCause(change) };
}

// Every follow-up is a contact (date + channel). It must carry the
// supplier's reply, a new ETA, or both.
function validateFollowUp(body = {}, today) {
  const contactDate = normalizeEta(body.contactDate);
  if (!contactDate) throw new DeliveryRuleError('A valid follow-up date is required');
  if (contactDate > today) throw new DeliveryRuleError('The follow-up date cannot be in the future');
  const channel = String(body.channel || '').trim();
  if (!CHANNELS.includes(channel)) throw new DeliveryRuleError('Pick how the supplier was contacted');
  const note = body.note == null ? '' : String(body.note).trim().slice(0, 2000);
  const rawEta = body.newEta == null ? '' : String(body.newEta).trim();
  const newEta = rawEta ? normalizeEta(rawEta) : null;
  if (rawEta && !newEta) throw new DeliveryRuleError(`Invalid new ETA: ${rawEta} (expected YYYY-MM-DD)`);
  if (!note && !newEta) throw new DeliveryRuleError("Write the supplier's reply or give a new ETA");
  return { contactDate, channel, note: note || null, newEta, change: { cause: body.cause, note: body.causeNote } };
}

// Row from the summaries query → what the page shows. No backfill: a die
// never revised has its current ETA as its original.
function summarize(row) {
  const current = normalizeEta(row.eta);
  const originalEta = row.first_revised_from ? normalizeEta(row.first_revised_from) : current;
  const slips = Number(row.slips) || 0;
  return {
    originalEta,
    slips,
    daysSlipped: slips && originalEta && current ? daysBetween(originalEta, current) : 0,
    lastContact: row.last_contact_date
      ? { date: normalizeEta(row.last_contact_date), channel: row.last_contact_channel }
      : null,
    lastChasedAt: row.last_chased_at ? new Date(row.last_chased_at).toISOString() : null,
  };
}

const EVENT_COLUMNS = `id, order_id, kind, eta_before::text AS eta_before, eta_after::text AS eta_after,
  cause, channel, contact_date::text AS contact_date, note, chaser_id, created_by_name, created_at`;

async function insertEtaEvent(db, orderId, plan, user) {
  const { rows } = await db.query(
    `INSERT INTO die_delivery_events (order_id, kind, eta_before, eta_after, cause, note, created_by, created_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${EVENT_COLUMNS}`,
    [orderId, plan.kind, plan.before, plan.after, plan.cause || null, plan.note || null,
      user?.id || null, user?.username || null]);
  return rows[0];
}

async function insertContactEvent(db, orderId, { contactDate, channel, note }, user) {
  const { rows } = await db.query(
    `INSERT INTO die_delivery_events (order_id, kind, contact_date, channel, note, created_by, created_by_name)
     VALUES ($1, 'contact', $2, $3, $4, $5, $6) RETURNING ${EVENT_COLUMNS}`,
    [orderId, contactDate, channel, note || null, user?.id || null, user?.username || null]);
  return rows[0];
}

module.exports = {
  CAUSES, CHANNELS, DeliveryRuleError, EVENT_COLUMNS,
  normalizeEta, daysBetween, validateCause, planEtaChange, validateFollowUp, summarize,
  insertEtaEvent, insertContactEvent,
};
