'use strict';

// The daily trial plan: which dies go on which press tomorrow, and what
// happened to each of them.
//
// This replaces a spreadsheet that was rebuilt by hand every afternoon. The
// sheet could say what was planned, but once the day was over nothing tied a
// row on it to the trial that was actually run -- so "planned 8, done 5" was
// retyped, and why three did not run was not recorded anywhere.
//
// Two rules shape everything below:
//
//   1. An entry is a snapshot. Press, customer, alloy, tooling and corrector
//      are copied onto the entry when it is planned, so a plan from last month
//      still reads as it was published even after the die record has moved on.
//   2. The die's trial log (sample_trials) stays the one record of what
//      happened at the press. Recording OK or Not OK on a plan entry writes
//      that log through sampleTrials.cjs; the plan never keeps a second copy
//      of the rules for what a valid trial is.
//
// Pure rules first, queries after -- the same split as sampleTrials.cjs.

const sampleTrials = require('./sampleTrials.cjs');

const { FAIL_REASONS, ISO_DATE } = sampleTrials;

// Stored verbatim. Changing a string here is a data migration, not an edit.
// `Supervised` is a critical product that has to run in the day shift with
// somebody at the press: it shares the plan but is not a trial, so it never
// counts toward the trial totals or ratios.
const ENTRY_TYPES = ['Trial', 'Supervised'];
const OUTCOMES = ['OK', 'Not OK', 'Not run'];
const PLAN_STATUSES = ['draft', 'published'];

// Each plant plans its own presses and publishes its own schedule. Stored in
// the die-order spelling; the die list and press table write 'GEX 01', which
// plantName() reads as the same plant.
const PLANTS = ['GEX 1', 'GEX 2'];

// Why a die that is not waiting for trial is on the plan anyway. Required for
// such a die so the reason prints on the plan instead of living in memory.
const OUT_OF_QUEUE_REASONS = [
  'Re-trial after correction',
  'Customer feedback',
  'Design enhancement',
  'Other',
];

// Why a planned die did not run. Required on every Not run, so the summary can
// say why trials were missed; Other needs the comment to say what happened.
// Stored verbatim.
const NOT_RUN_REASONS = [
  'Alloy shortage',
  'Press breakdown',
  'Die not ready',
  'Production priority / no time',
  'Other',
];

// A supervisor may still be entering yesterday's results the next morning.
// After this many days past the plan date only an admin can.
const RESULT_GRACE_DAYS = 1;

// At or above this many dies for one corrector the plan flags it. A prompt to
// look, not a limit: the plan can still be published.
const CORRECTOR_LOAD_FLAG = 4;

const trim = (v) => (v === null || v === undefined ? '' : String(v).trim());

// 'GEX 01', 'gex1' and 'GEX 1' are one plant. Anything that is not a known
// plant is null, so a typo cannot open a third plan for the day.
function plantName(value) {
  const digits = trim(value).match(/(\d+)/);
  if (!digits) return null;
  const name = `GEX ${Number(digits[1])}`;
  return PLANTS.includes(name) ? name : null;
}
const NO_PLANT = `Choose a plant: ${PLANTS.join(' or ')}`;

// Calendar arithmetic on 'YYYY-MM-DD' strings, anchored at UTC on both sides so
// the Dubai offset can never move the answer by a day.
function addDays(isoDay, days) {
  const [y, m, d] = isoDay.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const p2 = (n) => String(n).padStart(2, '0');
  return `${next.getUTCFullYear()}-${p2(next.getUTCMonth() + 1)}-${p2(next.getUTCDate())}`;
}

// A real calendar day, not just the right shape: 2026-02-31 is refused.
function isPlanDate(value) {
  const s = trim(value);
  return ISO_DATE.test(s) && addDays(s, 0) === s;
}

// The working week is Monday to Saturday: the day after a Saturday is Monday.
const isSunday = (isoDay) => {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0;
};
function nextWorkingDay(isoDay) {
  const next = addDays(isoDay, 1);
  return isSunday(next) ? addDays(next, 1) : next;
}

