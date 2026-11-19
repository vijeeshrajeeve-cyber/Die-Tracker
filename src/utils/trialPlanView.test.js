import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, formatPlanDate, relativeDayLabel, periodRange, previousPeriod, nextPeriod, periodLabel,
  availableToPlan, searchSamples, needsOutOfQueueReason, entryFromSample, groupByPress, pressNote,
  toolingClashNotes, checkSentence, resultOf, showPct, delta, planExportRows, editableFields,
} from './trialPlanView.js';

const TODAY = '2026-11-19'; // a Thursday

test('dates step across month and year ends and read as the plan bar shows them', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2027-01-01', -1), '2026-12-31');
  assert.equal(formatPlanDate('2026-11-19'), 'Thu 19 Nov 2026');
  assert.equal(relativeDayLabel('2026-11-20', TODAY), 'Tomorrow');
  assert.equal(relativeDayLabel('2026-11-19', TODAY), 'Today');
  assert.equal(relativeDayLabel('2026-11-17', TODAY), 'Past plan');
});

test('a reporting week runs Monday to Saturday, and a Sunday belongs to the week before', () => {
  assert.deepEqual(periodRange('week', TODAY), { from: '2026-11-16', to: '2026-11-21' });
  assert.deepEqual(periodRange('week', '2026-11-22'), { from: '2026-11-16', to: '2026-11-21' });
  assert.deepEqual(periodRange('week', '2026-11-16'), { from: '2026-11-16', to: '2026-11-21' });
  assert.deepEqual(previousPeriod('week', '2026-11-16'), { from: '2026-11-09', to: '2026-11-14' });
  assert.deepEqual(nextPeriod('week', '2026-11-21'), { from: '2026-11-23', to: '2026-11-28' });
  assert.equal(periodLabel('week', { from: '2026-11-16', to: '2026-11-21' }), '16 Nov – 21 Nov 2026');
});

