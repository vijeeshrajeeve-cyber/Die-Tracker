# QD Drawer Journey Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the QD details drawer as a journey strip plus five tabs, add a Cancelled approval state with a reason, and issue the QD number on approval instead of on submit.

**Architecture:** Backend first (state, cancel endpoint, numbering moved into `approveQD` under an advisory lock, PDF fallback), each piece unit-tested against the fake DB. Then a pure `journeyStops(qd)` helper with its own tests, a `QdJourneyStrip` component, and the drawer re-laid out into tabs with a cancel modal. App-level plumbing (Show cancelled, unnumbered fallbacks, Open die order) last, then a scratch-stack check.

**Tech Stack:** Node/Express `.cjs`, `pg`, `node:test` with `server/routes/testSupport.cjs`; React (Vite) with inline styles and `lucide-react`; pdf-lib in `qdPdf.cjs`.

**Spec:** `docs/superpowers/specs/2026-11-03-qd-drawer-journey-redesign-design.md`

## Global Constraints

- Approval states: `Draft`, `Pending`, `Approved`, `SentBack`, `Cancelled`. `EDITABLE_APPROVAL_STATES` stays `['Draft', 'SentBack']`.
- Cancel allowed only from Draft / Pending / SentBack; reason required; never clears `qd_no`.
- `qd_no` is assigned only in `approveQD`, only when null, under `pg_advisory_xact_lock(hashtext('<year><code>'))`; year = approval year.
- Unnumbered fallbacks: `Unnumbered` in registers/chips, `QD · unnumbered` in the drawer header, `Not yet numbered` in the PDF QD No box, `Draft QD` for Drafts in the search palette (existing).
- Pending lateness on the Approved stop: more than 3 days since `submitted_at`.
- Issue tab opens first in every state.
- Repo files are CRLF. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Commit per task; never merge or push.
- Server refusals: 400 missing input, 403 not allowed, 409 wrong state.

## Review Focus

1. Approving a legacy Pending QD that already has a number must keep it (Task 3 test "keeps an existing number").
2. Two approvals of different QDs under the same prefix in parallel must get different numbers — the lock is the guarantee; Task 3 tests only that the lock statement runs before the `SELECT qd_no` scan.
3. An imported or pre-workflow Approved QD with null `approved_at` and a Closed status must show no current stop and no red (Task 5 tests).
4. A cancelled QD must never reach `listMyQueue`, FOC reminders, KPIs or the Work Queue (Tasks 1, 2, 4).
5. Cancel on an Approved QD, or a second cancel, must 409 without writing (Task 2 test).

---

### Task 1: Cancelled state in the service

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs` (lines 28-42 states; 791-803 `listMyQueue`; 836-838 `excludeDrafts`; exports 893-905)
- Modify: `server/db.cjs` (ensure-column block near line 519)
- Modify: `server/services/focReminder.cjs:31`
- Modify: `server/routes/search.cjs:58,64`
- Modify: `server/migrations/20260921_work_queue.sql:236`
- Test: `server/services/qualityDiscrepancies.test.cjs`

**Interfaces:**
- Produces: `APPROVAL_STATES` includes `'Cancelled'`; `CANCELLABLE_APPROVAL_STATES = ['Draft', 'Pending', 'SentBack']`; `async cancelQD(client, { id, reason, actor, userId }) → { ok: boolean }` (throws `Reason is required to cancel a QD`; throws `Cannot cancel a QD that is Approved` / `… Cancelled` via `nextApprovalState(from, 'cancel')`); `excludeHidden(rows, { cancelled = false })` replaces `excludeDrafts` (drops Draft always, Cancelled unless `cancelled`); `onlyDrafts` unchanged.

- [ ] **Step 1: Write the failing tests** in `qualityDiscrepancies.test.cjs`, after the `sendBack` tests:

```js
test('cancelQD needs a reason and only works before approval', async () => {
  const row = (approval_state) => ({ query: async (sql) => (/SELECT id, qd_no, approval_state/.test(sql)
    ? { rows: [{ id: 5, qd_no: '2026PH-04', approval_state }] } : { rows: [], rowCount: 1 }) });
  await assert.rejects(() => q.cancelQD(row('Pending'), { id: 5, reason: ' ', actor: 'V', userId: 2 }), /Reason is required/);
  await assert.rejects(() => q.cancelQD(row('Approved'), { id: 5, reason: 'dup', actor: 'V', userId: 2 }), /Cannot cancel a QD that is Approved/);
  await assert.rejects(() => q.cancelQD(row('Cancelled'), { id: 5, reason: 'dup', actor: 'V', userId: 2 }), /Cannot cancel a QD that is Cancelled/);
});