// Where a die that did not run is carried to: the next working day after its
// plan, or -- when the result is entered so late that day has passed -- the
// first working day from today, which is still open for planning.
function carryTarget(planDate, today) {
  const target = nextWorkingDay(planDate);
  if (target >= today) return target;
  return isSunday(today) ? addDays(today, 1) : today;
}

// The plan is built the day before it runs, so the page opens on tomorrow.
function defaultPlanDate(today) {
  return addDays(today, 1);
}

// What may still be changed on a plan, given what day it is.
//   planEditable -- entries can be added, changed, removed, re-published
//   resultsOpen  -- outcomes can be recorded
//   locked       -- neither: a past plan, view only
// ISO days compare correctly as strings.
function planState(planDate, today, { isAdmin = false } = {}) {
  const planEditable = planDate >= today;
  const started = planDate <= today;
  const withinGrace = today <= addDays(planDate, RESULT_GRACE_DAYS);
  const resultsOpen = started && (withinGrace || isAdmin);
  return { planEditable, resultsOpen, locked: !planEditable && !resultsOpen };
}

const TEXT_FIELDS = [
  ['plant', 40], ['press', 40], ['customer', 200], ['alloy', 40], ['tooling', 120], ['corrector', 120],
];

// One die on one day's plan. `fixedDieNo` is set on an edit: an entry cannot
// become a different die -- that is a remove and an add, so the history of the
// first die is not rewritten.
function validateEntry(input = {}, { fixedDieNo = null } = {}) {
  const die_no = fixedDieNo || trim(input.die_no);
  if (!die_no) return { ok: false, error: 'A die number is required' };
  if (die_no.length > 60) return { ok: false, error: 'Die number is too long' };

  const entry_type = trim(input.entry_type) || 'Trial';
  if (!ENTRY_TYPES.includes(entry_type)) {
    return { ok: false, error: `Type must be one of: ${ENTRY_TYPES.join(', ')}` };
  }

  // Same shape as sample_trials: a die record came through the order flow or
  // was added by hand, never both. Neither is allowed here -- an old production
  // die back from repair may have no record in this app at all.
  const die_order_id = Number(input.die_order_id) || null;
  const sample_followup_id = Number(input.sample_followup_id) || null;
  if (die_order_id && sample_followup_id) {
    return { ok: false, error: 'An entry can belong to only one die record' };
  }

  const out_of_queue_reason = trim(input.out_of_queue_reason) || null;
  if (out_of_queue_reason && !OUT_OF_QUEUE_REASONS.includes(out_of_queue_reason)) {
    return { ok: false, error: `Reason must be one of: ${OUT_OF_QUEUE_REASONS.join(', ')}` };
  }

  const value = {
    die_no, entry_type, die_order_id, sample_followup_id, out_of_queue_reason,
    urgent: input.urgent === true || input.urgent === 'true' || input.urgent === 1,
  };
  for (const [key, max] of TEXT_FIELDS) {
    const text = trim(input[key]);
    if (text.length > max) return { ok: false, error: `${key} is too long` };
    value[key] = text || null;
  }
  return { ok: true, value };
}

