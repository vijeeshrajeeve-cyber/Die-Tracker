'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const summary = require('./dailySummary.cjs');

const at = (hhmm, date = '2026-08-29') => new Date(`${date}T${hhmm}:00`);

// ── Scheduling ──────────────────────────────────────────────────────────────

test('a disabled summary is never due', () => {
  assert.equal(summary.isDue({ enabled: false, time: '06:00', lastRun: null }, at('07:00')), false);
});

test('the summary is due at or after its time, once a day', () => {
  const cfg = { enabled: true, time: '06:00', lastRun: null };
  assert.equal(summary.isDue(cfg, at('05:59')), false);
  assert.equal(summary.isDue(cfg, at('06:00')), true);
  assert.equal(summary.isDue(cfg, at('23:30')), true);
});

test('a summary that already ran today stays quiet', () => {
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-29' }, at('07:00')), false);
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-28' }, at('07:00')), true);
});

test('a run missed while the server was down goes out on the next tick', () => {
  assert.equal(summary.isDue({ enabled: true, time: '06:00', lastRun: '2026-08-25' }, at('14:00')), true);
});

test('a timestamp-shaped last_run is compared by day, not by string', () => {
  assert.equal(summary.isDue(
    { enabled: true, time: '06:00', lastRun: '2026-08-29T00:00:00.000Z' }, at('07:00')), false);
});

test('a missing time falls back to 06:00 rather than firing at midnight', () => {
  const cfg = { enabled: true, time: null, lastRun: null };
  assert.equal(summary.isDue(cfg, at('05:30')), false);
  assert.equal(summary.isDue(cfg, at('06:30')), true);
});

// ── Dates ───────────────────────────────────────────────────────────────────

test('the report covers the day before the run, across a month boundary', () => {
  assert.equal(summary.previousDay('2026-08-29'), '2026-08-28');
  assert.equal(summary.previousDay('2026-09-01'), '2026-08-31');
  assert.equal(summary.previousDay('2026-01-01'), '2025-12-31');
  assert.equal(summary.previousDay('2026-03-01'), '2026-02-28');
});

test('localDateString reads the local calendar day, not UTC', () => {
  // 01:30 Dubai on the 29th is still the 28th in UTC. The scheduler compares
  // against a local DATE, so this must say the 29th.
  assert.equal(summary.localDateString(new Date(2026, 7, 29, 1, 30)), '2026-08-29');
});

// ── Email body ──────────────────────────────────────────────────────────────

const baseReport = {
  reportDate: '2026-08-28',
  activity: [{ key: 'requested', label: 'Die orders <requested>', count: 3 }],
  activityTotal: 3,
  late: [], lateTotal: 0,
  pending: [{ status: 'PENDING FOR PR', label: 'Pending PR', count: 2, oldestDays: 11 }],
  unparseable: [],
};

test('the email body carries every headline number and escapes its input', () => {
  const html = summary.buildEmailBody(baseReport);
  assert.match(html, /Die orders &lt;requested&gt;/, 'labels must be escaped, not injected');
  assert.match(html, />3</);
  assert.match(html, /Pending PR/);
  assert.match(html, />11</);
});

test('the email body names the late count when there is one', () => {
  assert.doesNotMatch(summary.buildEmailBody(baseReport), /recorded late/i);
  assert.match(summary.buildEmailBody({ ...baseReport, lateTotal: 4 }), /4[^<]*recorded late/i);
});

test('a null oldest age renders as a dash, never as zero', () => {
  const html = summary.buildEmailBody({
    ...baseReport,
    pending: [{ status: 'HOLD', label: 'On Hold', count: 1, oldestDays: null }],
  });
  assert.doesNotMatch(html, /On Hold[\s\S]{0,200}>0</);
});

test('the body says the pending block is a snapshot', () => {
  assert.match(summary.buildEmailBody(baseReport), /not as at the report date/i);
});
