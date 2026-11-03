import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyStops, PENDING_LATE_DAYS } from './qdJourney.js';

const NOW = new Date('2026-11-03T09:00:00Z');
const byKey = (stops) => Object.fromEntries(stops.map((s) => [s.key, s]));
const keysOf = (stops) => stops.map((s) => s.key);

const draft = { approval_state: 'Draft', status: 'Open', raised_date: '2026-11-01', foc: { roundCount: 0 } };

test('a draft is current at Raised and nothing is late', () => {
  const stops = journeyStops(draft, NOW);
  assert.deepEqual(keysOf(stops), ['raised', 'approved', 'purchase', 'supplier', 'reply', 'closed']);
  assert.equal(stops[0].state, 'current');
  assert.equal(stops[0].date, '2026-11-01');
  assert.ok(stops.slice(1).every((s) => s.state === 'todo'));
  assert.ok(stops.every((s) => s.late === false));
  assert.equal(stops[1].note, 'not submitted');
});

test('a pending QD shows who it is with and goes red after the late threshold', () => {
  assert.equal(PENDING_LATE_DAYS, 3);
  const late = byKey(journeyStops({ ...draft, approval_state: 'Pending', submitted_at: '2026-10-28T10:00:00Z', assigned_approver_name: 'Imran' }, NOW));
  assert.equal(late.raised.state, 'done');
  assert.equal(late.approved.state, 'current');
  assert.equal(late.approved.note, 'with Imran · 6 days');
  assert.equal(late.approved.late, true);
  const fresh = byKey(journeyStops({ ...draft, approval_state: 'Pending', submitted_at: '2026-11-02T10:00:00Z' }, NOW));
  assert.equal(fresh.approved.note, 'with approver · 1 day');
  assert.equal(fresh.approved.late, false);
});

test('a sent-back QD notes the date on the Approved stop', () => {
  const s = byKey(journeyStops({ ...draft, approval_state: 'SentBack', sent_back_at: '2026-10-30T12:00:00Z' }, NOW));
  assert.equal(s.approved.state, 'current');
  assert.equal(s.approved.note, 'sent back 2026-10-30');
});

const approved = {
  ...draft, approval_state: 'Approved', approved_at: '2026-10-05T08:00:00Z',
  sent_to_purchase_date: '2026-10-05', sent_to_supplier_date: '2026-10-06',
};

test('an approved QD out with the supplier is late past its ETA', () => {
  const s = byKey(journeyStops({ ...approved, status: 'Sent to Supplier', eta_date: '2026-08-29' }, NOW));
  assert.equal(s.approved.state, 'done');
  assert.equal(s.approved.date, '2026-10-05');
  assert.equal(s.purchase.state, 'done');
  assert.equal(s.supplier.state, 'done');
  assert.equal(s.reply.state, 'current');
  assert.equal(s.reply.late, true);
  assert.equal(s.reply.note, '66 days past ETA');
  assert.equal(s.reply.date, '2026-08-29');
  assert.equal(s.closed.state, 'todo');
});

test('a reply stop with a future ETA is current but not late', () => {
  const s = byKey(journeyStops({ ...approved, status: 'Sent to Supplier', eta_date: '2026-11-20' }, NOW));
  assert.equal(s.reply.state, 'current');
  assert.equal(s.reply.late, false);
  assert.equal(s.reply.note, 'ETA 2026-11-20');
});

test('a supplier acceptance completes the reply stop', () => {
  const s = byKey(journeyStops({ ...approved, status: 'FOC Accepted', eta_date: '2026-08-29', supplier_acceptance: 'Yes' }, NOW));
  assert.equal(s.reply.state, 'done');
  assert.equal(s.reply.late, false);
  assert.equal(s.reply.note, 'accepted');
});