// What happened to a planned die. A failed trial needs one of the fixed
// reasons, exactly as it does in the trial log. A supervised run has no reason
// list -- it is a production run, not a trial -- so a problem on one has to be
// described in words instead.
function validateOutcome(input = {}, entryType = 'Trial') {
  const outcome = trim(input.outcome);
  if (!OUTCOMES.includes(outcome)) {
    return { ok: false, error: `Result must be one of: ${OUTCOMES.join(', ')}` };
  }
  const comments = trim(input.comments).slice(0, 2000) || null;

  let not_run_reason = null;
  if (outcome === 'Not run') {
    not_run_reason = trim(input.not_run_reason);
    if (!not_run_reason) return { ok: false, error: 'Choose why the die did not run' };
    if (!NOT_RUN_REASONS.includes(not_run_reason)) {
      return { ok: false, error: `Not run reason must be one of: ${NOT_RUN_REASONS.join(', ')}` };
    }
    if (not_run_reason === 'Other' && !comments) {
      return { ok: false, error: 'Describe why the die did not run' };
    }
  }

  let fail_reason = null;
  if (outcome === 'Not OK') {
    if (entryType === 'Trial') {
      fail_reason = trim(input.fail_reason);
      if (!fail_reason) return { ok: false, error: 'A reason is required when the result is Not OK' };
      if (!FAIL_REASONS.includes(fail_reason)) {
        return { ok: false, error: `Reason must be one of: ${FAIL_REASONS.join(', ')}` };
      }
    } else if (!comments) {
      return { ok: false, error: 'Describe what went wrong on the supervised run' };
    }
  }
  return { ok: true, value: { outcome, fail_reason, not_run_reason, comments } };
}

// A whole-number percentage, or null when there is nothing to divide by. Null
// is not zero: a day with no trials run has no fail ratio, not a perfect one.
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : null);

const emptyCounts = () => ({ planned: 0, done: 0, ok: 0, notOk: 0, notRun: 0, awaiting: 0 });

function count(into, outcome) {
  into.planned += 1;
  if (outcome === 'OK') { into.done += 1; into.ok += 1; }
  else if (outcome === 'Not OK') { into.done += 1; into.notOk += 1; }
  else if (outcome === 'Not run') into.notRun += 1;
  else into.awaiting += 1;
}

const withRatios = (c) => ({ ...c, runRatio: pct(c.done, c.planned), failRatio: pct(c.notOk, c.done) });

// The figures the sheet's "Summary of trial" block carried, computed instead of
// typed. Only Trial entries feed the trial numbers; supervised runs are counted
// beside them.
function summarise(entries = []) {
  const trials = emptyCounts();
  const supervised = emptyCounts();
  const byPress = new Map();
  const failReasons = new Map();
  const notRunReasons = new Map();
  let urgent = 0;
  let outOfQueue = 0;

  for (const entry of entries) {
    const isTrial = entry.entry_type !== 'Supervised';
    const press = trim(entry.press) || 'No press';
    if (!byPress.has(press)) byPress.set(press, { press, trials: emptyCounts(), supervised: 0 });
    const group = byPress.get(press);

    if (isTrial) {
      count(trials, entry.outcome);
      count(group.trials, entry.outcome);
      if (entry.urgent) urgent += 1;
      if (entry.out_of_queue_reason) outOfQueue += 1;
      if (entry.outcome === 'Not OK' && entry.fail_reason) {
        failReasons.set(entry.fail_reason, (failReasons.get(entry.fail_reason) || 0) + 1);
      }
      if (entry.outcome === 'Not run' && entry.not_run_reason) {
        notRunReasons.set(entry.not_run_reason, (notRunReasons.get(entry.not_run_reason) || 0) + 1);
      }
    } else {
      count(supervised, entry.outcome);
      group.supervised += 1;
    }
  }

  return {
    trials: withRatios(trials),
    supervised,
    urgent,
    outOfQueue,
    byPress: [...byPress.values()]
      .sort((a, b) => a.press.localeCompare(b.press, undefined, { numeric: true }))
      .map(g => ({ press: g.press, supervised: g.supervised, ...withRatios(g.trials) })),
    // In the fixed vocabulary's order, so the list does not reshuffle week to week.
    failReasons: FAIL_REASONS
      .filter(reason => failReasons.has(reason))
      .map(reason => ({ reason, count: failReasons.get(reason) })),
    notRunReasons: NOT_RUN_REASONS
      .filter(reason => notRunReasons.has(reason))
      .map(reason => ({ reason, count: notRunReasons.get(reason) })),
  };
}

