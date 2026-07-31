'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const foc = require('./focReminder.cjs');

// ── Scheduling ─────────────────────────────────────────────────────────────

const at = (hhmm, date = '2026-07-17') => new Date(`${date}T${hhmm}:00`);

test('a disabled chaser is never due', () => {
  assert.equal(foc.isDue({ enabled: false, time: '08:00', lastRun: null }, at('09:00')), false);
});

test('a chaser is due at or after its time, once a day', () => {
  const cfg = { enabled: true, time: '08:00', lastRun: null };
  assert.equal(foc.isDue(cfg, at('07:59')), false);
  assert.equal(foc.isDue(cfg, at('08:00')), true);
  assert.equal(foc.isDue(cfg, at('17:30')), true);
});

test('a chaser that already ran today stays quiet', () => {
  const cfg = { enabled: true, time: '08:00', lastRun: '2026-07-17' };
  assert.equal(foc.isDue(cfg, at('09:00')), false);
  assert.equal(foc.isDue({ ...cfg, lastRun: '2026-07-16' }, at('09:00')), true,
    'yesterday\'s run does not cover today');
});

test('a run missed while the server was down goes out on the next tick', () => {
  // configured for 08:00, server came back at 14:00 having never run today
  assert.equal(foc.isDue({ enabled: true, time: '08:00', lastRun: '2026-07-15' }, at('14:00')), true);
});

test('a timestamp-shaped last_run is compared by day, not by string', () => {
  const cfg = { enabled: true, time: '08:00', lastRun: '2026-07-17T00:00:00.000Z' };
  assert.equal(foc.isDue(cfg, at('09:00')), false);
});

// ── Queries ────────────────────────────────────────────────────────────────

const fakeDb = () => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; },
  };
};

test('the overdue query looks only at live rounds of unsettled, non-draft QDs', async () => {
  const db = fakeDb();
  await foc.overdueReceipts(db);
  const { sql } = db.calls[0];
  assert.match(sql, /status NOT IN \('Closed', 'Rejected', 'Reference'\)/);
  assert.match(sql, /approval_state <> 'Draft'/);
  assert.match(sql, /r\.trial_result IS NULL/);
  assert.match(sql, /r\.received_date IS NULL/);
  assert.match(sql, /r\.promised_eta < CURRENT_DATE/);
  assert.match(sql, /MAX\(r2\.round_no\)/, 'only the newest round is live');
});

test('the idle query takes the threshold as a parameter', async () => {
  const db = fakeDb();
  await foc.idleReceipts(5, db);
  const { sql, params } = db.calls[0];
  assert.deepEqual(params, [5]);
  assert.match(sql, /r\.received_date IS NOT NULL/);
  assert.match(sql, /r\.received_date <= CURRENT_DATE - \$1::int/);
  assert.match(sql, /r\.trial_result IS NULL/, 'a trialled round is not idle, it is done');
});

// ── Email bodies ───────────────────────────────────────────────────────────

const overdueRow = (over) => ({
  qd_no: '2026PD-01', die_no: 'D-1234', profile_number: 'P-77',
  supplier: 'PDTMC', plant: 'GEX 01', round_no: 1,
  promised_eta: '2026-07-01', days_overdue: over,
});

test('the supplier mail lists each overdue FOC with its own promised date', () => {
  const html = foc.buildSupplierBody('PDTMC', [overdueRow(16), { ...overdueRow(3), qd_no: '2026PD-02' }]);
  assert.match(html, /Dear PDTMC Team/);
  assert.match(html, /2026PD-01/);
  assert.match(html, /2026PD-02/);
  assert.match(html, /2026-07-01/);
  assert.match(html, />16</);
});

test('the supplier mail explains the attempt column only when there has been a retry', () => {
  const first = foc.buildSupplierBody('PDTMC', [overdueRow(16)]);
  assert.doesNotMatch(first, /did not pass its trial/);

  const repeat = foc.buildSupplierBody('PDTMC', [{ ...overdueRow(16), round_no: 2 }]);
  assert.match(repeat, /did not pass its trial/,
    'a second attempt is worth naming — it is the supplier\'s second bad die');
});

test('the supplier mail escapes anything that came from the database', () => {
  const html = foc.buildSupplierBody('ACME <script>', [{ ...overdueRow(2), die_no: 'D<&>1' }]);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /D&lt;&amp;&gt;1/);
});

test('a trimmed date is shown, not a full timestamp', () => {
  const html = foc.buildSupplierBody('PDTMC', [{ ...overdueRow(2), promised_eta: '2026-07-01T00:00:00.000Z' }]);
  assert.match(html, />2026-07-01</);
  assert.doesNotMatch(html, /T00:00:00/);
});

test('the internal mail carries both buckets and names the idle threshold', () => {
  const idle = [{
    qd_no: '2026EK-04', die_no: 'D-9', profile_number: 'P-1',
    supplier: 'EKSTEK', plant: 'GEX 02', round_no: 2,
    received_date: '2026-07-05', days_idle: 12,
  }];
  const html = foc.buildInternalBody([overdueRow(16)], idle, 3);
  assert.match(html, /Awaiting receipt — past the supplier's ETA \(1\)/);
  assert.match(html, /awaiting trial for more than 3 day\(s\) \(1\)/);
  assert.match(html, /2026PD-01/);
  assert.match(html, /2026EK-04/);
  assert.match(html, /cannot be closed/);
});

test('the internal mail drops a bucket that is empty rather than showing a bare heading', () => {
  const onlyOverdue = foc.buildInternalBody([overdueRow(16)], [], 3);
  assert.match(onlyOverdue, /Awaiting receipt/);
  assert.doesNotMatch(onlyOverdue, /awaiting trial for more than/);

  const onlyIdle = foc.buildInternalBody([], [{
    qd_no: '2026EK-04', die_no: 'D-9', supplier: 'EKSTEK', plant: 'GEX 02',
    received_date: '2026-07-05', days_idle: 12,
  }], 3);
  assert.doesNotMatch(onlyIdle, /Awaiting receipt/);
  assert.match(onlyIdle, /awaiting trial for more than/);
});