test('a month is its whole calendar month, February included', () => {
  assert.deepEqual(periodRange('month', TODAY), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(periodRange('month', '2028-02-10'), { from: '2028-02-01', to: '2028-02-29' });
  assert.deepEqual(previousPeriod('month', '2026-01-01'), { from: '2025-12-01', to: '2025-12-31' });
  assert.deepEqual(nextPeriod('month', '2026-12-31'), { from: '2027-01-01', to: '2027-01-31' });
  assert.equal(periodLabel('month', { from: '2026-11-01', to: '2026-11-30' }), 'Nov 2026');
});

const sample = (over = {}) => ({
  id: 'order-1', _source: 'order', _order: { id: 1 }, die: '31204-402', plant: 'P2', press: 'Press 4',
  customer: 'Acme', corrector: 'erive', stage: 'Pending', status: 'Pending', die_received_date: '2026-11-12', days: 7, ...over,
});

test('only received dies still at Pending are offered, not ones already planned, longest wait first', () => {
  const samples = [
    sample({ die: 'A-1', days: 2 }),
    sample({ die: 'B-1', days: 9 }),
    sample({ die: 'C-1', die_received_date: '' }),
    sample({ die: 'D-1', stage: 'Approved' }),
    sample({ die: 'E_1', days: 4 }),
  ];
  const offered = availableToPlan(samples, [{ die_no: 'E-1' }]);
  assert.deepEqual(offered.map(s => s.die), ['B-1', 'A-1']);
  assert.deepEqual(availableToPlan(samples, [], { plant: 'P9' }), []);
});

test('the search finds dies in any stage by die or customer, skipping planned ones', () => {
  const samples = [sample({ die: '32140-401', customer: 'Gulf' }), sample({ die: '32128-401', stage: 'Approved', customer: 'Acme' })];
  assert.deepEqual(searchSamples(samples, '32140_4', []).map(s => s.die), ['32140-401']);
  assert.deepEqual(searchSamples(samples, 'acme', []).map(s => s.die), ['32128-401']);
  assert.deepEqual(searchSamples(samples, '401', [{ die_no: '32140-401' }]).map(s => s.die), ['32128-401']);
  assert.deepEqual(searchSamples(samples, '  ', []), []);
});

test('a trial needs a reason unless the die is waiting for trial; a supervised run never does', () => {
  assert.equal(needsOutOfQueueReason(sample(), 'Trial'), false);
  assert.equal(needsOutOfQueueReason(sample({ stage: 'Approved' }), 'Trial'), true);
  assert.equal(needsOutOfQueueReason(null, 'Trial'), true);
  assert.equal(needsOutOfQueueReason(null, 'Supervised'), false);
});

test('a new entry copies the die record and links the right parent', () => {
  const entry = entryFromSample(sample(), { toolings: ['i-15781', 'b-2-5-a'], alloy: '6063', urgent: true });
  assert.deepEqual(entry, {
    die_no: '31204-402', entry_type: 'Trial', urgent: true, die_order_id: 1,
    plant: 'P2', press: 'Press 4', customer: 'Acme', corrector: 'erive',
    tooling: 'i-15781, b-2-5-a', alloy: '6063', out_of_queue_reason: null,
  });
  const standalone = entryFromSample(sample({ _source: 'standalone', _order: undefined, _raw: { id: 9 } }));
  assert.equal(standalone.sample_followup_id, 9);
  assert.equal(standalone.die_order_id, undefined);
  assert.equal(standalone.tooling, null);
});

test('the PUT body carries every editable field, blanks as empty text', () => {
  assert.deepEqual(editableFields({ entry_type: 'Trial', urgent: null, press: 'Press 4' }), {
    entry_type: 'Trial', urgent: false, plant: '', press: 'Press 4', customer: '', alloy: '', tooling: '', corrector: '', out_of_queue_reason: '',
  });
});

test('entries group by press in number order, with no press last', () => {
  const groups = groupByPress([
    { die_no: 'a', press: 'Press 10' }, { die_no: 'b', press: '' }, { die_no: 'c', press: 'Press 2', entry_type: 'Supervised' }, { die_no: 'd', press: 'Press 2' },
  ]);
  assert.deepEqual(groups.map(g => g.press), ['Press 2', 'Press 10', 'No press']);
  assert.equal(pressNote(groups[0]), '1 trial · 1 supervised');
  assert.equal(pressNote(groups[1]), '1 trial');
});

test('a tooling clash names the other press on each clashing entry', () => {
  const entries = [{ die_no: 'x', press: 'Press 4' }, { die_no: 'y', press: 'Press 5' }, { die_no: 'z', press: 'Press 6' }];
  const checks = [{ kind: 'tooling', tooling: 'i-23436', presses: ['Press 4', 'Press 5'], dies: ['x', 'y'] }];
  const notes = toolingClashNotes(entries, checks);
  assert.equal(notes.get('x'), 'also on Press 5');
  assert.equal(notes.get('y'), 'also on Press 4');
  assert.equal(notes.has('z'), false);
  assert.equal(checkSentence(checks[0]), 'i-23436 is planned on Press 4 and Press 5 the same day.');
  assert.equal(checkSentence({ kind: 'corrector', corrector: 'washanta', count: 4 }), 'washanta has 4 dies on this plan.');
});

test('result chips read as the sheet did', () => {
  assert.deepEqual(resultOf({ outcome: 'OK' }), { label: 'OK', tone: 'ok' });
  assert.deepEqual(resultOf({ outcome: 'OK', entry_type: 'Supervised' }), { label: 'Run OK', tone: 'ok' });
  assert.deepEqual(resultOf({ outcome: 'Not OK', fail_reason: 'Dimension Out of Spec' }), { label: 'Not OK · Dimension', tone: 'bad' });
  assert.deepEqual(resultOf({ outcome: 'Not run' }), { label: 'Not run', tone: 'neutral' });
  assert.equal(resultOf({ outcome: null }).tone, 'waiting');
});

test('ratios with nothing to divide by show a dash, and deltas know which way is good', () => {
  assert.equal(showPct(null), '—');
  assert.equal(showPct(25), '25%');
  assert.deepEqual(delta(5, 3), { text: '+2 vs previous', tone: 'good' });
  assert.deepEqual(delta(40, 50, { better: 'down', unit: ' pts' }), { text: '−10 pts vs previous', tone: 'good' });
  assert.equal(delta(null, 3), null);
  assert.deepEqual(delta(3, 3), { text: 'same as before', tone: 'flat' });
});

test('the export lists every entry under its press with its result', () => {
  const rows = planExportRows([
    { die_no: 'b', press: 'Press 6', entry_type: 'Trial', outcome: 'Not OK', fail_reason: 'Shape', urgent: true },
    { die_no: 'a', press: 'Press 2', entry_type: 'Supervised' },
  ]);
  assert.deepEqual(rows.map(r => [r.press, r.die_no, r.result, r.urgent]), [['Press 2', 'a', '', ''], ['Press 6', 'b', 'Not OK · Shape', 'Yes']]);
});

test('the queue for a plant takes either spelling of that plant and nothing else', async () => {
  const { availableToPlan, plantKey } = await import('./trialPlanView.js');
  assert.equal(plantKey('GEX 01'), 'GEX 1');
  assert.equal(plantKey('gex2'), 'GEX 2');
  const waiting = (die, plant) => ({ id: die, die, plant, stage: 'Pending', die_received_date: '2026-11-10', days: 3 });
  const samples = [waiting('1-1', 'GEX 1'), waiting('2-1', 'GEX 01'), waiting('3-1', 'GEX 2')];
  assert.deepEqual(availableToPlan(samples, [], { plant: 'GEX 1' }).map(s => s.die), ['1-1', '2-1']);
  assert.deepEqual(availableToPlan(samples, [], { plant: 'GEX 2' }).map(s => s.die), ['3-1']);
});

test('a carry-over reads as the plant asked, and lands on the next working day', async () => {
  const { carryNote, carryTarget, nextWorkingDay, resultOf, ordinalDate } = await import('./trialPlanView.js');
  assert.equal(carryNote({ carried_from_date: '2026-11-20', carry_reason: 'Alloy shortage' }), 'Carry over from 20th Nov because of Alloy shortage');
  assert.equal(carryNote({}), null);
  assert.equal(ordinalDate('2026-11-22'), '22nd Nov');
  assert.equal(ordinalDate('2026-11-11'), '11th Nov');
  assert.equal(nextWorkingDay('2026-11-21'), '2026-11-23');
  assert.equal(carryTarget('2026-11-16', '2026-11-19'), '2026-11-19');
  assert.equal(resultOf({ outcome: 'Not run', not_run_reason: 'Press breakdown' }).label, 'Not run · Press breakdown');
});