// Things worth a second look before publishing. Neither blocks the plan: the
// same insert on two presses is fine when the dies run one after the other,
// and only the planner knows that.
function findChecks(entries = []) {
  const checks = [];

  const byTooling = new Map();
  for (const entry of entries) {
    const key = trim(entry.tooling).toLowerCase();
    if (!key) continue;
    if (!byTooling.has(key)) byTooling.set(key, { tooling: trim(entry.tooling), presses: new Set(), dies: [] });
    const group = byTooling.get(key);
    group.presses.add(trim(entry.press) || 'No press');
    group.dies.push(entry.die_no);
  }
  for (const group of byTooling.values()) {
    if (group.presses.size > 1) {
      checks.push({ kind: 'tooling', tooling: group.tooling, presses: [...group.presses].sort(), dies: group.dies });
    }
  }

  const byCorrector = new Map();
  for (const entry of entries) {
    const name = trim(entry.corrector);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byCorrector.has(key)) byCorrector.set(key, { corrector: name, count: 0 });
    byCorrector.get(key).count += 1;
  }
  for (const group of byCorrector.values()) {
    if (group.count >= CORRECTOR_LOAD_FLAG) checks.push({ kind: 'corrector', ...group });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const PLAN_COLS = 'id, plan_date, plant, status, revision, published_at, published_by, created_by, created_at, updated_at';

const ENTRY_COLS = [
  'id', 'plan_id', 'position', 'entry_type', 'urgent', 'die_order_id', 'sample_followup_id',
  'die_no', 'plant', 'press', 'customer', 'alloy', 'tooling', 'corrector', 'out_of_queue_reason',
  'outcome', 'fail_reason', 'not_run_reason', 'comments', 'sample_trial_id', 'result_by', 'result_at',
  'carried_from_entry_id', 'carried_from_date', 'carry_reason', 'carry_added',
  'created_by', 'created_at', 'updated_at',
];
const ENTRY_SELECT = ENTRY_COLS.join(', ');
const ENTRY_SELECT_E = ENTRY_COLS.map(c => `e.${c}`).join(', ');

const refuse = (status, error) => ({ ok: false, status, error });
const PAST_PLAN = 'A past plan cannot be changed';

async function findPlan(client, date, plant) {
  const { rows } = await client.query(
    `SELECT ${PLAN_COLS} FROM trial_plans WHERE plan_date = $1 AND plant = $2`,
    [date, plant]
  );
  return rows[0] || null;
}

async function entriesOf(client, planId) {
  const { rows } = await client.query(
    `SELECT ${ENTRY_SELECT} FROM trial_plan_entries WHERE plan_id = $1 ORDER BY position ASC, id ASC`,
    [planId]
  );
  return rows;
}

// Everything the page needs for one day. A day nobody has planned yet is not an
// error: it comes back with no plan and no entries, ready to be built.
async function planView(client, date, plantInput, today, { isAdmin = false } = {}) {
  const plant = plantName(plantInput);
  if (!plant) return refuse(400, NO_PLANT);
  const plan = await findPlan(client, date, plant);
  const entries = plan ? await withCustomers(client, await entriesOf(client, plan.id)) : [];
  // Carry-overs that arrived after the plan went out: the copy people hold is
  // out of date until someone publishes again.
  const publishedAt = plan?.status === 'published' && plan.published_at ? new Date(plan.published_at) : null;
  const carriedAfterPublish = publishedAt
    ? entries.filter(e => e.carried_from_entry_id && new Date(e.updated_at) > publishedAt).length
    : 0;
  return {
    ok: true,
    date,
    plant,
    plan,
    carriedAfterPublish,
    entries,
    summary: summarise(entries),
    checks: findChecks(entries),
    state: planState(date, today, { isAdmin }),
  };
}

// The first die added to a day creates that day's draft. The no-op update is
// what makes RETURNING hand back the existing row when two people add the first
// die at the same moment.
async function ensurePlan(client, date, plant, userId) {
  const { rows } = await client.query(
    `INSERT INTO trial_plans (plan_date, plant, created_by) VALUES ($1, $2, $3)
     ON CONFLICT (plan_date, plant) DO UPDATE SET plan_date = EXCLUDED.plan_date
     RETURNING ${PLAN_COLS}`,
    [date, plant, userId]
  );
  return rows[0];
}

async function addEntry(client, date, plantInput, input, userId, today) {
  const plant = plantName(plantInput);
  if (!plant) return refuse(400, NO_PLANT);
  if (!planState(date, today).planEditable) return refuse(409, PAST_PLAN);
  const check = validateEntry(input);
  if (!check.ok) return refuse(400, check.error);
  const v = check.value;
  if (!v.customer) v.customer = await customerFor(client, v.die_no);

  const plan = await ensurePlan(client, date, plant, userId);
  const last = await client.query(
    'SELECT COALESCE(MAX(position), 0) AS position FROM trial_plan_entries WHERE plan_id = $1',
    [plan.id]
  );
  try {
    const { rows } = await client.query(
      `INSERT INTO trial_plan_entries
         (plan_id, position, entry_type, urgent, die_order_id, sample_followup_id,
          die_no, plant, press, customer, alloy, tooling, corrector, out_of_queue_reason, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING ${ENTRY_SELECT}`,
      [plan.id, Number(last.rows[0].position) + 1, v.entry_type, v.urgent, v.die_order_id, v.sample_followup_id,
        v.die_no, v.plant, v.press, v.customer, v.alloy, v.tooling, v.corrector, v.out_of_queue_reason, userId]
    );
    return { ok: true, row: rows[0] };
  } catch (error) {
    // 23505: the die is already on this day's plan. 23503: the die record the
    // entry points at does not exist.
    if (error.code === '23505') return refuse(409, `${v.die_no} is already on the plan for this day`);
    if (error.code === '23503') return refuse(400, 'Die record not found');
    throw error;
  }
}

// An entry with the day it belongs to, which every write needs to decide
// whether the plan can still be touched.
async function findEntry(client, id, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${ENTRY_SELECT_E}, p.plan_date, p.plant AS plan_plant, p.status AS plan_status
       FROM trial_plan_entries e JOIN trial_plans p ON p.id = e.plan_id
      WHERE e.id = $1${lock ? ' FOR UPDATE OF e' : ''}`,
    [id]
  );
  return rows[0] || null;
}

// The die and its record are not editable: see validateEntry.
async function updateEntry(client, id, input, today) {
  const entry = await findEntry(client, id);
  if (!entry) return refuse(404, 'Plan entry not found');
  if (!planState(entry.plan_date, today).planEditable) return refuse(409, PAST_PLAN);

  const check = validateEntry(
    { ...input, die_order_id: entry.die_order_id, sample_followup_id: entry.sample_followup_id },
    { fixedDieNo: entry.die_no }
  );
  if (!check.ok) return refuse(400, check.error);
  const v = check.value;

  const { rows } = await client.query(
    `UPDATE trial_plan_entries
        SET entry_type = $1, urgent = $2, plant = $3, press = $4, customer = $5, alloy = $6,
            tooling = $7, corrector = $8, out_of_queue_reason = $9, updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING ${ENTRY_SELECT}`,
    [v.entry_type, v.urgent, v.plant, v.press, v.customer, v.alloy, v.tooling, v.corrector, v.out_of_queue_reason, id]
  );
  return { ok: true, row: rows[0] };
}

// Once a result is on it, an entry is a record of something that happened and
// stays. A die that was planned and did not run is marked Not run, not removed.
async function removeEntry(client, id, today) {
  const entry = await findEntry(client, id);
  if (!entry) return refuse(404, 'Plan entry not found');
  if (!planState(entry.plan_date, today).planEditable) return refuse(409, PAST_PLAN);
  if (entry.outcome) return refuse(409, 'This die already has a result and cannot be removed from the plan');
  await client.query('DELETE FROM trial_plan_entries WHERE id = $1', [id]);
  return { ok: true };
}

// Publishing again after a change is allowed and bumps the revision, so the
// copy that went out can be told apart from the one that replaced it.
async function publishPlan(client, date, plantInput, userId, today) {
  const plant = plantName(plantInput);
  if (!plant) return refuse(400, NO_PLANT);
  if (!planState(date, today).planEditable) return refuse(409, PAST_PLAN);
  const plan = await findPlan(client, date, plant);
  const entries = plan ? await entriesOf(client, plan.id) : [];
  if (!entries.length) return refuse(400, 'Add at least one die before publishing the plan');

  const { rows } = await client.query(
    `UPDATE trial_plans
        SET status = 'published', revision = revision + 1,
            published_at = CURRENT_TIMESTAMP, published_by = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING ${PLAN_COLS}`,
    [userId, plan.id]
  );
  return { ok: true, plan: rows[0], entries };
}

// Record, or correct, what happened to a planned die. Run inside a transaction:
// the plan entry and the die's trial log must change together or not at all.
async function recordOutcome(client, id, input, user, today) {
  const entry = await findEntry(client, id, { lock: true });
  if (!entry) return refuse(404, 'Plan entry not found');

  const planDate = entry.plan_date;
  if (planDate > today) return refuse(409, 'A result cannot be recorded before the day of the plan');
  if (entry.plan_status !== 'published') return refuse(409, 'Publish the plan before recording results');
  if (!planState(planDate, today, { isAdmin: user.role === 'admin' }).resultsOpen) {
    return refuse(409, 'This plan is closed. Only an admin can change its results');
  }

  const check = validateOutcome(input, entry.entry_type);
  if (!check.ok) return refuse(400, check.error);
  const { outcome, fail_reason, not_run_reason, comments } = check.value;

  // The trial log is written only for a trial on a die this app has a record
  // of, and only when the trial actually ran. Not run is a fact about the plan,
  // not a trial.
  const parent = sampleTrials.parentRef(entry);
  const ran = outcome !== 'Not run';
  let sampleTrialId = entry.sample_trial_id;

  if (entry.entry_type === 'Trial' && parent) {
    const trialInput = {
      [parent.column]: parent.id,
      trial_date: planDate,
      result: outcome,
      fail_reason,
      comments,
      productivity_kgh: input.productivity_kgh,
      recovery_pct: input.recovery_pct,
    };
    if (sampleTrialId && !ran) {
      // Taking a trial back out of the log is a delete, and deleting a trial is
      // admin-only on its own route. Doing it here as a side effect of a
      // dropdown would walk around that rule.
      return refuse(409, "This result is already in the die's trial log. An admin must delete that trial before it can be marked Not run");
    }
    if (sampleTrialId) {
      const out = await sampleTrials.updateTrial(client, sampleTrialId, trialInput, today);
      if (!out.ok) return refuse(out.status, out.error);
    } else if (ran) {
      const out = await sampleTrials.createTrial(client, trialInput, user.id, today);
      if (!out.ok) return refuse(out.status, out.error);
      sampleTrialId = out.row.id;
    }
  }

  const { rows } = await client.query(
    `UPDATE trial_plan_entries
        SET outcome = $1, fail_reason = $2, not_run_reason = $3, comments = $4, sample_trial_id = $5,
            result_by = $6, result_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING ${ENTRY_SELECT}`,
    [outcome, fail_reason, not_run_reason, comments, sampleTrialId, user.id, id]
  );

  // A die that did not run goes onto the next working day's plan, urgent. A
  // corrected result takes it back off, unless that line has a result of its own.
  let carry = null;
  if (outcome === 'Not run') {
    const reason = not_run_reason === 'Other' ? comments : not_run_reason;
    carry = await carryOver(client, { ...entry, plant_of_plan: entry.plan_plant }, reason, user.id, today);
  } else if (entry.outcome === 'Not run') {
    carry = await undoCarry(client, entry.id);
  }
  return { ok: true, row: rows[0], carry };
}

const CARRY_COPY = ['entry_type', 'die_order_id', 'sample_followup_id', 'die_no', 'plant', 'press',
  'customer', 'alloy', 'tooling', 'corrector'];

// Puts a die that did not run onto the next working day's plan for the same
// plant, marked urgent and tagged with the day and reason it came from. If the
// die is already on that plan, that line is tagged instead of adding a second.
async function carryOver(client, entry, reason, userId, today) {
  const target = carryTarget(entry.plan_date, today);
  const plan = await ensurePlan(client, target, entry.plant_of_plan, userId);
  const { rows: found } = await client.query(
    `SELECT id, outcome FROM trial_plan_entries
      WHERE plan_id = $1 AND translate(die_no, '_', '-') = translate($2, '_', '-')`,
    [plan.id, entry.die_no]
  );
  const base = { date: target, plant: entry.plant_of_plan, revision: plan.revision, published: plan.status === 'published' };

  if (found[0]) {
    if (found[0].outcome) return { ...base, status: 'already-ran', entryId: found[0].id };
    await client.query(
      `UPDATE trial_plan_entries
          SET urgent = true, carried_from_entry_id = $1, carried_from_date = $2, carry_reason = $3,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $4`,
      [entry.id, entry.plan_date, reason, found[0].id]
    );
    return { ...base, status: 'tagged', entryId: found[0].id };
  }

  const last = await client.query(
    'SELECT COALESCE(MAX(position), 0) AS position FROM trial_plan_entries WHERE plan_id = $1',
    [plan.id]
  );
  const { rows } = await client.query(
    `INSERT INTO trial_plan_entries
       (plan_id, position, urgent, ${CARRY_COPY.join(', ')},
        carried_from_entry_id, carried_from_date, carry_reason, carry_added, created_by)
     VALUES ($1, $2, true, ${CARRY_COPY.map((_, i) => `$${i + 3}`).join(', ')},
        $${CARRY_COPY.length + 3}, $${CARRY_COPY.length + 4}, $${CARRY_COPY.length + 5}, true, $${CARRY_COPY.length + 6})
     RETURNING id`,
    [plan.id, Number(last.rows[0].position) + 1, ...CARRY_COPY.map(k => entry[k] ?? null),
      entry.id, entry.plan_date, reason, userId]
  );
  return { ...base, status: 'added', entryId: rows[0].id };
}

// The result was corrected away from Not run: a line the carry added comes off
// the later plan, and a line it only tagged loses the tag. Either is left alone
// once it has a result of its own.
async function undoCarry(client, entryId) {
  const { rows } = await client.query(
    'SELECT id, outcome, carry_added FROM trial_plan_entries WHERE carried_from_entry_id = $1',
    [entryId]
  );
  let removed = 0;
  for (const row of rows) {
    if (row.outcome) continue;
    if (row.carry_added) {
      await client.query('DELETE FROM trial_plan_entries WHERE id = $1', [row.id]);
      removed += 1;
    } else {
      await client.query(
        `UPDATE trial_plan_entries
            SET carried_from_entry_id = NULL, carried_from_date = NULL, carry_reason = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [row.id]
      );
    }
  }
  return { status: 'undone', removed };
}

