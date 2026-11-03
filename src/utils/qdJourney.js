// The journey strip at the top of the QD drawer: one stop per hand-off, with
// the date it happened or why it has not. Pure, so the lateness rules can be
// tested without rendering anything.

// A Pending QD that has sat with its approver this long is called late.
export const PENDING_LATE_DAYS = 3;

const SETTLED = ['Closed', 'Rejected', 'Reference'];
// Statuses in which the supplier still owes a reply.
const AWAITING_REPLY = ['Open', 'Sent to Supplier'];

const day = (v) => (v ? String(v).slice(0, 10) : null);
const DAY_MS = 86400000;
const daysBetween = (from, to) => Math.floor((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  - Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / DAY_MS);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const stop = (key, label, date, note, extra = {}) => ({ key, label, date: day(date), note: note || null, state: 'todo', late: false, ...extra });

export function journeyStops(qd, now = new Date()) {
  if (qd.approval_state === 'Cancelled') {
    return [
      stop('raised', 'Raised', qd.raised_date, null, { state: 'cancelled' }),
      stop('cancelled', 'Cancelled', qd.cancelled_at, qd.cancel_reason, { state: 'cancelled' }),
    ];
  }

  const isApproved = qd.approval_state === 'Approved';
  const foc = qd.foc && qd.foc.roundCount > 0 ? qd.foc : null;
  const settled = !!qd.closed_at || SETTLED.includes(qd.status);
  const stops = [];

  // A draft is still being raised; it has not left the first stop.
  stops.push({ ...stop('raised', 'Raised', qd.raised_date), done: qd.approval_state !== 'Draft' });

  // Approved: dated when the workflow recorded it. Rows approved before the
  // workflow existed, and imported ones, have no date but are approved all the same.
  if (isApproved) {
    stops.push({ ...stop('approved', 'Approved', qd.approved_at, qd.approved_at ? null : 'approved'), done: true });
  } else if (qd.approval_state === 'Pending') {
    const since = qd.submitted_at ? daysBetween(new Date(qd.submitted_at), now) : null;
    const who = qd.assigned_approver_name || 'approver';
    stops.push({
      ...stop('approved', 'Approved', null, since == null ? `with ${who}` : `with ${who} · ${plural(since, 'day')}`),
      done: false, late: since != null && since > PENDING_LATE_DAYS,
    });
  } else if (qd.approval_state === 'SentBack') {
    stops.push({ ...stop('approved', 'Approved', null, `sent back ${day(qd.sent_back_at) || ''}`.trim()), done: false });
  } else {
    stops.push({ ...stop('approved', 'Approved', null, 'not submitted'), done: false });
  }

  stops.push({ ...stop('purchase', 'To Purchase', qd.sent_to_purchase_date), done: isApproved && !!qd.sent_to_purchase_date });
  stops.push({ ...stop('supplier', 'To supplier', qd.sent_to_supplier_date), done: isApproved && !!qd.sent_to_supplier_date });

  // Supplier reply: done once they have answered; otherwise the ETA is the
  // promise, and it is late once that has passed with the QD still open.
  const replied = !!qd.supplier_acceptance;
  const eta = day(qd.eta_date);
  const etaPassed = eta ? daysBetween(new Date(eta), now) : null;
  const replyLate = !replied && etaPassed != null && etaPassed > 0 && AWAITING_REPLY.includes(qd.status);
  stops.push({
    ...stop('reply', 'Supplier reply', eta,
      replied ? (qd.supplier_acceptance === 'Yes' ? 'accepted' : `answered ${qd.supplier_acceptance}`)
        : replyLate ? `${plural(etaPassed, 'day')} past ETA` : eta ? `ETA ${eta}` : null),
    done: replied, late: replyLate,
  });

  if (foc) {
    // The strip shows only the latest round; the attempt count on the Trial
    // stop is the hint that the full history is in the Supplier & FOC tab.
    const attempt = foc.roundCount > 1 ? ` · attempt ${foc.roundCount}` : '';
    const received = !!foc.receivedDate;
    const overdue = foc.state === 'awaiting-receipt' && foc.daysOverdue > 0;
    stops.push({
      ...stop('foc', 'FOC received', received ? foc.receivedDate : foc.promisedEta,
        received ? null : overdue ? `${plural(foc.daysOverdue, 'day')} overdue` : foc.promisedEta ? `promised ${foc.promisedEta}` : 'no ETA'),
      done: received, late: overdue,
    });
    const trialled = !!foc.trialResult;
    stops.push({
      ...stop('trial', `Trial${attempt}`, trialled ? foc.trialDate : null,
        trialled ? foc.trialResult : foc.state === 'awaiting-trial' && foc.daysIdle != null ? `awaiting trial · ${plural(foc.daysIdle, 'day')} in plant` : null),
      done: trialled,
    });
  }

  stops.push({ ...stop('closed', qd.status === 'Rejected' ? 'Rejected' : 'Closed', qd.closed_at), done: settled });

  // One stop is current: the first not done. A settled QD has none — every
  // earlier gap is just an undated hand-off, not something still to do.
  let currentSeen = settled;
  return stops.map(({ done, ...s }) => {
    let state;
    if (settled || done) state = 'done';
    else if (!currentSeen) { state = 'current'; currentSeen = true; }
    else state = 'todo';
    const late = state === 'done' ? false : s.late;
    return { ...s, state, late };
  });
}
