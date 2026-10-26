'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sim = require('./simulationRounds.cjs');

const TODAY = '2026-10-21'; // Wednesday
const order = (over = {}) => ({
  id: 7, die_no: 'D-1', order_no: 'O-1', plant: 'P1', supplier: 'ALPHA', press: '1800T',
  customer_name: 'ACME', status: 'UNDER SIMULATION', design_revision_count: 0,
  design_received_date: '2026-10-10', three_d_model_received_date: null, ...over,
});
const row = (over = {}) => ({
  id: 1, order_id: 7, round_no: 1, started_from: 'initial', revision_id: null,
  model_received_date: null, model_date_target: null, prep_done_date: null,
  sim_completed_date: null, result: null, fail_reason: null, modification: null,
  supplier_revision_id: null, modification_done_date: null, comments: null, ...over,
});
const die = (o, rows = [], extra = {}) =>
  sim.deriveDie({ order: o, rows, latestRevision: null, calendar: {}, today: TODAY, ...extra });

test('reason list is exactly the agreed vocabulary, in order', () => {
  assert.deepEqual(sim.FAIL_REASONS, [
    'Uneven exit velocity / flow imbalance', 'Extrusion pressure too high (exceeds press capacity)',
    'Die deflection / stress too high', 'Weld seam quality', 'Exit temperature out of range',
    'Profile dimension / shape deviation', 'Other',
  ]);
});

test('stage labels are the agreed wording', () => {
  assert.deepEqual(sim.STAGE_LABELS, {
    awaiting_model: 'Awaiting 3D model', model_received: '3D model received',
    prep_done: 'Preparation done', in_house_mod: 'In-house modification',
  });
});

test('a new die in Simulation gets one virtual round awaiting its 3D model', () => {
  const d = die(order());
  assert.equal(d.rounds.length, 1);
  assert.equal(d.rounds[0].id, null);
  assert.equal(d.rounds[0].started_from, 'initial');
  assert.equal(d.stage, 'awaiting_model');
  assert.equal(d.stage_label, 'Awaiting 3D model');
  assert.equal(d.stage_since, '2026-10-10');
  assert.equal(d.round_no, 1);
});

test('first-pass legacy die with a 3D date starts at 3D model received from that date', () => {
  const d = die(order({ three_d_model_received_date: '2026-10-19' }));
  assert.equal(d.stage, 'model_received');
  assert.equal(d.rounds[0].model_received_date, '2026-10-19');
  assert.equal(d.rounds[0].legacy, true);
});

test('legacy die back after a revision does not reuse the old 3D date', () => {
  const d = die(order({ three_d_model_received_date: '2026-03-01', design_revision_count: 1 }));
  assert.equal(d.stage, 'awaiting_model');
  assert.equal(d.rounds[0].model_received_date, null);
});

test('after a Supplier round closes, the next virtual round starts from supplier', () => {
  const closed = row({ model_received_date: '2026-10-01', prep_done_date: '2026-10-01', sim_completed_date: '2026-10-02',
    result: 'Not OK', fail_reason: 'Other', modification: 'Supplier' });
  const d = die(order({ design_revision_count: 1 }), [closed],
    { latestRevision: { id: 3, design_received_date: '2026-10-15', revision_date: '2026-10-02' } });
  assert.equal(d.rounds.length, 2);
  assert.equal(d.rounds[0].stage, 'closed');
  assert.equal(d.rounds[1].started_from, 'supplier');
  assert.equal(d.rounds[1].round_no, 2);
  assert.equal(d.stage_since, '2026-10-15');
});

test('a closed OK round followed by re-entry starts a reentry round', () => {
  const ok = row({ model_received_date: '2026-10-01', prep_done_date: '2026-10-01', sim_completed_date: '2026-10-02', result: 'OK' });
  const d = die(order(), [ok]);
  assert.equal(d.rounds[1].started_from, 'reentry');
});

test('an open round on an order that left Simulation is marked left_simulation', () => {
  const open = row({ model_received_date: '2026-10-19' });
  const rounds = sim.deriveRounds({ order: order({ status: 'PENDING FOR DESIGN APPROVAL' }), rows: [open] });
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].left_simulation, 'PENDING FOR DESIGN APPROVAL');
  assert.equal(rounds[0].stage, 'left');
});

test('an in-house Not OK round without a done date is at In-house modification', () => {
  const r = row({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19', sim_completed_date: '2026-10-20',
    result: 'Not OK', fail_reason: 'Weld seam quality', modification: 'In-house' });
  assert.equal(sim.stageOfRound(r), 'in_house_mod');
  assert.equal(sim.stageOfRound({ ...r, modification_done_date: '2026-10-21' }), 'closed');
});

test('late: model Mon, open on Wed is late; open on Tue is not', () => {
  const open = row({ model_received_date: '2026-10-19' });
  assert.equal(die(order(), [open]).late, true);
  assert.equal(die(order(), [open], { today: '2026-10-20' }).late, false);
});

test('late: model Sat, completed Mon is not late (Sunday skipped)', () => {
  const done = row({ model_received_date: '2026-10-24', prep_done_date: '2026-10-24', sim_completed_date: '2026-10-26',
    result: 'Not OK', fail_reason: 'Other', modification: 'In-house' });
  const d = die(order(), [done], { today: '2026-10-26' });
  assert.equal(d.rounds[0].model_to_result_days, 1);
  assert.equal(d.rounds[0].late, false);
});

test('awaiting and in-house stages are never late', () => {
  assert.equal(die(order({ design_received_date: '2026-09-01' })).late, false);
  const r = row({ model_received_date: '2026-10-01', prep_done_date: '2026-10-01', sim_completed_date: '2026-10-01',
    result: 'Not OK', fail_reason: 'Other', modification: 'In-house' });
  const d = die(order(), [r]);
  assert.equal(d.stage, 'in_house_mod');
  assert.equal(d.late, false);
});

