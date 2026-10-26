import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  scopeDies, sortDies, bandsFor, stageSummary, modelToResult, topReason,
} from './simulationView.js';
import { SIMULATION_FAIL_REASONS, SIMULATION_MODIFICATIONS, SIMULATION_STAGE_LABELS } from './constants.js';

const server = createRequire(import.meta.url)('../../server/services/simulationRounds.cjs');
const TODAY = '2026-10-21';

const die = (over = {}) => ({
  order_id: 1, die_no: 'D-1', order_no: 'O-1', plant: 'P1', supplier: 'ALPHA', stage: 'model_received',
  stage_since: '2026-10-19', days_on_stage: 2, late: false, round_no: 1, rounds: [], ...over,
});
const done = (sim_completed_date, model_to_result_days, extra = {}) => ({ sim_completed_date, model_to_result_days, result: 'OK', fail_reason: null, ...extra });

test('vocabulary matches the server, word for word', () => {
  assert.deepEqual(SIMULATION_FAIL_REASONS, server.FAIL_REASONS);
  assert.deepEqual(SIMULATION_MODIFICATIONS, server.MODIFICATIONS);
  assert.deepEqual(SIMULATION_STAGE_LABELS, server.STAGE_LABELS);
});

test('search matches die, order, supplier; plant filter narrows', () => {
  const dies = [die({ order_id: 1, die_no: 'AB-1' }), die({ order_id: 2, die_no: 'CD-2', supplier: 'Beta', plant: 'P2' })];
  assert.deepEqual(scopeDies(dies, { search: 'beta' }).map(d => d.order_id), [2]);
  assert.deepEqual(scopeDies(dies, { search: 'ab-' }).map(d => d.order_id), [1]);
  assert.deepEqual(scopeDies(dies, { plant: 'P1' }).map(d => d.order_id), [1]);
  assert.equal(scopeDies(dies, { plant: 'All' }).length, 2);
});

test('most overdue puts late first, then longest on stage', () => {
  const dies = [die({ order_id: 1, days_on_stage: 9 }), die({ order_id: 2, late: true, days_on_stage: 2 }), die({ order_id: 3, days_on_stage: 4 })];
  assert.deepEqual(sortDies(dies, 'overdue').map(d => d.order_id), [2, 1, 3]);
});

test('newest puts the most recent stage start first; plant sorts by plant', () => {
  const dies = [die({ order_id: 1, stage_since: '2026-10-01', plant: 'B' }), die({ order_id: 2, stage_since: '2026-10-20', plant: 'A' })];
  assert.deepEqual(sortDies(dies, 'newest').map(d => d.order_id), [2, 1]);
  assert.deepEqual(sortDies(dies, 'plant').map(d => d.order_id), [2, 1]);
});

test('late band comes first on stages that can be late; empty bands are dropped', () => {
  const rows = [die({ order_id: 1, late: true }), die({ order_id: 2 })];
  assert.deepEqual(bandsFor('model_received', rows).map(b => [b.key, b.rows.length]), [['late', 1], ['open', 1]]);
  assert.deepEqual(bandsFor('prep_done', [die()]).map(b => b.key), ['open']);
});

test('awaiting and in-house stages show one waiting band', () => {
  assert.deepEqual(bandsFor('awaiting_model', [die({ stage: 'awaiting_model' })]).map(b => b.key), ['waiting']);
  assert.deepEqual(bandsFor('in_house_mod', []).length, 0);
});

test('stage summary counts dies and late dies per stage', () => {
  const s = stageSummary([die({ late: true }), die(), die({ stage: 'awaiting_model' })]);
  assert.deepEqual(s.model_received, { count: 2, late: 1 });
  assert.deepEqual(s.awaiting_model, { count: 1, late: 0 });
  assert.deepEqual(s.in_house_mod, { count: 0, late: 0 });
});

test('model to result averages the last 90 days and the 90 before', () => {
  const dies = [die({ rounds: [done('2026-10-20', 1), done('2026-10-01', 3), done('2026-06-01', 4), done(null, null)] })];
  assert.deepEqual(modelToResult(dies, TODAY), { current: 2, previous: 4 });
  assert.deepEqual(modelToResult([die()], TODAY), { current: null, previous: null });
});

test('top reason picks the most frequent Not OK reason of the last 90 days', () => {
  const notOk = (date, reason) => done(date, 1, { result: 'Not OK', fail_reason: reason });
  const dies = [die({ rounds: [notOk('2026-10-20', 'Weld seam quality'), notOk('2026-10-18', 'Weld seam quality'),
    notOk('2026-10-10', 'Other'), notOk('2026-01-01', 'Other'), done('2026-10-19', 1)] })];
  assert.deepEqual(topReason(dies, TODAY), { reason: 'Weld seam quality', count: 2, total: 3 });
  assert.equal(topReason([die()], TODAY), null);
});