test('cancelQD records who, when and why, keeps the number, and writes the timeline', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-04', approval_state: 'Pending' }] };
    return { rows: [], rowCount: 1 }; } };
  assert.deepEqual(await q.cancelQD(client, { id: 5, reason: 'Raised twice', actor: 'Veera', userId: 2 }), { ok: true });
  const upd = calls.find(c => /approval_state = 'Cancelled'/.test(c.sql));
  assert.match(upd.sql, /cancel_reason = \$1/); assert.match(upd.sql, /cancelled_by = \$2/); assert.match(upd.sql, /cancelled_at = CURRENT_TIMESTAMP/);
  assert.equal(/qd_no/.test(upd.sql), false);
  assert.deepEqual(upd.params, ['Raised twice', 2, 5]);
  const act = calls.find(c => /INSERT INTO quality_discrepancy_activity/i.test(c.sql));
  assert.ok(act.params.some(p => p === 'cancelled QD — Raised twice'));
});

test('excludeHidden drops drafts always and cancelled QDs unless asked for', () => {
  const rows = [{ approval_state: 'Draft' }, { approval_state: 'Cancelled' }, { approval_state: 'Approved' }];
  assert.deepEqual(q.excludeHidden(rows).map(r => r.approval_state), ['Approved']);
  assert.deepEqual(q.excludeHidden(rows, { cancelled: true }).map(r => r.approval_state), ['Cancelled', 'Approved']);
});

test('listMyQueue never lists a cancelled QD', async () => {
  const client = { query: async (sql) => { assert.match(sql, /approval_state IN \('Pending', 'SentBack'\)/); return { rows: [] }; } };
  assert.deepEqual(await q.listMyQueue(client, 2, { isApprover: true }), { awaitingApproval: [], sentBack: [] });
});
```

- [ ] **Step 2: Run** `node --test server/services/qualityDiscrepancies.test.cjs` — expect the four new tests to FAIL (`cancelQD is not a function`, `excludeHidden is not a function`).

- [ ] **Step 3: Implement.** In `qualityDiscrepancies.cjs`: add `'Cancelled'` to `APPROVAL_STATES`; add `cancel: 'Cancelled'` to the `Draft`, `SentBack` and `Pending` rows of `APPROVAL_TRANSITIONS`; add `CANCELLABLE_APPROVAL_STATES`; write `cancelQD` modelled on `sendBack` with the UPDATE `SET approval_state = 'Cancelled', cancel_reason = $1, cancelled_by = $2, cancelled_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $3` and activity `cancelled QD — <reason>` (icon `undo`, tone `bad`); replace `excludeDrafts` with `excludeHidden`, keeping an `excludeDrafts = (rows) => excludeHidden(rows)` alias so the route still works until Task 2; export all. `listMyQueue` already filters by state — the test pins it.
  In `db.cjs` add three ensure-column blocks beside `sent_back_reason`: `cancel_reason TEXT`, `cancelled_by INTEGER`, `cancelled_at TIMESTAMPTZ`.
  In `focReminder.cjs:31` change to `AND q.approval_state NOT IN ('Draft', 'Cancelled')`. In `search.cjs` lines 58 and 64 add `AND approval_state <> 'Cancelled'`.
  In `20260921_work_queue.sql:236` change to `IF s->>'approval_state' IN ('Draft','Cancelled') THEN RETURN jsonb_build_object('terminal','cancelled'); END IF;` (the file is re-run at every boot by `workQueueSchema.cjs`, so no new migration file is needed).

- [ ] **Step 4: Run** `node --test server/services/qualityDiscrepancies.test.cjs server/services/focReminder.test.cjs` — expect PASS. (If `focReminder.test.cjs` does not exist, run the service suite only.)

- [ ] **Step 5: Commit** `feat(qd): Cancelled approval state with reason`.

---

### Task 2: Cancel route and the register's cancelled filter

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs` (GET `/` at 121-156; add `POST /:id/cancel` after `sendBack` route)
- Test: `server/routes/quality-discrepancies.approval.test.cjs`