// Alloy is not kept on the die record, so the plan offers the alloy the die
// ran with last time it was planned. Underscore and hyphen spellings of a die
// number are the same die, as everywhere else in the app.
async function lastAlloy(client, dieNo) {
  const die = trim(dieNo);
  if (!die) return null;
  const { rows } = await client.query(
    `SELECT e.alloy
       FROM trial_plan_entries e JOIN trial_plans p ON p.id = e.plan_id
      WHERE translate(e.die_no, '_', '-') = translate($1, '_', '-') AND e.alloy IS NOT NULL
      ORDER BY p.plan_date DESC, e.id DESC
      LIMIT 1`,
    [die]
  );
  return rows[0]?.alloy || null;
}

// Most die orders carry no customer name, so a blank customer is looked up the
// way the rest of the app knows it: the die list for that exact die, then any
// die of the same profile, then the profile master.
async function customerFor(client, dieNo) {
  const die = trim(dieNo);
  if (!die) return null;
  const { rows } = await client.query(
    `WITH d AS (SELECT translate($1, '_', '-') AS die, split_part(translate($1, '_', '-'), '-', 1) AS profile)
     SELECT customer FROM (
       SELECT x.customer, 1 AS rank, x.id
         FROM existing_die_details x, d
        WHERE x.die_no IN (d.die, translate(d.die, '-', '_')) AND COALESCE(trim(x.customer), '') <> ''
       UNION ALL
       SELECT x.customer, 2, x.id
         FROM existing_die_details x, d
        WHERE x.profile_number = d.profile AND COALESCE(trim(x.customer), '') <> ''
       UNION ALL
       SELECT p.customer_name, 3, p.id
         FROM profiles p, d
        WHERE p.profile_number = d.profile AND COALESCE(trim(p.customer_name), '') <> ''
     ) found
     ORDER BY rank, id DESC
     LIMIT 1`,
    [die]
  );
  return rows[0] ? trim(rows[0].customer) : null;
}