test('days on stage count working days from when the stage began', () => {
  const d = die(order(), [row({ model_received_date: '2026-10-19', prep_done_date: '2026-10-20' })]);
  assert.equal(d.stage, 'prep_done');
  assert.equal(d.days_on_stage, 1);
});

test('step must match the stage', () => {
  const r = sim.validateStep(sim.deriveRounds({ order: order(), rows: [] })[0], { step: 'prep_done', date: '2026-10-20' }, TODAY);
  assert.equal(r.ok, false);
  assert.equal(r.stageMismatch, true);
  assert.match(r.error, /stage/i);
});

test('future date and date before previous step are rejected', () => {
  const r = { ...row({ model_received_date: '2026-10-19' }), stage: 'model_received' };
  assert.equal(sim.validateStep(r, { step: 'prep_done', date: '2026-10-22' }, TODAY).ok, false);
  assert.equal(sim.validateStep(r, { step: 'prep_done', date: '2026-10-18' }, TODAY).ok, false);
  assert.equal(sim.validateStep(r, { step: 'prep_done', date: '2026-10-19' }, TODAY).ok, true);
  assert.equal(sim.validateStep(r, { step: 'prep_done', date: '' }, TODAY).ok, false);
});

test('Not OK needs a listed reason and a modification; Supplier needs revision notes', () => {
  const r = { ...row({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19' }), stage: 'prep_done' };
  const base = { step: 'sim_completed', date: '2026-10-20', result: 'Not OK' };
  assert.equal(sim.validateStep(r, { ...base, modification: 'In-house' }, TODAY).ok, false);
  assert.equal(sim.validateStep(r, { ...base, fail_reason: 'Gremlins', modification: 'In-house' }, TODAY).ok, false);
  assert.equal(sim.validateStep(r, { ...base, fail_reason: 'Other' }, TODAY).ok, false);
  assert.equal(sim.validateStep(r, { ...base, fail_reason: 'Other', modification: 'Supplier', revision_notes: '  ' }, TODAY).ok, false);
  const ok = sim.validateStep(r, { ...base, fail_reason: 'Other', modification: 'Supplier', revision_notes: 'Fix bearing' }, TODAY);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.revision_notes, 'Fix bearing');
  assert.equal(sim.validateStep(r, { ...base, result: 'Maybe' }, TODAY).ok, false);
});

test('OK drops reason and modification', () => {
  const r = { ...row({ model_received_date: '2026-10-19', prep_done_date: '2026-10-19' }), stage: 'prep_done' };
  const out = sim.validateStep(r, { step: 'sim_completed', date: '2026-10-20', result: 'OK', fail_reason: 'Other', modification: 'Supplier', comments: '  ' }, TODAY);
  assert.equal(out.ok, true);
  assert.equal(out.value.fail_reason, null);
  assert.equal(out.value.modification, null);
  assert.equal(out.value.comments, null);
});

test('an open round older than the latest revision is stale: the die re-enters at Awaiting 3D model', () => {
  const stale = row({ model_received_date: '2026-09-01', created_at: '2026-09-01T08:00:00Z' });
  const d = die(order({ design_revision_count: 1 }), [stale],
    { latestRevision: { id: 9, created_at: '2026-10-05T08:00:00Z', design_received_date: '2026-10-15', revision_date: '2026-10-05' } });
  assert.equal(d.rounds.length, 2);
  assert.equal(d.rounds[0].stage, 'left');
  assert.equal(d.rounds[0].left_simulation, '');
  assert.equal(d.rounds[1].id, null);
  assert.equal(d.rounds[1].started_from, 'reentry');
  assert.equal(d.stage, 'awaiting_model');
  assert.equal(d.late, false);
});

test('an open round newer than the latest revision stays live', () => {
  const live = row({ model_received_date: '2026-10-20', created_at: '2026-10-16T08:00:00Z' });
  const d = die(order({ design_revision_count: 1 }), [live],
    { latestRevision: { id: 9, created_at: '2026-10-05T08:00:00Z', design_received_date: '2026-10-15' } });
  assert.equal(d.rounds.length, 1);
  assert.equal(d.stage, 'model_received');
});

test('a malformed revision date gives no day count instead of failing', () => {
  const d = die(order({ design_revision_count: 1 }), [],
    { latestRevision: { id: 9, design_received_date: '15/10/2026 approx', revision_date: null } });
  assert.equal(d.stage, 'awaiting_model');
  assert.equal(d.days_on_stage, null);
});

test('recent rounds cover completed rounds of the last 180 days, with working days model to result', () => {
  const rows = [
    { order_id: 1, plant: 'P1', model_received_date: '2026-10-24', sim_completed_date: '2026-10-26', result: 'OK', fail_reason: null },
    { order_id: 2, plant: 'P2', model_received_date: '2026-10-01', sim_completed_date: '2026-10-02', result: 'Not OK', fail_reason: 'Other' },
    { order_id: 3, plant: 'P1', model_received_date: '2026-03-01', sim_completed_date: '2026-03-02', result: 'OK', fail_reason: null },
    { order_id: 4, plant: 'P1', model_received_date: '2026-10-20', sim_completed_date: null, result: null, fail_reason: null },
  ];
  const out = sim.recentRounds(rows, () => ({}), '2026-10-26');
  assert.deepEqual(out, [
    { plant: 'P1', sim_completed_date: '2026-10-26', model_to_result_days: 1, result: 'OK', fail_reason: null },
    { plant: 'P2', sim_completed_date: '2026-10-02', model_to_result_days: 1, result: 'Not OK', fail_reason: 'Other' },
  ]);
});