**Interfaces:**
- Consumes: Task 1 `cancelQD`, `excludeHidden`, `CANCELLABLE_APPROVAL_STATES`; existing `qdSettings.isApprover(req.user, settings.approverUserIds)`, `qd.getApprovalRow`.
- Produces: `POST /api/quality-discrepancies/:id/cancel { reason }` → 200 `{ message: 'Cancelled' }`; `GET /api/quality-discrepancies?cancelled=1` includes cancelled rows in `qds` only (never in `kpis`, `foc`, `suppliers`).

- [ ] **Step 1: Write the failing tests** (the fake DB in this file returns `qdRow` for any `FROM quality_discrepancies`; set `qdRow.created_by` to control who the raiser is):

```js
test('cancelling needs a reason', async () => {
  qdRow.approval_state = 'Pending';
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: '' } });
  assert.equal(status, 400); assert.match(body.error, /Reason is required/);
});
test('an approved QD cannot be cancelled', async () => {
  qdRow.approval_state = 'Approved';
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: 'dup' } });
  assert.equal(status, 409); assert.match(body.error, /Cannot cancel a QD that is Approved/);
  assert.equal(writes.some((w) => /Cancelled/.test(w)), false);
});
test('a plain user cannot cancel someone else\'s QD', async () => {
  // The main app signs in as admin, so mount the router once more behind a plain user.
  const plain = express(); plain.use(express.json());
  plain.use((req, _res, next) => { req.user = { id: 9, username: 'sijith', role: 'user' }; next(); });
  plain.use('/api/quality-discrepancies', qdRouter);
  const { base: plainBase, close: closePlain } = await listen(plain);
  try {
    qdRow.approval_state = 'Pending'; qdRow.created_by = 1; settingsRow = { approver_user_ids: '[]' };
    const { status, body } = await request(plainBase, `${QD}/cancel`, { body: { reason: 'dup' } });
    assert.equal(status, 403); assert.match(body.error, /cannot cancel/i);
    assert.equal(writes.some((w) => /Cancelled/.test(w)), false);
  } finally { await closePlain(); }
});
test('the raiser can cancel their own pending QD', async () => {
  qdRow.approval_state = 'Pending'; qdRow.created_by = 1;
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: 'Raised twice' } });
  assert.equal(status, 200); assert.equal(body.message, 'Cancelled');
  assert.ok(writes.some((w) => /approval_state = 'Cancelled'/.test(w)));
});
test('the register hides cancelled QDs unless asked', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Cancelled' };
  assert.equal((await request(base, '/api/quality-discrepancies')).body.qds.length, 0);
  const { body } = await request(base, '/api/quality-discrepancies?cancelled=1');
  assert.equal(body.qds.length, 1); assert.equal(body.kpis.total ?? body.kpis.openCount, 0);
});
```
  Pin the KPI assertion to whatever field `computeKpis` returns for the count (read `computeKpis` once; use its total-count key).

- [ ] **Step 2: Run** `node --test server/routes/quality-discrepancies.approval.test.cjs` — expect the new tests to FAIL (404 on `/cancel`; register test fails on `qds.length`).

- [ ] **Step 3: Implement.** `POST /:id/cancel`: load `getApprovalRow`; 404 if missing; allowed when `req.user.role === 'admin'`, or `row.created_by === req.user.id`, or `qdSettings.isApprover(req.user, settings.approverUserIds)`; otherwise 403 `You cannot cancel this QD`. Then transaction → `qd.cancelQD` → COMMIT → `{ message: 'Cancelled' }`. If the `POST /:id/send-back` route notifies the raiser after commit (read it), do the same here with the cancel reason; if it does not, cancel does not either. Map `/^Reason is required/` → 400, `/^Cannot cancel/` → 409. In `GET /`: `visible = drafts ? onlyDrafts(...) : excludeHidden(scoped, { cancelled: req.query.cancelled === '1' })`; `forKpis = excludeHidden(scoped)`. Add `can_cancel` to each decorated row using the same rule as the route.

