import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, stageOf, enrichSample, scopeSampleFollowups, sortSampleFollowups,
  bandsFor, stageSummary, daysToSubmission, lateByPlant, daysSince, plural,
} from './sampleFollowupView.js';

const TODAY = '2026-09-19';
const enrich = (records) => records.map(r => enrichSample(r, TODAY));

test('five raw statuses collapse into three stages', () => {
  assert.deepEqual(STAGES, ['Pending', 'Sample Submitted', 'Approved']);
  assert.equal(stageOf('Pending'), 'Pending');
  assert.equal(stageOf('On hold'), 'Pending');
  assert.equal(stageOf(''), 'Pending');
  assert.equal(stageOf('Sample Submitted'), 'Sample Submitted');
  assert.equal(stageOf('Rejected'), 'Sample Submitted');
  assert.equal(stageOf('Approved'), 'Approved');
});

test('days run from received to submitted, or to today while waiting', () => {
  const waiting = enrichSample({ die: '029780-2502', status: 'Pending', die_received_date: '2026-09-10' }, TODAY);
  assert.equal(waiting.days, 9);
  assert.equal(waiting.late, true);
  assert.equal(waiting.profile, '029780');

  const quick = enrichSample({ status: 'Sample Submitted', die_received_date: '2026-09-01', submission_date: '2026-09-08T00:00:00' }, TODAY);
  assert.equal(quick.days, 7);
  assert.equal(quick.late, false, 'exactly 7 days is inside the line');
});

test('approved dies are never late, and a missing received date cannot be late', () => {
  const approved = enrichSample({ status: 'Approved', die_received_date: '2026-01-01', submission_date: '2026-03-01' }, TODAY);
  assert.equal(approved.late, false);
  const undated = enrichSample({ status: 'Pending', die_received_date: '' }, TODAY);
  assert.equal(undated.days, null);
  assert.equal(undated.late, false);
});

test('a submission dated before receipt clamps to zero days', () => {
  assert.equal(enrichSample({ die_received_date: '2026-09-10', submission_date: '2026-09-05' }, TODAY).days, 0);
});

test('search covers die, profile, customer and corrector; plant is trimmed', () => {
  const rows = enrich([
    { id: 'a', die: '61042-01', profile: '61042', plant: ' Plant 1 ', customer: 'Alcoa', corrector: 'A. Rahman' },
    { id: 'b', die: '61057-01', profile: '61057', plant: 'Plant 2', customer: 'Gulf', corrector: 'M. Kumar' },
  ]);
  assert.deepEqual(scopeSampleFollowups(rows, { search: ' 61042 ' }).map(r => r.id), ['a']);
  assert.deepEqual(scopeSampleFollowups(rows, { search: 'kumar' }).map(r => r.id), ['b']);
  assert.deepEqual(scopeSampleFollowups(rows, { search: 'gulf', plant: 'Plant 1' }).map(r => r.id), []);
  assert.deepEqual(scopeSampleFollowups(rows, { plant: 'Plant 1' }).map(r => r.id), ['a']);
});

test('sorts: most overdue first puts undated dies last, without mutating the input', () => {
  const rows = enrich([
    { id: 'short', plant: 'Plant 2', die_received_date: '2026-09-17' },
    { id: 'none', plant: 'Plant 1', die_received_date: '' },
    { id: 'long', plant: 'Plant 3', die_received_date: '2026-09-01' },
  ]);
  assert.deepEqual(sortSampleFollowups(rows, 'overdue').map(r => r.id), ['long', 'short', 'none']);
  assert.deepEqual(sortSampleFollowups(rows, 'received').map(r => r.id), ['short', 'long', 'none']);
  assert.deepEqual(sortSampleFollowups(rows, 'plant').map(r => r.id), ['none', 'short', 'long']);
  assert.deepEqual(rows.map(r => r.id), ['short', 'none', 'long']);
});

test('bands split by the 7-day line and drop empty bands', () => {
  const rows = enrich([
    { id: 'late', status: 'Pending', die_received_date: '2026-09-01' },
    { id: 'hold', status: 'On hold', die_received_date: '2026-09-17' },
  ]);
  const pending = bandsFor('Pending', rows);
  assert.deepEqual(pending.map(b => [b.key, b.rows.map(r => r.id)]), [['late', ['late']], ['inside', ['hold']]]);
  assert.deepEqual(bandsFor('Pending', rows.filter(r => r.id === 'hold')).map(b => b.key), ['inside']);
  assert.deepEqual(bandsFor('Approved', enrich([{ id: 'x', status: 'Approved' }])).map(b => b.key), ['closed']);
});

test('stage summary counts every die and its late ones, never late for Approved', () => {
  const rows = enrich([
    { status: 'Pending', die_received_date: '2026-09-01' },
    { status: 'On hold', die_received_date: '2026-09-18' },
    { status: 'Rejected', die_received_date: '2026-08-01', submission_date: '2026-08-20' },
    { status: 'Approved', die_received_date: '2026-08-01', submission_date: '2026-08-30' },
  ]);
  assert.deepEqual(stageSummary(rows), {
    Pending: { count: 2, late: 1 },
    'Sample Submitted': { count: 1, late: 1 },
    Approved: { count: 1, late: 0 },
  });
});

test('days to submission averages the last 90 days against the 90 before, by submission date', () => {
  const rows = enrich([
    { die_received_date: '2026-09-01', submission_date: '2026-09-11' }, // 10, recent
    { die_received_date: '2026-08-01', submission_date: '2026-08-13' }, // 12, recent
    { die_received_date: '2026-05-01', submission_date: '2026-05-15' }, // 14, previous window
    { die_received_date: '2026-09-15' },                                // not submitted: ignored
    { die_received_date: '2025-01-01', submission_date: '2025-01-05' }, // too old: ignored
  ]);
  assert.deepEqual(daysToSubmission(rows, TODAY), { current: 11, previous: 14 });
  assert.deepEqual(daysToSubmission([], TODAY), { current: null, previous: null });
});

test('late by plant measures late dies against open ones, since Approved can never be late', () => {
  const rows = enrich([
    { plant: 'Plant 2', status: 'Pending', die_received_date: '2026-09-01' },
    { plant: 'Plant 1', status: 'Pending', die_received_date: '2026-09-18' },
    { plant: 'Plant 2', status: 'Approved', die_received_date: '2026-09-01' },
    { plant: '', status: 'Pending', die_received_date: '2026-09-01' },
    { plant: 'Plant 3', status: 'Approved', die_received_date: '2026-09-01' },
  ]);
  assert.deepEqual(lateByPlant(rows), [
    { plant: 'Plant 1', late: 0, total: 1 },
    { plant: 'Plant 2', late: 1, total: 1 },
    { plant: 'No plant', late: 1, total: 1 },
  ]);
});

test('days since and plurals', () => {
  assert.equal(daysSince('2026-09-18T20:00:00', TODAY), 1);
  assert.equal(daysSince('', TODAY), null);
  assert.equal(plural(1, 'die'), '1 die');
  assert.equal(plural(3, 'die'), '3 dies');
});

test('an approved die with no submission date is not still waiting', () => {
  const skipped = enrichSample({ status: 'Approved', die_received_date: '2026-03-04', sample_approval_date: '2026-04-30' }, TODAY);
  assert.equal(skipped.days, null);
  assert.equal(skipped.late, false);
});