test('FOC stops appear only with rounds and read the latest round', () => {
  const foc = {
    roundCount: 2, state: 'awaiting-trial', daysIdle: 4, daysOverdue: null,
    promisedEta: '2026-10-25', receivedDate: '2026-11-01', trialDate: null, trialResult: null,
    rounds: [{ round_no: 1 }, { round_no: 2 }],
  };
  const stops = journeyStops({ ...approved, status: 'FOC Received', supplier_acceptance: 'Yes', foc }, NOW);
  assert.deepEqual(keysOf(stops), ['raised', 'approved', 'purchase', 'supplier', 'reply', 'foc', 'trial', 'closed']);
  const s = byKey(stops);
  assert.equal(s.foc.state, 'done');
  assert.equal(s.foc.date, '2026-11-01');
  assert.equal(s.foc.label, 'FOC received');
  assert.equal(s.trial.state, 'current');
  assert.equal(s.trial.note, 'awaiting trial · 4 days in plant');
  assert.equal(s.trial.label, 'Trial · attempt 2');
  assert.equal(s.closed.state, 'todo');
});

test('FOC awaiting receipt past its promise is late', () => {
  const foc = {
    roundCount: 1, state: 'awaiting-receipt', daysOverdue: 5, daysIdle: null,
    promisedEta: '2026-10-29', receivedDate: null, trialDate: null, trialResult: null, rounds: [{ round_no: 1 }],
  };
  const s = byKey(journeyStops({ ...approved, status: 'FOC Accepted', supplier_acceptance: 'Yes', foc }, NOW));
  assert.equal(s.foc.state, 'current');
  assert.equal(s.foc.late, true);
  assert.equal(s.foc.note, '5 days overdue');
  assert.equal(s.foc.date, '2026-10-29');
  assert.equal(s.trial.state, 'todo');
});

test('a passed trial shows its result and date', () => {
  const foc = {
    roundCount: 1, state: 'trial-passed', daysOverdue: null, daysIdle: null,
    promisedEta: '2026-10-20', receivedDate: '2026-10-22', trialDate: '2026-10-25', trialResult: 'Pass', rounds: [{ round_no: 1 }],
  };
  const s = byKey(journeyStops({ ...approved, status: 'FOC Received', supplier_acceptance: 'Yes', foc }, NOW));
  assert.equal(s.trial.state, 'done');
  assert.equal(s.trial.note, 'Pass');
  assert.equal(s.trial.date, '2026-10-25');
  assert.equal(s.closed.state, 'current');
});

test('a closed QD has no current stop and dashes for missing dates', () => {
  const s = byKey(journeyStops({
    ...draft, approval_state: 'Approved', status: 'Closed', closed_at: '2026-10-20',
    approved_at: null, sent_to_purchase_date: null, sent_to_supplier_date: null,
  }, NOW));
  assert.ok(Object.values(s).every((x) => x.state === 'done'), JSON.stringify(s));
  assert.ok(Object.values(s).every((x) => x.late === false));
  assert.equal(s.supplier.date, null);
  assert.equal(s.closed.date, '2026-10-20');
  assert.equal(s.closed.label, 'Closed');
});

test('a legacy approved QD with no approval date counts Approved as done', () => {
  const s = byKey(journeyStops({ ...draft, approval_state: 'Approved', approved_at: null, sent_to_purchase_date: '2026-09-01', status: 'Open' }, NOW));
  assert.equal(s.approved.state, 'done');
  assert.equal(s.approved.date, null);
  assert.equal(s.approved.note, 'approved');
  assert.equal(s.purchase.state, 'done');
  assert.equal(s.supplier.state, 'current');
});

test('Rejected relabels the last stop', () => {
  const s = byKey(journeyStops({ ...approved, status: 'Rejected', closed_at: '2026-10-20' }, NOW));
  assert.equal(s.closed.label, 'Rejected');
  assert.equal(s.closed.state, 'done');
});

test('a cancelled QD greys everything and ends on a Cancelled stop', () => {
  const stops = journeyStops({ ...draft, approval_state: 'Cancelled', cancelled_at: '2026-11-02T10:00:00Z', cancel_reason: 'Raised twice' }, NOW);
  assert.deepEqual(keysOf(stops), ['raised', 'cancelled']);
  assert.equal(stops[0].state, 'cancelled');
  const last = stops[stops.length - 1];
  assert.equal(last.state, 'cancelled');
  assert.equal(last.date, '2026-11-02');
  assert.equal(last.note, 'Raised twice');
  assert.ok(stops.every((x) => x.state !== 'current'));
});