- [ ] **Step 4: Run** the route suite — expect PASS.

- [ ] **Step 5: Commit** `feat(qd): cancel route and Show cancelled register filter`.

---

### Task 3: Number issued on approval

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs` (`submitForApproval` 730-752, `approveQD` 805-818; add `allocateQdNo`)
- Modify: `server/routes/quality-discrepancies.cjs` (`nextQdNo` 88-107 removed; submit 436-469; approve 496-530)
- Test: `server/services/qualityDiscrepancies.test.cjs`, `server/routes/quality-discrepancies.approval.test.cjs`

**Interfaces:**
- Produces: `async allocateQdNo(client, supplierName) → string` (moved from the route, now locks first: `SELECT pg_advisory_xact_lock(hashtext($1))` with `${year}${code}` before the `SELECT qd_no … LIKE` scan; throws `No QD code for supplier "…"`); `submitForApproval(client, { id, actor, userId, approverUserId, approverName })` (no `newQdNo`; returns `{ ok, state }`); `approveQD(client, { id, actor, userId }) → { ok, qdNo }` assigning when `row.qd_no` is null.

- [ ] **Step 1: Rewrite the submit tests** at lines 774-828 and add approve tests:

```js
// submitForApproval: drop `newQdNo` from every call; change the assertions to
assert.equal(calls.some(c => /qd_no/.test(c.sql) && /^UPDATE/.test(c.sql.trim())), false); // submit never touches qd_no
const upd = calls.find(c => /SET approval_state = \$1/.test(c.sql)); assert.equal(upd.params[0], 'Pending');
// the "keeps an existing number when resubmitting" test is deleted (nothing to keep any more).
// activity text:
assert.ok(activity.params.some(p => typeof p === 'string' && p.startsWith('submitted QD against die D-1 for approval to Imran')));

test('approveQD issues the next number under the prefix lock when the QD has none', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: null, approval_state: 'Pending', supplier: 'Phoenix' }] };
    if (/FROM suppliers/.test(sql)) return { rows: [{ name: 'Phoenix', qd_code: 'PH' }] };
    if (/SELECT qd_no FROM quality_discrepancies WHERE qd_no LIKE/.test(sql)) return { rows: [{ qd_no: `${new Date().getFullYear()}PH-03` }] };
    return { rows: [], rowCount: 1 }; } };
  const out = await q.approveQD(client, { id: 5, actor: 'Imran', userId: 9 });
  assert.equal(out.qdNo, `${new Date().getFullYear()}PH-04`);
  const lockIdx = calls.findIndex(c => /pg_advisory_xact_lock/.test(c.sql));
  const scanIdx = calls.findIndex(c => /SELECT qd_no FROM quality_discrepancies WHERE qd_no LIKE/.test(c.sql));
  assert.ok(lockIdx >= 0 && lockIdx < scanIdx, 'the lock must be taken before the number scan');
  const upd = calls.find(c => /approval_state = 'Approved'/.test(c.sql));
  assert.match(upd.sql, /qd_no = \$1/); assert.equal(upd.params[0], out.qdNo);
});

