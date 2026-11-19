'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plans = require('./trialPlans.cjs');

const TODAY = '2026-11-18';
const TOMORROW = '2026-11-19';

// The plan from the sheet this feature replaces (19/11/2026): eight trials and
// two supervised day-shift runs across four presses.
const entry = (press, die_no, tooling, corrector, over = {}) => ({
  entry_type: 'Trial', urgent: false, outcome: null, fail_reason: null, out_of_queue_reason: null,
  press, die_no, tooling, corrector, ...over,
});
const SHEET = [
  entry('Press 2', '29466-210', 'b-2-5-a', 'singh'),
  entry('Press 4', '32140-401', 'i-15781', 'erive', { urgent: true }),
  entry('Press 4', '32128-401', 'i-23436', 'jerome', { urgent: true }),
  entry('Press 5', '06177-502', 'i-17534', 'washanta', { entry_type: 'Supervised' }),
  entry('Press 5', '06262-501', 'i-06010', 'washanta', { urgent: true }),
  entry('Press 5', '26961-501', 'i-23436', 'erive', { entry_type: 'Supervised' }),
  entry('Press 6', '30755-601', 'i-30755', 'washanta', { urgent: true }),
  entry('Press 6', '30390-603', 'i-15840', 'washanta', { urgent: true }),
  entry('Press 6', '30751-601', 'I-30751', 'parvej', { urgent: true }),
  entry('Press 6', '30752-601', 'I-28239', 'parvej', { urgent: true }),
];

test('the vocabulary is exactly the agreed strings, in order', () => {
  assert.deepEqual(plans.ENTRY_TYPES, ['Trial', 'Supervised']);
  assert.deepEqual(plans.OUTCOMES, ['OK', 'Not OK', 'Not run']);
});

test('the page opens on the next day, across a month and a year end', () => {
  assert.equal(plans.defaultPlanDate(TODAY), TOMORROW);
  assert.equal(plans.defaultPlanDate('2026-11-30'), '2026-12-01');
  assert.equal(plans.defaultPlanDate('2026-12-31'), '2027-01-01');
  assert.equal(plans.defaultPlanDate('2028-02-28'), '2028-02-29');
});

test('a plan date must be a real calendar day', () => {
  assert.equal(plans.isPlanDate('2026-11-19'), true);
  assert.equal(plans.isPlanDate('2026-02-31'), false);
  assert.equal(plans.isPlanDate('19/11/2026'), false);
  assert.equal(plans.isPlanDate(''), false);
  assert.equal(plans.isPlanDate(undefined), false);
});

test('a future plan can be edited but takes no results yet', () => {
  assert.deepEqual(plans.planState(TOMORROW, TODAY), { planEditable: true, resultsOpen: false, locked: false });
});

test("today's plan can be edited and takes results", () => {
  assert.deepEqual(plans.planState(TODAY, TODAY), { planEditable: true, resultsOpen: true, locked: false });
});

test("yesterday's plan is closed to edits but still takes results", () => {
  assert.deepEqual(plans.planState('2026-11-17', TODAY), { planEditable: false, resultsOpen: true, locked: false });
});

test('an older plan is locked, except that an admin can still correct results', () => {
  assert.deepEqual(plans.planState('2026-11-16', TODAY), { planEditable: false, resultsOpen: false, locked: true });
  assert.deepEqual(plans.planState('2026-11-16', TODAY, { isAdmin: true }), { planEditable: false, resultsOpen: true, locked: false });
});

test('an admin cannot record a result before the day of the plan either', () => {
  assert.equal(plans.planState(TOMORROW, TODAY, { isAdmin: true }).resultsOpen, false);
});

test('an entry needs a die number and defaults to a trial', () => {
  assert.equal(plans.validateEntry({}).ok, false);
  assert.equal(plans.validateEntry({ die_no: '   ' }).ok, false);
  const r = plans.validateEntry({ die_no: ' 32140-401 ', press: 'Press 4', customer: ' ACME ' });
  assert.equal(r.ok, true);
  assert.equal(r.value.die_no, '32140-401');
  assert.equal(r.value.entry_type, 'Trial');
  assert.equal(r.value.customer, 'ACME');
  assert.equal(r.value.urgent, false);
  assert.equal(r.value.alloy, null);
});

