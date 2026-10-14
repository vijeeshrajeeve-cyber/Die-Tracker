'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ordering = require('./orderingReminder.cjs');

const at = (hhmm, date = '2026-10-14') => new Date(`${date}T${hhmm}:00`);

// ── Scheduling ─────────────────────────────────────────────────────────────

test('a disabled reminder is never due', () => {
  assert.equal(ordering.isDue({ enabled: false, time: '08:00', lastRun: null }, at('09:00')), false);
});

test('due at or after its time, once a day', () => {
  const cfg = { enabled: true, time: '08:00', lastRun: null };
  assert.equal(ordering.isDue(cfg, at('07:59')), false);
  assert.equal(ordering.isDue(cfg, at('08:00')), true);
  assert.equal(ordering.isDue({ ...cfg, lastRun: '2026-10-14' }, at('09:00')), false);
  assert.equal(ordering.isDue({ ...cfg, lastRun: '2026-10-13' }, at('09:00')), true);
});

test('a timestamp-shaped last_run is compared by day', () => {
  assert.equal(
    ordering.isDue({ enabled: true, time: '08:00', lastRun: '2026-10-14T00:00:00.000Z' }, at('09:00')),
    false
  );
});

// ── Selection ──────────────────────────────────────────────────────────────

test('only orders older than the threshold are overdue; exactly N days is not', () => {
  const rows = [
    { die_no: 'A', die_requested_date: '2026-10-11' }, // 3 days
    { die_no: 'B', die_requested_date: '2026-10-12' }, // 2 days: not yet
    { die_no: 'C', die_requested_date: '2026-10-14' }, // today
  ];
  const { overdue } = ordering.selectOverdue(rows, 2, '2026-10-14');
  assert.deepEqual(overdue.map((o) => o.die_no), ['A']);
  assert.equal(overdue[0].days_pending, 3);
});

test('a missing or non-ISO requested date is counted as undated, never guessed', () => {
  const rows = [
    { die_no: 'A', die_requested_date: null },
    { die_no: 'B', die_requested_date: '' },
    { die_no: 'C', die_requested_date: '14/10/2026' },
    { die_no: 'D', die_requested_date: '2026-10-01' },
  ];
  const { overdue, undated } = ordering.selectOverdue(rows, 2, '2026-10-14');
  assert.deepEqual(overdue.map((o) => o.die_no), ['D']);
  assert.equal(undated, 3);
});

test('the oldest order is listed first', () => {
  const rows = [
    { die_no: 'NEW', die_requested_date: '2026-10-10' },
    { die_no: 'OLD', die_requested_date: '2026-09-01' },
  ];
  const { overdue } = ordering.selectOverdue(rows, 2, '2026-10-14');
  assert.deepEqual(overdue.map((o) => o.die_no), ['OLD', 'NEW']);
});

test('orders are grouped by plant, with a blank plant kept visible', () => {
  const g = ordering.groupByPlant([
    { die_no: '1', plant: 'GEX 01' }, { die_no: '2', plant: 'GEX 02' },
    { die_no: '3', plant: 'GEX 01' }, { die_no: '4', plant: '  ' },
  ]);
  assert.deepEqual(Object.keys(g).sort(), ['GEX 01', 'GEX 02', 'Unassigned plant']);
  assert.equal(g['GEX 01'].length, 2);
});

// ── Body ───────────────────────────────────────────────────────────────────

test('the body escapes order data and states the threshold', () => {
  const html = ordering.buildBody('GEX 01', [
    { die_no: '<b>X</b>', order_no: 'O1', die_requested_date: '2026-10-01', days_pending: 13, plant: 'GEX 01' },
  ], 2);
  assert.match(html, /more than 2 day\(s\)/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>X<\/b>/);
});