test('approveQD keeps an existing number', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params });
    if (/SELECT id, qd_no, approval_state/.test(sql)) return { rows: [{ id: 5, qd_no: '2026PH-02', approval_state: 'Pending', supplier: 'Phoenix' }] };
    return { rows: [], rowCount: 1 }; } };
  const out = await q.approveQD(client, { id: 5, actor: 'Imran', userId: 9 });
  assert.equal(out.qdNo, '2026PH-02');
  assert.equal(calls.some(c => /pg_advisory_xact_lock/.test(c.sql)), false);
});
```
  In the route suite add:
```js
test('approving an unnumbered QD answers 409 when the number collides', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Pending', submitted_at: new Date() };
  collideOnApprove = true; // make the fake DB throw { code: '23505' } on the UPDATE … approval_state = 'Approved'
  const { status, body } = await request(base, `${QD}/approve`, { method: 'POST' });
  assert.equal(status, 409); assert.match(body.error, /please retry/);
});
test('submitting never writes a number', async () => {
  const { status } = await request(base, `${QD}/submit`, { body: { approverUserId: 1 } });
  assert.equal(status, 200); assert.equal(writes.some((w) => /SET qd_no/.test(w)), false);
});
```
  Add a `collideOnApprove` flag to the fake DB at the top of the file, reset in `beforeEach`.

- [ ] **Step 2: Run** both suites — expect the rewritten/new tests to FAIL.

- [ ] **Step 3: Implement.** Move `nextQdNo` from the route into the service as `allocateQdNo`, adding the advisory-lock query first. `submitForApproval`: drop the number logic; UPDATE `SET approval_state = $1, submitted_by = $2, assigned_approver = $3, submitted_at = …, updated_at = … WHERE id = $4`; activity `submitted QD against die ${die_no} for approval${to_whom}` (add `die_no` to `getApprovalRow`'s SELECT). `approveQD`: `const qdNo = row.qd_no || await allocateQdNo(client, row.supplier)`; UPDATE adds `qd_no = $1`; activity `approved QD ${qdNo}`; return `{ ok: true, qdNo }`. Route: submit no longer computes a number and drops the 23505 branch; approve gains `if (e.code === '23505') return res.status(409).json({ error: 'QD number already exists — please retry' })` and the `/^No QD code/` → 400 branch; response `{ message, qd_no: out.qdNo }`.

- [ ] **Step 4: Run** `node --test server/services/qualityDiscrepancies.test.cjs server/routes/quality-discrepancies.approval.test.cjs` — expect PASS.

- [ ] **Step 5: Commit** `feat(qd): issue the QD number on approval, not on submit`.

---

### Task 4: PDF reads "Not yet numbered"

**Files:**
- Modify: `server/services/qdPdf.cjs:431`
- Test: `server/services/qdPdf.test.cjs`

- [ ] **Step 1: Write the failing test** following the file's existing render-and-extract pattern (it already renders a QD and asserts on page text/images):

```js
test('an unnumbered QD prints "Not yet numbered" in the QD No box', async () => {
  const bytes = await renderWith({ ...SAMPLE_QD, qd_no: null }); // the suite's existing render helper + fixture
  assert.match(await pageText(bytes, 1), /Not yet numbered/);
});
```
  Use whatever helper names the suite already has for rendering and reading page text; if it has no text extractor, assert on `drawText` via the suite's existing spy pattern.

- [ ] **Step 2: Run** `node --test server/services/qdPdf.test.cjs` — expect FAIL.

- [ ] **Step 3: Implement.** Line 431: `drawCell(page, qd.qd_no || 'Not yet numbered', …)`. The annexure title at 758 already falls back to the die number.

- [ ] **Step 4: Run** the suite — expect PASS.

- [ ] **Step 5: Commit** `feat(qd-pdf): unnumbered QDs print "Not yet numbered"`.

---

### Task 5: `journeyStops(qd)` helper

**Files:**
- Create: `src/utils/qdJourney.js`
- Test: `src/utils/qdJourney.test.js` (run with `node --test src/utils/qdJourney.test.js`, as `searchPalette.test.js` is)

**Interfaces:**
- Produces: `journeyStops(qd, now = new Date()) → Stop[]` where `Stop = { key, label, date: string|null, note: string|null, state: 'done'|'current'|'todo'|'cancelled', late: boolean }`. Keys in order: `raised`, `approved`, `purchase`, `supplier`, `reply`, then `foc`, `trial` only when `qd.foc?.roundCount > 0`, then `closed`. Dates are `YYYY-MM-DD` strings. `PENDING_LATE_DAYS = 3` exported.

- [ ] **Step 1: Write the failing tests** (fixtures as plain objects; `now` fixed to `2026-11-03`):

```js
test('a draft is current at Raised and nothing is late', …) // stops[0].state==='current', every other 'todo', no late
test('a pending QD shows who it is with and goes red after 3 days', …) // submitted_at 2026-10-28, assigned_approver_name 'Imran' → approved.note==='with Imran · 6 days', late true, state 'current'; submitted 2026-11-02 → late false
test('a sent-back QD notes the date on the Approved stop', …) // sent_back_at → note 'sent back 2026-10-30'
test('an approved QD out with the supplier is late past its ETA', …) // status 'Sent to Supplier', eta_date 2026-08-29 → reply.state 'current', late true, note '66 days past ETA'
test('a supplier acceptance completes the reply stop', …) // supplier_acceptance 'Yes', eta_date set → reply.state 'done', late false
test('FOC stops appear only with rounds and read the latest round', …) // foc {roundCount:2, state:'awaiting-trial', daysIdle:4, receivedDate:'2026-11-01', rounds:[…]} → keys include foc, trial; foc.state 'done'; trial.state 'current', note 'awaiting trial · 4 days in plant', label suffix 'attempt 2'
test('FOC awaiting receipt past its promise is late', …) // foc.state 'awaiting-receipt', daysOverdue 5, promisedEta → foc.state 'current', late true, note '5 days overdue'
test('a closed QD has no current stop and dashes for missing dates', …) // status 'Closed', closed_at set, approved_at null, sent_to_supplier_date null → every stop 'done', none late, supplier.date null
test('a legacy approved QD with no approval date counts Approved as done', …) // approved_at null, sent_to_purchase_date '2026-09-01', status 'Open' → approved.state 'done', approved.date null, note 'approved'; current is the first missing date after it
test('Rejected relabels the last stop', …) // status 'Rejected' → closed.label 'Rejected'
test('a cancelled QD greys everything and ends on a Cancelled stop', …) // approval_state 'Cancelled', cancelled_at, cancel_reason → last key 'cancelled', state 'cancelled', note === reason; every stop before it 'cancelled' too; none current
```
  Write each as a full test with `assert.equal` on the named fields.

- [ ] **Step 2: Run** `node --test src/utils/qdJourney.test.js` — expect FAIL (module not found).

- [ ] **Step 3: Implement** `journeyStops`. Algorithm: build the ordered stop list with its date source and done-rule; mark `done` where the rule holds; if settled (`closed_at`, or status in `Closed`/`Rejected`/`Reference`) mark all done; else the first non-done stop is `current` and the rest `todo`; then apply late rules (approved: Pending and `now − submitted_at > 3 d`; reply: current and `eta_date < now` and status in `Open`/`Sent to Supplier`; foc: `foc.daysOverdue > 0`). Cancelled short-circuits to the cancelled shape. Day arithmetic in UTC on the `YYYY-MM-DD` slice.

- [ ] **Step 4: Run** the test file — expect PASS.

- [ ] **Step 5: Commit** `feat(qd): journeyStops helper for the drawer strip`.

---

### Task 6: `QdJourneyStrip` component

**Files:**
- Create: `src/components/qd/QdJourneyStrip.jsx`
- Modify: `src/components/qd/QDDetailPanel.jsx` (render the strip under the header, before the Preview/Download row, at ~line 463)

**Interfaces:**
- Consumes: Task 5 `journeyStops`.
- Produces: `<QdJourneyStrip qd={qd} theme={theme} />`, read-only, `role="list"`, each stop `role="listitem"` with `aria-current="step"` on the current one and `data-state`/`data-late` attributes (used by Task 9's checks).

- [ ] **Step 1: Implement.** Flex row, `flexWrap: 'wrap'` with each stop `minWidth: 96`; dot + connector line; label above (11px uppercase like `sectionLabel`), date or note below (12px). Colours from the theme: done = `theme.accent`, current = white dot with accent ring, todo = `theme.textDim`, late = `#F87171`, cancelled = `theme.textDim` with `textDecoration: 'line-through'` on the Cancelled stop's label. No horizontal scroll.