test('an entry type outside the list is rejected', () => {
  assert.equal(plans.validateEntry({ die_no: '1', entry_type: 'Production' }).ok, false);
});

test('an entry cannot point at two die records, but may point at none', () => {
  assert.equal(plans.validateEntry({ die_no: '1', die_order_id: 4, sample_followup_id: 9 }).ok, false);
  const none = plans.validateEntry({ die_no: '1' });
  assert.equal(none.value.die_order_id, null);
  assert.equal(none.value.sample_followup_id, null);
});

test('an out-of-queue reason must come from the list', () => {
  assert.equal(plans.validateEntry({ die_no: '1', out_of_queue_reason: 'Because' }).ok, false);
  for (const reason of plans.OUT_OF_QUEUE_REASONS) {
    assert.equal(plans.validateEntry({ die_no: '1', out_of_queue_reason: reason }).value.out_of_queue_reason, reason);
  }
});

test('an edit cannot turn an entry into a different die', () => {
  const r = plans.validateEntry({ die_no: '99999-999', press: 'Press 6' }, { fixedDieNo: '32140-401' });
  assert.equal(r.value.die_no, '32140-401');
});

test('an over-long field is rejected rather than cut', () => {
  assert.equal(plans.validateEntry({ die_no: '1', press: 'x'.repeat(41) }).ok, false);
});

test('a failed trial needs one of the fixed reasons', () => {
  assert.equal(plans.validateOutcome({ outcome: 'Not OK' }, 'Trial').ok, false);
  assert.equal(plans.validateOutcome({ outcome: 'Not OK', fail_reason: 'Gremlins' }, 'Trial').ok, false);
  const r = plans.validateOutcome({ outcome: 'Not OK', fail_reason: 'Shape' }, 'Trial');
  assert.equal(r.value.fail_reason, 'Shape');
});

test('a passed or not-run trial drops any reason it carries', () => {
  assert.equal(plans.validateOutcome({ outcome: 'OK', fail_reason: 'Shape' }, 'Trial').value.fail_reason, null);
  assert.equal(plans.validateOutcome({ outcome: 'Not run', fail_reason: 'Shape' }, 'Trial').value.fail_reason, null);
});

test('a supervised run that went wrong needs a comment, not a trial reason', () => {
  assert.equal(plans.validateOutcome({ outcome: 'Not OK' }, 'Supervised').ok, false);
  const r = plans.validateOutcome({ outcome: 'Not OK', comments: 'Surface lines after 20 billets' }, 'Supervised');
  assert.equal(r.ok, true);
  assert.equal(r.value.fail_reason, null);
});

test('an outcome outside the list is rejected', () => {
  assert.equal(plans.validateOutcome({ outcome: 'Normal' }, 'Trial').ok, false);
  assert.equal(plans.validateOutcome({}, 'Trial').ok, false);
});

test("the sheet's plan summarises to 8 trials and 2 supervised runs, 1 / 2 / 1 / 4 by press", () => {
  const s = plans.summarise(SHEET);
  assert.equal(s.trials.planned, 8);
  assert.equal(s.supervised.planned, 2);
  assert.equal(s.urgent, 7);
  assert.deepEqual(s.byPress.map(p => [p.press, p.planned, p.supervised]), [
    ['Press 2', 1, 0], ['Press 4', 2, 0], ['Press 5', 1, 2], ['Press 6', 4, 0],
  ]);
});

test('before anything has run the run ratio is 0 and the fail ratio is null, not 0', () => {
  const s = plans.summarise(SHEET);
  assert.equal(s.trials.done, 0);
  assert.equal(s.trials.awaiting, 8);
  assert.equal(s.trials.runRatio, 0);
  assert.equal(s.trials.failRatio, null);
  assert.equal(plans.summarise([]).trials.runRatio, null);
});

