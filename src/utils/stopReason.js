/**
 * Why an order is Cancelled or On Hold, read from its change log.
 *
 * Moving an order into CANCELLED or HOLD from Order Details requires a reason,
 * and that reason is stored on the STATUS change-log entry. The latest entry
 * that moved the order into its current stopped status is the one that
 * explains it. Returns null when the order is not stopped or no such entry
 * exists (for example an order imported already cancelled).
 *
 * Orders imported already cancelled carry their explanation in the order's
 * Remark instead, so `remarkFallback` returns that when no logged reason exists.
 */
export function remarkFallback(info, remark) {
  if (info?.reason) return null;
  const r = text(remark);
  return r || null;
}

const STOP_STATUSES = ['CANCELLED', 'HOLD'];

const text = (v) => (v === null || v === undefined ? '' : String(v).trim());

export function stopReason(status, changes) {
  const current = text(status).toUpperCase();
  if (!STOP_STATUSES.includes(current)) return null;
  const entry = (Array.isArray(changes) ? changes : [])
    .filter((ch) => text(ch?.field_name).toUpperCase() === 'STATUS'
      && text(ch?.new_value).toUpperCase() === current)
    .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at))[0];
  if (!entry) return null;
  return {
    reason: text(entry.reason) || null,
    changedAt: entry.changed_at || null,
    changedBy: text(entry.changed_by) || null,
  };
}