- [ ] **Step 2: Render it in the drawer** and check it visually on the scratch stack with one Approved and one Pending QD (`npx vite preview` recipe in memory `qd-approval-ux-phase1`). Screenshot both.

- [ ] **Step 3: Commit** `feat(qd): journey strip in the QD drawer`.

---

### Task 7: Drawer tabs, Record trial and Cancel QD

**Files:**
- Modify: `src/components/qd/QDDetailPanel.jsx` (facts 258-300; body 614-757)
- Create: `src/components/qd/QdCancelModal.jsx`
- Create: `src/components/qd/QdPhotoGrid.jsx`
- Modify: `src/components/qd/FocRounds.jsx` (drop the Record trial button; keep the banner and table)
- Modify: `src/api.js` (add `cancel: (id, reason) => apiRequest(\`/quality-discrepancies/${id}/cancel\`, { method: 'POST', body: { reason } })` beside `sendBack`; `list` gains `{ cancelled }` → `cancelled=1`)
- Modify: `src/utils/constants.js:299-307` (add `Cancelled: { label: 'Cancelled', bg: 'rgba(113,113,122,0.15)', fg: '#71717a' }`; `QD_LIST_BADGE_STATES` gains `'Cancelled'`)

**Interfaces:**
- Consumes: `qd.can_cancel` from Task 2; `qualityDiscrepanciesAPI.cancel`.
- Produces: `QDDetailPanel` props gain `onOpenOrder(dieOrderId)` (optional); `<QdCancelModal qd theme onClose onDone />`; `<QdPhotoGrid files profileFile theme onAdd busy />`.