test('run ratio is done over planned and fail ratio is not OK over done', () => {
  const day = SHEET.map(e => ({ ...e }));
  day[0].outcome = 'OK';
  day[1].outcome = 'Not OK'; day[1].fail_reason = 'Shape';
  day[2].outcome = 'Not OK'; day[2].fail_reason = 'Shape';
  day[4].outcome = 'Not run';
  day[6].outcome = 'Not OK'; day[6].fail_reason = 'Die Choked';
  day[3].outcome = 'OK'; // supervised: must not move the trial figures
  const s = plans.summarise(day);
  assert.equal(s.trials.done, 4);
  assert.equal(s.trials.ok, 1);
  assert.equal(s.trials.notOk, 3);
  assert.equal(s.trials.notRun, 1);
  assert.equal(s.trials.awaiting, 3);
  assert.equal(s.trials.runRatio, 50);
  assert.equal(s.trials.failRatio, 75);
  assert.equal(s.supervised.ok, 1);
  assert.deepEqual(s.failReasons, [{ reason: 'Shape', count: 2 }, { reason: 'Die Choked', count: 1 }]);
});

test('out-of-queue dies are counted on their own line', () => {
  const s = plans.summarise([...SHEET, entry('Press 6', '11111-601', 'i-1', 'singh', { out_of_queue_reason: 'Customer feedback' })]);
  assert.equal(s.outOfQueue, 1);
  assert.equal(s.trials.planned, 9);
});

test("the sheet's plan raises its two checks: one insert on two presses, one corrector on four dies", () => {
  const checks = plans.findChecks(SHEET);
  assert.deepEqual(checks.filter(c => c.kind === 'tooling'), [
    { kind: 'tooling', tooling: 'i-23436', presses: ['Press 4', 'Press 5'], dies: ['32128-401', '26961-501'] },
  ]);
  assert.deepEqual(checks.filter(c => c.kind === 'corrector'), [
    { kind: 'corrector', corrector: 'washanta', count: 4 },
  ]);
});

test('the same tooling twice on one press is not a clash, and case does not hide one', () => {
  assert.deepEqual(plans.findChecks([
    entry('Press 6', 'a', 'i-1', 'x'), entry('Press 6', 'b', 'i-1', 'y'),
  ]), []);
  assert.equal(plans.findChecks([
    entry('Press 4', 'a', 'I-30751', 'x'), entry('Press 6', 'b', 'i-30751', 'y'),
  ]).length, 1);
});

// --- queries, against a scripted client -----------------------------------

function fakeClient(script) {
  const log = [];
  return {
    log,
    has: (prefix) => log.some(({ q }) => q.startsWith(prefix)),
    query: async (sql, params = []) => {
      const q = sql.trim().replace(/\s+/g, ' ');
      log.push({ q, params });
      for (const [pattern, answer] of script) {
        if (pattern.test(q)) return typeof answer === 'function' ? answer(params, q) : answer;
      }
      throw new Error(`trial plan test: unexpected query ${q}`);
    },
  };
}

const PLAN_ROW = { id: 7, plan_date: TODAY, status: 'published', revision: 1 };
const dbEntry = (over = {}) => ({
  id: 31, plan_id: 7, entry_type: 'Trial', die_no: '32140-401', die_order_id: 12, sample_followup_id: null,
  outcome: null, sample_trial_id: null, plan_date: TODAY, plan_status: 'published', ...over,
});
const USER = { id: 5, role: 'user' };

test('adding to a past day is refused before anything is written', async () => {
  const client = fakeClient([]);
  const out = await plans.addEntry(client, '2026-11-17', 'GEX 1', { die_no: '1' }, 5, TODAY);
  assert.equal(out.status, 409);
  assert.equal(client.log.length, 0);
});