// Entries saved before their customer could be found still show it.
async function withCustomers(client, entries) {
  const found = new Map();
  for (const entry of entries) {
    if (trim(entry.customer)) continue;
    const key = trim(entry.die_no);
    if (!found.has(key)) found.set(key, await customerFor(client, key));
    entry.customer = found.get(key);
  }
  return entries;
}

// The longest range a summary will cover. A quarter is the widest view the page
// offers; this is headroom, not a feature.
const MAX_SUMMARY_DAYS = 100;

// Totals for a range, plus one line per day that had a plan. The caller picks
// the range, so what counts as "a week" is decided in one place: the page.
async function rangeSummary(client, from, to, plantInput = null) {
  // No plant means both plants added together.
  const plant = trim(plantInput) ? plantName(plantInput) : null;
  if (trim(plantInput) && !plant) return refuse(400, NO_PLANT);
  if (!isPlanDate(from) || !isPlanDate(to)) return refuse(400, 'from and to must be dates (YYYY-MM-DD)');
  if (from > to) return refuse(400, 'from cannot be after to');
  if (addDays(from, MAX_SUMMARY_DAYS) < to) return refuse(400, `A summary covers at most ${MAX_SUMMARY_DAYS} days`);

  const { rows } = await client.query(
    `SELECT ${ENTRY_SELECT_E}, p.plan_date, p.plant AS plan_plant
       FROM trial_plan_entries e JOIN trial_plans p ON p.id = e.plan_id
      WHERE p.plan_date BETWEEN $1 AND $2 AND ($3::text IS NULL OR p.plant = $3)
      ORDER BY p.plan_date ASC, p.plant ASC, e.position ASC, e.id ASC`,
    [from, to, plant]
  );

  // One line per plan: a day and a plant.
  const days = new Map();
  for (const row of rows) {
    const key = `${row.plan_date}|${row.plan_plant}`;
    if (!days.has(key)) days.set(key, { date: row.plan_date, plant: row.plan_plant, entries: [] });
    days.get(key).entries.push(row);
  }
  return {
    ok: true,
    from,
    to,
    plant,
    summary: summarise(rows),
    byDay: [...days.values()].map(({ date, plant: dayPlant, entries }) => {
      const { trials, supervised } = summarise(entries);
      return { date, plant: dayPlant, ...trials, supervised: supervised.planned };
    }),
  };
}

module.exports = {
  ENTRY_TYPES, OUTCOMES, PLAN_STATUSES, PLANTS, OUT_OF_QUEUE_REASONS, NOT_RUN_REASONS, FAIL_REASONS,
  RESULT_GRACE_DAYS, CORRECTOR_LOAD_FLAG, MAX_SUMMARY_DAYS,
  addDays, isPlanDate, plantName, nextWorkingDay, carryTarget, defaultPlanDate, planState,
  validateEntry, validateOutcome, summarise, findChecks,
  planView, lastAlloy, customerFor, addEntry, updateEntry, removeEntry, publishPlan, recordOutcome, rangeSummary,
};