- [ ] **Step 1: Tabs.** Add `const [tab, setTab] = useState('issue')` and a tab bar (`role="tablist"`, buttons with `role="tab"` and `aria-selected`) with the five tabs `Issue · Photos · Supplier & FOC · Die · Activity`. Move the sections per the spec:
  - Issue: issue text block (from 694-699) + the fact cards for `corrector`, `outcome`, `input_at_failure`, plus `manufacturing_defect`, `die_performance`, `recommended_action` and billet readings as read-only cards (editable ones keep today's inline editor and the Draft/SentBack rule).
  - Photos: `<QdPhotoGrid>` — profile image first, then image files (`!isPdf`), 3 per row, each a button opening a fixed-overlay lightbox showing the image via the authenticated blob the download helper already fetches (reuse `qualityDiscrepanciesAPI.downloadFile`'s fetch path to get a blob URL; do not use a bare `<img src>` to the API). PDFs and `original_form` as the existing chips under the grid. The hidden `<input type="file">` and Add file button move here.
  - Supplier & FOC: fact cards for `supplier_acceptance`, `action_taken`, `supplier_comments`, `received_by_supplier`, `eta_date`, `qd_requested_date`, `sent_to_purchase_date`, `sent_to_supplier_date` (editable only when Approved, as today), then `<FocRounds>`.
  - Die: read-only cards `die_no`, `profile_number`, `plant`, `supplier`, `die_type` (if present on the row), and a button `Open die order` when `qd.die_order_id && onOpenOrder`, which calls `onClose()` then `onOpenOrder(qd.die_order_id)`.
  - Activity: timeline + note composer unchanged.
- [ ] **Step 2: Action row additions.** In the Approved action row, before the `Next` button: `{qd.foc?.state === 'awaiting-trial' && <button onClick={() => setTrialOpen(true)} …><FlaskConical size={15} /> Record trial</button>}`. In every non-Approved, non-Cancelled state, when `qd.can_cancel`: a text link `Cancel QD` (`color: dim`, underline on hover) at the far right of the Preview/Download row that sets `cancelOpen`. Cancelled state: no step card, no Cancel link; a grey notice `Cancelled <date> by <name> — <reason>` above the tabs.
- [ ] **Step 3: `QdCancelModal`.** Modelled on the send-back modal already in the drawer (find `setSendBackOpen` usage): title `Cancel QD`, one required text input `Reason`, copy `This QD leaves the approval queue. Nothing is deleted — it stays readable under "Show cancelled".`, buttons `Cancel QD` (danger, disabled until reason non-blank) / `Keep`. On success call `onDone()` (parent's `onChanged`) and close.
- [ ] **Step 4: Verify on the scratch stack:** Draft → Cancel with reason → drawer shows the grey notice, tabs read-only; Pending with FOC fixture → Record trial button present only when awaiting trial; Photos tab lightbox opens and closes with Escape. Screenshot the Issue, Photos and Supplier & FOC tabs.
- [ ] **Step 5: Commit** `feat(qd): tabbed drawer with photo grid, Record trial and Cancel QD`.

---

### Task 8: App plumbing — Show cancelled, unnumbered labels, Open die order

**Files:**
- Modify: `src/pages/QDTrackerPage.jsx` (81-122 list fetch; 300-310 Drafts toggle; 590-605 drawer props)
- Modify: `src/DieOrderingSystem.jsx:3100,3143` (register rows), the page that renders `QDTrackerPage` (pass `onOpenOrder`), `openSearchOrder` at ~2215 (reuse)
- Modify: `src/components/qd/QdQueueBanner.jsx:38`, `src/components/qd/FocPendingPanel.jsx:86`, `src/components/qd/QDFormPreviewModal.jsx:84`, `src/components/qd/RaiseQDModal.jsx:334`, `src/components/qd/QDDetailPanel.jsx:444,606`, `src/utils/searchPalette.js:50`, `src/components/search/SearchPalette.jsx:283`
- Test: `src/utils/searchPalette.test.js`

**Interfaces:**
- Consumes: Task 2 `?cancelled=1`; Task 7 `onOpenOrder`.

- [ ] **Step 1: Write the failing test** in `searchPalette.test.js`: `toRecent('qd', { id: 9, qd_no: null, approval_state: 'Pending', die_no: 'D-1' }, 100)` has `label: 'Unnumbered'`. Run it, expect FAIL (today it yields `QD #9`).
- [ ] **Step 2: Labels.** Replace every `qd_no || 'Draft'` / `|| '—'` / `QD #${id}` fallback listed above with: `Unnumbered` in registers, queue banner, FOC panel, preview title and search palette (Drafts keep `Draft QD` in the palette); `QD · unnumbered` in the drawer header; `Next: ${nextQd.qd_no || 'die ' + nextQd.die_no}` on the Next button; the raise modal title `Unnumbered` for a SentBack without a number. Queue banner and Alerts bell rows add `raised <date> by <prepared_by>` after the label when unnumbered. Sort: where lists sort by `qd_no`, nulls last.
- [ ] **Step 3: Show cancelled.** In `QDTrackerPage` add `showCancelled` state next to `showDrafts`, pass `{ drafts: showDrafts, cancelled: showCancelled }` to `list`, add it to the effect deps and to the two refetches at 629/649, and a toggle button beside Drafts labelled `Show cancelled` / `Cancelled (showing)` in the same style. Register rows with `approval_state === 'Cancelled'` render at `opacity: 0.55` with the Cancelled badge from the constants map.
- [ ] **Step 4: Open die order.** In `DieOrderingSystem.jsx`, pass `onOpenOrder={(id) => openSearchOrder(id)}` (or the equivalent that `openSearchOrder` wraps — read it; it upserts the order into `data` and calls `setSelectedOrder`) to `QDTrackerPage`, which forwards it to `QDDetailPanel`.
- [ ] **Step 5: Run** `node --test src/utils/searchPalette.test.js` — PASS; `npm run build` — no errors.
- [ ] **Step 6: Commit** `feat(qd): Show cancelled filter, unnumbered labels, Open die order`.

---

### Task 9: Scratch-stack verification

**Files:** none changed (fixes found go back into the owning task's commit scope as a new commit).

- [ ] **Step 1:** Run every server suite: `node --test server/**/*.test.cjs` (or the project's `npm test`) — all PASS.
- [ ] **Step 2:** Start the scratch stack per memory `qd-approval-ux-phase1` (throwaway DB, backend image with `server/` mounted, `vite preview`). Confirm at boot that the Work Queue SQL re-applied (`SELECT work_queue_project('qd', <cancelled id>)` returns `{"terminal":"cancelled"}`).
- [ ] **Step 3:** Walk the spec's "Done looks like" list: Draft strip; cancel → gone from register until Show cancelled; Pending has no number in register, bell, drawer, preview PDF (`Not yet numbered`); approve → next number for the prefix appears and the Purchase email body carries it (check the SMTP capture or the activity row); FOC QD shows FOC and Trial stops plus Record trial; `GET /api/quality-discrepancies` KPIs unchanged by a cancelled row; the register, bell and palette show no `null`/blank labels.
- [ ] **Step 4:** Screenshot the strip for a late supplier reply and the cancelled drawer; send both to the user.
- [ ] **Step 5:** Report what passed, what could not be exercised (real email sending), and leave the branch uncommitted beyond task commits — merging is the user's call.