test('the first die added to a day creates the draft and takes position 1', async () => {
  const client = fakeClient([
    [/^WITH d AS/, { rows: [] }],
    [/^INSERT INTO trial_plans/, { rows: [{ id: 7, plan_date: TOMORROW, status: 'draft' }] }],
    [/^SELECT COALESCE\(MAX\(position\)/, { rows: [{ position: 0 }] }],
    [/^INSERT INTO trial_plan_entries/, (params) => ({ rows: [{ id: 31, position: params[1], die_no: params[6] }] })],
  ]);
  const out = await plans.addEntry(client, TOMORROW, 'GEX 1', { die_no: '32140-401', press: 'Press 4' }, 5, TODAY);
  assert.equal(out.ok, true);
  assert.deepEqual(out.row, { id: 31, position: 1, die_no: '32140-401' });
});

test('the same die twice on one day is a 409 that names the die', async () => {
  const client = fakeClient([
    [/^WITH d AS/, { rows: [] }],
    [/^INSERT INTO trial_plans/, { rows: [{ id: 7 }] }],
    [/^SELECT COALESCE\(MAX\(position\)/, { rows: [{ position: 3 }] }],
    [/^INSERT INTO trial_plan_entries/, () => { throw Object.assign(new Error('dup'), { code: '23505' }); }],
  ]);
  const out = await plans.addEntry(client, TOMORROW, 'GEX 1', { die_no: '32140-401' }, 5, TODAY);
  assert.equal(out.status, 409);
  assert.match(out.error, /32140-401/);
});

test('an entry with a result cannot be removed from the plan', async () => {
  const client = fakeClient([[/^SELECT e\.id/, { rows: [dbEntry({ outcome: 'OK' })] }]]);
  const out = await plans.removeEntry(client, 31, TODAY);
  assert.equal(out.status, 409);
  assert.ok(!client.has('DELETE'));
});

test('an empty plan cannot be published', async () => {
  const client = fakeClient([[/^SELECT id, plan_date/, { rows: [] }]]);
  const out = await plans.publishPlan(client, TOMORROW, 'GEX 1', 5, TODAY);
  assert.equal(out.status, 400);
  assert.ok(!client.has('UPDATE'));
});

test('results are refused on a draft plan and before the day of the plan', async () => {
  const draft = fakeClient([[/^SELECT e\.id/, { rows: [dbEntry({ plan_status: 'draft' })] }]]);
  assert.equal((await plans.recordOutcome(draft, 31, { outcome: 'OK' }, USER, TODAY)).status, 409);
  const future = fakeClient([[/^SELECT e\.id/, { rows: [dbEntry({ plan_date: TOMORROW })] }]]);
  assert.equal((await plans.recordOutcome(future, 31, { outcome: 'OK' }, USER, TODAY)).status, 409);
});

test('a closed plan refuses a user and lets an admin through', async () => {
  const script = () => [
    [/^SELECT e\.id/, { rows: [dbEntry({ plan_date: '2026-11-10', die_order_id: null })] }],
    [/^UPDATE trial_plan_entries/, { rows: [{ id: 31, outcome: 'Not run' }] }],
  ];
  assert.equal((await plans.recordOutcome(fakeClient(script()), 31, { outcome: 'Not run' }, USER, TODAY)).status, 409);
  assert.equal((await plans.recordOutcome(fakeClient(script()), 31, { outcome: 'Not run' }, { id: 1, role: 'admin' }, TODAY)).ok, true);
});

test("a Not OK trial is written to the die's trial log, dated the plan day, and linked back", async () => {
  const client = fakeClient([
    [/^SELECT e\.id/, { rows: [dbEntry()] }],
    [/^SELECT design_enhancement FROM die_orders/, { rows: [{ design_enhancement: 0 }] }],
    [/FROM sample_trials WHERE die_order_id = \$1 ORDER BY trial_no/, { rows: [{ trial_no: 1 }] }],
    [/^INSERT INTO sample_trials \(die_order_id/, (params) => ({ rows: [{ id: 88, trial_no: params[1] }] })],
    [/^UPDATE trial_plan_entries/, (params) => ({ rows: [{ id: 31, outcome: params[0], sample_trial_id: params[3] }] })],
  ]);
  const out = await plans.recordOutcome(client, 31, { outcome: 'Not OK', fail_reason: 'Shape', comments: 'Wall thin' }, USER, TODAY);
  assert.equal(out.ok, true);
  assert.deepEqual(out.row, { id: 31, outcome: 'Not OK', sample_trial_id: 88 });
  const insert = client.log.find(({ q }) => q.startsWith('INSERT INTO sample_trials'));
  assert.deepEqual(insert.params.slice(0, 7), [12, 2, TODAY, 'Not OK', 'Shape', 'Wall thin', 5]);
});

test('Not run records the plan entry and leaves the trial log alone', async () => {
  const client = fakeClient([
    [/^SELECT e\.id/, { rows: [dbEntry()] }],
    [/^UPDATE trial_plan_entries/, (params) => ({ rows: [{ id: 31, outcome: params[0], sample_trial_id: params[3] }] })],
  ]);
  const out = await plans.recordOutcome(client, 31, { outcome: 'Not run' }, USER, TODAY);
  assert.deepEqual(out.row, { id: 31, outcome: 'Not run', sample_trial_id: null });
  assert.ok(!client.has('INSERT INTO sample_trials'));
});

test('a supervised run never writes the trial log', async () => {
  const client = fakeClient([
    [/^SELECT e\.id/, { rows: [dbEntry({ entry_type: 'Supervised' })] }],
    [/^UPDATE trial_plan_entries/, { rows: [{ id: 31, outcome: 'OK' }] }],
  ]);
  assert.equal((await plans.recordOutcome(client, 31, { outcome: 'OK' }, USER, TODAY)).ok, true);
  assert.ok(!client.has('INSERT INTO sample_trials'));
});

test('correcting a result updates the same trial instead of adding a second', async () => {
  const client = fakeClient([
    [/^SELECT e\.id/, { rows: [dbEntry({ outcome: 'Not OK', sample_trial_id: 88 })] }],
    [/^SELECT die_order_id FROM sample_trials WHERE id = \$1/, { rows: [{ die_order_id: 12 }] }],
    [/^SELECT design_enhancement FROM die_orders/, { rows: [{ design_enhancement: 0 }] }],
    [/^UPDATE sample_trials/, { rows: [{ id: 88 }], rowCount: 1 }],
    [/^UPDATE trial_plan_entries/, (params) => ({ rows: [{ id: 31, outcome: params[0], sample_trial_id: params[3] }] })],
  ]);
  const out = await plans.recordOutcome(client, 31, { outcome: 'OK' }, USER, TODAY);
  assert.deepEqual(out.row, { id: 31, outcome: 'OK', sample_trial_id: 88 });
  assert.ok(!client.has('INSERT INTO sample_trials'));
});

test('a logged trial cannot be quietly turned into Not run', async () => {
  const client = fakeClient([[/^SELECT e\.id/, { rows: [dbEntry({ outcome: 'OK', sample_trial_id: 88 })] }]]);
  const out = await plans.recordOutcome(client, 31, { outcome: 'Not run' }, USER, TODAY);
  assert.equal(out.status, 409);
  assert.ok(!client.has('UPDATE'));
});

test('a range summary totals the range and gives one line per planned day', async () => {
  const client = fakeClient([[/^SELECT e\.id/, { rows: [
    { ...SHEET[0], plan_date: '2026-11-16', outcome: 'OK' },
    { ...SHEET[1], plan_date: '2026-11-16', outcome: 'Not OK', fail_reason: 'Shape' },
    { ...SHEET[2], plan_date: '2026-11-17', outcome: 'Not run' },
    { ...SHEET[3], plan_date: '2026-11-17', outcome: 'OK' },
  ] }]]);
  const out = await plans.rangeSummary(client, '2026-11-16', '2026-11-21');
  assert.equal(out.ok, true);
  assert.equal(out.summary.trials.planned, 3);
  assert.equal(out.summary.trials.runRatio, 67);
  assert.equal(out.summary.trials.failRatio, 50);
  assert.deepEqual(out.byDay.map(d => [d.date, d.planned, d.done, d.supervised]), [
    ['2026-11-16', 2, 2, 0], ['2026-11-17', 1, 0, 1],
  ]);
});

test('a summary range must be real, in order and not too long', async () => {
  const client = fakeClient([]);
  assert.equal((await plans.rangeSummary(client, 'x', '2026-11-21')).status, 400);
  assert.equal((await plans.rangeSummary(client, '2026-11-21', '2026-11-16')).status, 400);
  assert.equal((await plans.rangeSummary(client, '2026-01-01', '2026-11-16')).status, 400);
  assert.equal(client.log.length, 0);
});

test('the last alloy is the newest planned one, matching either die spelling', async () => {
  const client = fakeClient([[/^SELECT e\.alloy/, { rows: [{ alloy: '6063' }] }]]);
  assert.equal(await plans.lastAlloy(client, '32140_401'), '6063');
  assert.deepEqual(client.log[0].params, ['32140_401']);
  assert.match(client.log[0].q, /ORDER BY p\.plan_date DESC/);
  assert.equal(await plans.lastAlloy(fakeClient([]), '  '), null);
});

test('a blank customer is filled from the die list when the die is added', async () => {
  const client = fakeClient([
    [/^WITH d AS/, { rows: [{ customer: ' Gulf Extrusions ' }] }],
    [/^INSERT INTO trial_plans/, { rows: [{ id: 7 }] }],
    [/^SELECT COALESCE\(MAX\(position\)/, { rows: [{ position: 0 }] }],
    [/^INSERT INTO trial_plan_entries/, (params) => ({ rows: [{ id: 31, customer: params[9] }] })],
  ]);
  const out = await plans.addEntry(client, TOMORROW, 'GEX 1', { die_no: '12158_504' }, 5, TODAY);
  assert.equal(out.row.customer, 'Gulf Extrusions');
  assert.deepEqual(client.log[0].params, ['12158_504']);
  assert.match(client.log[0].q, /existing_die_details.*profile_number = d\.profile.*FROM profiles/);
});

test('a customer typed on the entry is kept, with no lookup', async () => {
  const client = fakeClient([
    [/^INSERT INTO trial_plans/, { rows: [{ id: 7 }] }],
    [/^SELECT COALESCE\(MAX\(position\)/, { rows: [{ position: 0 }] }],
    [/^INSERT INTO trial_plan_entries/, (params) => ({ rows: [{ id: 31, customer: params[9] }] })],
  ]);
  const out = await plans.addEntry(client, TOMORROW, 'GEX 1', { die_no: '12158-504', customer: 'Customer A' }, 5, TODAY);
  assert.equal(out.row.customer, 'Customer A');
  assert.ok(!client.has('WITH d AS'));
});

test('a plan shows the customer for entries saved without one, looking each die up once', async () => {
  const client = fakeClient([
    [/^SELECT .* FROM trial_plans WHERE plan_date/, { rows: [{ id: 7, plan_date: TOMORROW, status: 'draft' }] }],
    [/FROM trial_plan_entries WHERE plan_id/, { rows: [
      dbEntry({ id: 1, die_no: '12158-504', customer: null }),
      dbEntry({ id: 2, die_no: '12158-504', customer: '' }),
      dbEntry({ id: 3, die_no: '05428-501', customer: 'Kept' }),
    ] }],
    [/^WITH d AS/, { rows: [{ customer: 'Gulf Extrusions' }] }],
  ]);
  const view = await plans.planView(client, TOMORROW, 'GEX 1', TODAY);
  assert.deepEqual(view.entries.map(e => e.customer), ['Gulf Extrusions', 'Gulf Extrusions', 'Kept']);
  assert.equal(client.log.filter(({ q }) => q.startsWith('WITH d AS')).length, 1);
});
