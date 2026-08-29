'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const data = require('./dailySummaryData.cjs');

// ── parseStageDate ──────────────────────────────────────────────────────────

test('parseStageDate accepts ISO dates', () => {
  assert.equal(data.parseStageDate('2026-08-28'), '2026-08-28');
});

test('parseStageDate accepts an ISO timestamp, keeping the date half', () => {
  assert.equal(data.parseStageDate('2026-08-28T00:00:00.000Z'), '2026-08-28');
});

test('parseStageDate accepts DD/MM/YYYY and DD-MM-YYYY, zero-padding', () => {
  assert.equal(data.parseStageDate('28/08/2026'), '2026-08-28');
  assert.equal(data.parseStageDate('5/8/2026'), '2026-08-05');
  assert.equal(data.parseStageDate('28-08-2026'), '2026-08-28');
});

test('parseStageDate accepts a Date object, since DATE columns come back as one', () => {
  assert.equal(data.parseStageDate(new Date(2026, 7, 28)), '2026-08-28');
});

// pr_entry and oracle_entry are free text (saved through sanitizeString, not
// sanitizeDate) so they really do contain things like this.
test('parseStageDate rejects free text and empties rather than guessing', () => {
  for (const junk of ['done', 'YES', '', '   ', null, undefined, 'N/A', '2026-13-45']) {
    assert.equal(data.parseStageDate(junk), null, `expected null for ${JSON.stringify(junk)}`);
  }
});

// ── STAGES ──────────────────────────────────────────────────────────────────

test('STAGES covers the eleven reported stages, in report order', () => {
  assert.deepEqual(data.STAGES.map(s => s.key), [
    'requested', 'ordered', 'design_received', 'design_approved',
    'pr_created', 'oracle_entry', 'design_to_ems', 'die_received',
    'sample_new', 'sample_backup', 'sample_other',
  ]);
});

test('every stage names a real die_orders column and carries a label', () => {
  for (const s of data.STAGES) {
    assert.ok(s.column, `${s.key} has no column`);
    assert.ok(s.label, `${s.key} has no label`);
    assert.equal(typeof s.match, 'function', `${s.key} has no match predicate`);
  }
});

test('the sample stages split on type, and other-type catches the rest', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  assert.equal(byKey.sample_new.match({ type: 'N' }), true);
  assert.equal(byKey.sample_new.match({ type: 'B' }), false);
  assert.equal(byKey.sample_backup.match({ type: 'B' }), true);
  for (const type of ['T', 'C', 'H', '', null, undefined]) {
    assert.equal(byKey.sample_other.match({ type }), true,
      `type ${JSON.stringify(type)} must land in other, not vanish`);
  }
  assert.equal(byKey.sample_other.match({ type: 'N' }), false);
});

test('only sample_other is optional; every other row renders even at zero', () => {
  const optional = data.STAGES.filter(s => s.optional).map(s => s.key);
  assert.deepEqual(optional, ['sample_other']);
});

// ── stageDateOf ─────────────────────────────────────────────────────────────

test('stageDateOf reads the stage column and applies the match predicate', () => {
  const byKey = Object.fromEntries(data.STAGES.map(s => [s.key, s]));
  const row = { submission_date: '2026-08-28', type: 'N' };
  assert.equal(data.stageDateOf(row, byKey.sample_new), '2026-08-28');
  assert.equal(data.stageDateOf(row, byKey.sample_backup), null,
    'a New submission must not also count as Backup');
});

test('stageDateOf returns null for an unparseable value', () => {
  const pr = data.STAGES.find(s => s.key === 'pr_created');
  assert.equal(data.stageDateOf({ pr_entry: 'done' }, pr), null);
});
