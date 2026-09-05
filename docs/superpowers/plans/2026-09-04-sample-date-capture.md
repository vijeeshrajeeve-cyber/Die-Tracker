# Sample Date Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Today** button beside Submission Date and Sample Approval Date that stamps today's date and advances Status along a forward-only ladder, in one request.

**Architecture:** The ladder rule is a pure function in `src/utils/sampleStatus.js`, unit-tested without a browser. A shared `StampTodayButton` component owns the confirm and the toast wording so the table cell and the record modal cannot drift. Saving reuses the page's existing two-source split — `die_orders` records patch through `ordersAPI`, standalone records through `sampleFollowupsAPI` — extended to write two fields in one call.

**Tech Stack:** React 18 with inline style objects (ESM under `src/`), `node:test`, existing `dialogs.confirm` from `DialogProvider`.

**Spec:** `docs/superpowers/specs/2026-09-04-sample-date-capture-design.md`

## Global Constraints

- **Status ladder, exact strings and order:** `Pending` (0) → `Sample Submitted` (1) → `Approved` (2). Status is written only when the target ranks strictly higher than the current stage.
- **`Rejected` and `On hold` are off-ladder:** the button stamps the date and leaves Status untouched. Never infer that a rejection has been resolved.
- **An empty or missing status counts as `Pending`** and advances normally.
- **Declining the overwrite confirm changes nothing** — not the date, not the Status.
- **The date and the status move together or not at all** — one request, never two.
- **Permissions:** anyone who can edit the page. No admin gate.
- **Do not touch Die Received Date.** It belongs to the receiving flow.
- **Do not backfill existing records** whose status already disagrees with their dates.
- **Tests:** `npm test` runs `node --test "server/**/*.test.cjs" "src/**/*.test.js"`. There is no React component test framework — verify UI with `npx eslint <changed files>` plus `npm run build`.
- **Do not run `npm run build:check`.** `npm run lint` fails on 77 pre-existing repo-wide problems, so it never reaches the build.
- **Relative imports in `src/` need the `.js` extension** (e.g. `'./helpers.js'`) or the module cannot load under `node:test`.
- **The local Docker stack is a TEST server.** Never present its counts as facts about real data. `docker compose build <svc> && docker compose up -d <svc>` — a restart does not pick up source edits.

---

### Task 1: Make "today" mean the local day

Found while planning: `new Date().toISOString().slice(0, 10)` returns the **UTC** date, not the local one. The server runs Asia/Dubai (UTC+4), so between 00:00 and 04:00 local time it reports *yesterday*.

This is already live in the trial-recording code, where it has teeth: a trial logged at 1am would have its date picker capped at yesterday, and entering the real date would be rejected as "in the future". The date-capture button would inherit the same fault, so it is fixed first, once, in a shared place.

**Files:**
- Create: `src/utils/today.js`
- Test: `src/utils/today.test.js`
- Modify: `src/components/sample/TrialsSection.jsx:8`
- Modify: `server/services/sampleTrials.cjs` (add beside `normaliseDate`)
- Modify: `server/routes/sample-trials.cjs:8`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `todayLocal(now = new Date()): string` exported from `src/utils/today.js` — the local calendar day as `'YYYY-MM-DD'`
  - `todayLocal(now = new Date()): string` exported from `server/services/sampleTrials.cjs` — same rule, CommonJS

- [ ] **Step 1: Write the failing test**

Create `src/utils/today.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { todayLocal } from './today.js';

const require = createRequire(import.meta.url);
const server = require('../../server/services/sampleTrials.cjs');

// 01:30 on 5 September, Dubai (UTC+4) — which is still 21:30 on the 4th in UTC.
// This is the window where toISOString() silently reports the wrong day.
const EARLY_HOURS = new Date(2026, 8, 5, 1, 30, 0);

test('the local day is used, not the UTC day', () => {
  assert.equal(todayLocal(EARLY_HOURS), '2026-09-05');
  assert.equal(server.todayLocal(EARLY_HOURS), '2026-09-05');
});

test('months and days are zero-padded', () => {
  assert.equal(todayLocal(new Date(2026, 0, 3, 12, 0, 0)), '2026-01-03');
  assert.equal(server.todayLocal(new Date(2026, 0, 3, 12, 0, 0)), '2026-01-03');
});

test('the last moment of a day still reports that day', () => {
  assert.equal(todayLocal(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('the frontend and backend agree', () => {
  const at = new Date(2026, 5, 15, 3, 0, 0);
  assert.equal(todayLocal(at), server.todayLocal(at));
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx node --test src/utils/today.test.js
```

Expected: FAIL — cannot find module `./today.js`.

- [ ] **Step 3: Write the frontend helper**

Create `src/utils/today.js`:

```js
// The local calendar day as 'YYYY-MM-DD'.
//
// NOT toISOString().slice(0, 10) — that is the UTC day. This app runs in
// Asia/Dubai (UTC+4), so between midnight and 4am the UTC day is still
// yesterday: a date picker capped at "today" would refuse the real today, and
// a stamped date would be a day early. Reading the local components avoids it.
export const todayLocal = (now = new Date()) => {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
```

- [ ] **Step 4: Write the backend helper**

In `server/services/sampleTrials.cjs`, add immediately after the `normaliseDate` function:

```js
// The local calendar day as 'YYYY-MM-DD'. NOT toISOString().slice(0, 10):
// that is the UTC day, and this server runs Asia/Dubai (UTC+4), so between
// midnight and 4am it would reject a trial dated today as being in the future.
function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
```

Add `todayLocal` to that file's `module.exports` list.

- [ ] **Step 5: Use it at both call sites**

In `server/routes/sample-trials.cjs`, replace line 8:

```js
const today = () => new Date().toISOString().slice(0, 10);
```

with:

```js
const today = () => svc.todayLocal();
```

In `src/components/sample/TrialsSection.jsx`, replace line 8:

```js
const today = () => new Date().toISOString().slice(0, 10);
```

with an import at the top of the file and a local alias:

```js
import { todayLocal } from '../../utils/today.js';
```

then delete the old `const today = ...` line and replace every `today()` call in that file with `todayLocal()`. There are four: the `EMPTY` reset in the Add Trial click handler, the two guards in `save()`, and the `max` attribute on the date input.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx node --test src/utils/today.test.js && npm test
```

Expected: the new file passes 4 tests; the full suite passes.

- [ ] **Step 7: Verify lint and build**

```bash
npx eslint src/utils/today.js src/components/sample/TrialsSection.jsx
```

Expected: no errors.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/utils/today.js src/utils/today.test.js src/components/sample/TrialsSection.jsx server/services/sampleTrials.cjs server/routes/sample-trials.cjs
git commit -m "fix(sample-trials): use the local day, not the UTC day"
```

---

### Task 2: The status ladder

**Files:**
- Create: `src/utils/sampleStatus.js`
- Test: `src/utils/sampleStatus.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `advanceStatus(currentStatus, targetStatus): string | null` — the status to store, or `null` meaning leave it alone (covers both the no-rewind case and the off-ladder case with one answer shape).

- [ ] **Step 1: Write the failing test**

Create `src/utils/sampleStatus.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceStatus } from './sampleStatus.js';

test('Pending advances to either stage', () => {
  assert.equal(advanceStatus('Pending', 'Sample Submitted'), 'Sample Submitted');
  assert.equal(advanceStatus('Pending', 'Approved'), 'Approved');
});

test('Sample Submitted advances to Approved', () => {
  assert.equal(advanceStatus('Sample Submitted', 'Approved'), 'Approved');
});

test('Approved never falls back to Sample Submitted', () => {
  assert.equal(advanceStatus('Approved', 'Sample Submitted'), null);
});

test('re-stamping a stage with its own target changes nothing', () => {
  assert.equal(advanceStatus('Sample Submitted', 'Sample Submitted'), null);
  assert.equal(advanceStatus('Approved', 'Approved'), null);
});

test('an empty or missing status is treated as Pending and advances', () => {
  assert.equal(advanceStatus('', 'Sample Submitted'), 'Sample Submitted');
  assert.equal(advanceStatus(null, 'Approved'), 'Approved');
  assert.equal(advanceStatus(undefined, 'Sample Submitted'), 'Sample Submitted');
});

test('Rejected is left alone by both buttons', () => {
  assert.equal(advanceStatus('Rejected', 'Sample Submitted'), null);
  assert.equal(advanceStatus('Rejected', 'Approved'), null);
});

test('On hold is left alone by both buttons', () => {
  assert.equal(advanceStatus('On hold', 'Sample Submitted'), null);
  assert.equal(advanceStatus('On hold', 'Approved'), null);
});

test('an unrecognised status is left alone rather than guessed at', () => {
  assert.equal(advanceStatus('Something Else', 'Approved'), null);
});

test('an unrecognised target is refused', () => {
  assert.equal(advanceStatus('Pending', 'Cancelled'), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx node --test src/utils/sampleStatus.test.js
```

Expected: FAIL — cannot find module `./sampleStatus.js`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/sampleStatus.js`:

```js
// How far along a sample has got. Only these three are stages; the ladder is
// what lets the Today buttons advance a record without ever walking it
// backwards, so a late date correction cannot un-approve a die.
const STAGE_RANK = {
  'Pending': 0,
  'Sample Submitted': 1,
  'Approved': 2,
};

// Returns the status to store, or null for "leave it alone".
//
// Null covers two different situations deliberately, because the caller treats
// them identically: the target would move the record backwards (or nowhere),
// and the record sits in a status that is not a stage at all.
//
// `Rejected` and `On hold` are the second kind — they describe a decision
// somebody made, not progress through the flow. The system cannot tell whether
// a rejection still stands, so it does not guess: the date is stamped and the
// status is left for a person to change deliberately.
export const advanceStatus = (currentStatus, targetStatus) => {
  const target = STAGE_RANK[targetStatus];
  if (target === undefined) return null;

  // An empty status is a record that has not started moving yet, which is what
  // Pending means.
  const current = STAGE_RANK[currentStatus || 'Pending'];
  if (current === undefined) return null;

  return target > current ? targetStatus : null;
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx node --test src/utils/sampleStatus.test.js
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/sampleStatus.js src/utils/sampleStatus.test.js
git commit -m "feat(sample-dates): forward-only status ladder"
```

---

### Task 3: Save two fields in one request

Plumbing only — nothing is user-visible after this task. It exists as its own review gate because the change-log handling is easy to get wrong: the existing single-field saver writes an audit entry per change, and a two-field save must write one entry per field, not one for the pair.

**Files:**
- Modify: `src/DieOrderingSystem.jsx` (add beside `handleInlineFieldSave`, around line 2126; pass the new prop where `handleInlineFieldSave` is already passed to `SampleFollowupPage`)
- Modify: `src/pages/SampleFollowupPage.jsx` (add beside `handleSfInlineSave`)

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces:
  - In `DieOrderingSystem.jsx`: `handleOrderFieldsSave(order, fields): Promise<void>` where `fields` is an object of display-name → value (e.g. `{ 'Submission Date': '2026-09-04', 'Sample Status': 'Sample Submitted' }`). Patches all fields plus one change-log entry per changed field, updates local state, and shows no toast of its own — the caller owns the wording.
  - In `SampleFollowupPage.jsx`: `saveSfFields(sf, { dateField, dateValue, snakeDateField, newStatus }): Promise<void>` — routes to the right API for the row's source and writes both fields in one call.

- [ ] **Step 1: Add the multi-field order saver**

In `src/DieOrderingSystem.jsx`, immediately after the closing brace of `handleInlineFieldSave`, add:

```jsx
  // Like handleInlineFieldSave but for several fields written together, so a
  // pair that must agree (a date and the status it implies) can never be half
  // saved. Writes one change-log entry per field, matching what the audit trail
  // already records for single edits. Deliberately silent: the caller shows a
  // toast that describes the whole action.
  const handleOrderFieldsSave = async (order, fields) => {
    const changed = Object.entries(fields).filter(([field, value]) => order[field] !== value);
    if (changed.length === 0) return;

    const changeLog = changed.map(([field, value]) => ({
      date: new Date().toISOString().split('T')[0],
      field,
      oldValue: order[field] ?? '',
      newValue: value,
      changedBy: user?.username || 'unknown',
      stage: order.STATUS,
    }));

    const patch = Object.fromEntries(changed);
    await ordersAPI.patch(order.id, { ...patch, 'Change Log': changeLog });
    setData(prev => prev.map(o => (
      o.id === order.id
        ? { ...o, ...patch, changeCount: (o.changeCount || 0) + changed.length }
        : o
    )));
  };
```

It intentionally does not catch errors — the caller reports failure, so the toast wording stays in one place.

- [ ] **Step 2: Pass it to the page**

In the `<SampleFollowupPage ... />` render, immediately after the existing `handleInlineFieldSave={handleInlineFieldSave}` prop, add:

```jsx
              handleOrderFieldsSave={handleOrderFieldsSave}
```

- [ ] **Step 3: Add the page-level saver**

In `src/pages/SampleFollowupPage.jsx`, add `handleOrderFieldsSave` to the destructured props, then add this function immediately after `handleSfInlineSave`:

```jsx
  // Writes a date and (optionally) the status it implies, in one request, down
  // whichever path this row came from. `newStatus` of null means the ladder
  // refused to move the record — the date still saves.
  const saveSfFields = async (sf, { dateField, snakeDateField, dateValue, newStatus }) => {
    if (sf._source === 'order') {
      const fields = { [dateField]: dateValue };
      if (newStatus) fields['Sample Status'] = newStatus;
      await handleOrderFieldsSave(sf._order, fields);
      return;
    }
    const raw = sf._raw;
    const updated = { ...raw, [snakeDateField]: dateValue };
    if (newStatus) updated.status = newStatus;
    await sampleFollowupsAPI.update(raw.id, updated);
    setSampleFollowupsStandalone(prev => prev.map(r => (r.id === raw.id ? updated : r)));
  };
```

- [ ] **Step 4: Verify lint and build**

```bash
npx eslint src/DieOrderingSystem.jsx src/pages/SampleFollowupPage.jsx
```

Expected: no NEW errors. Both files carry pre-existing errors — `DieOrderingSystem.jsx` has 12 errors and 2 warnings, `SampleFollowupPage.jsx` has 2 errors (`useState` unused, `sampleFollowupsStandalone` unused). Compare against `git stash` if unsure. `saveSfFields` will report as unused until Task 3 calls it; that is expected at this point.

```bash
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/DieOrderingSystem.jsx src/pages/SampleFollowupPage.jsx
git commit -m "feat(sample-dates): save a date and its status in one request"
```

---

### Task 4: The Today button

**Files:**
- Create: `src/components/sample/StampTodayButton.jsx`
- Modify: `src/pages/SampleFollowupPage.jsx` (the two date `<td>` cells around lines 434-450; the modal's date fields in the field-map render)

**Interfaces:**
- Consumes: `advanceStatus` (Task 2), `saveSfFields` (Task 3), `todayLocal` (Task 1).
- Produces: `<StampTodayButton sf={} dateField="" snakeDateField="" targetStatus="" label="" currentDate={} currentStatus={} onSave={} setToast={} theme={} compact={} />`

- [ ] **Step 1: Create the component**

Create `src/components/sample/StampTodayButton.jsx`:

```jsx
import React, { useState } from 'react';
import { CalendarCheck } from 'lucide-react';
import { dialogs } from '../ui/DialogProvider';
import { advanceStatus } from '../../utils/sampleStatus';
import { todayLocal } from '../../utils/today.js';
import { formatDate } from '../../utils/helpers';

const day = (v) => (v ? String(v).slice(0, 10) : '');

// Stamps today's date on one field and advances Status when the ladder allows.
//
// The two move together or not at all: one save, and declining the overwrite
// confirm abandons both. The toast always names what happened to the status,
// including when nothing moved — otherwise a user on a Rejected record would
// assume the status followed the date.
export default function StampTodayButton({
  sf, dateField, snakeDateField, targetStatus, label,
  currentDate, currentStatus, onSave, setToast, theme, compact = false,
}) {
  const [busy, setBusy] = useState(false);

  const notify = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 5000 : 4000);
  };

  const stamp = async () => {
    const value = todayLocal();
    const existing = day(currentDate);

    if (existing && existing !== value) {
      const ok = await dialogs.confirm({
        title: `Replace the ${label.toLowerCase()}?`,
        message: `This record already has ${formatDate(existing)}. Replace it with today, ${formatDate(value)}?`,
        confirmLabel: 'Replace date',
        tone: 'warning',
      });
      if (!ok) return;
    }

    const newStatus = advanceStatus(currentStatus, targetStatus);
    setBusy(true);
    try {
      await onSave(sf, { dateField, snakeDateField, dateValue: value, newStatus });
      notify(
        newStatus
          ? `${label} set to ${formatDate(value)} — status moved to ${newStatus}`
          : `${label} set to ${formatDate(value)} — status unchanged`,
        'success'
      );
    } catch (error) {
      notify(`Failed to set ${label.toLowerCase()}: ${error.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={stamp}
      disabled={busy}
      title={`Set ${label} to today`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        padding: compact ? '4px 6px' : '8px 12px',
        background: 'rgba(8,145,178,0.15)', border: '1px solid #0891B2',
        borderRadius: '6px', color: '#0891B2', fontWeight: 600,
        fontSize: compact ? '0.7rem' : '0.8rem',
        cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      <CalendarCheck size={compact ? 12 : 14} />
      {compact ? '' : 'Today'}
    </button>
  );
}
```

In the table the button is `compact` — icon only, with the tooltip carrying the meaning — because that column is already narrow and the table scrolls horizontally as it is.

- [ ] **Step 2: Wire both table cells**

In `src/pages/SampleFollowupPage.jsx`, add the import:

```jsx
import StampTodayButton from '../components/sample/StampTodayButton';
```

Replace the Submission Date `<td>` with:

```jsx
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="date"
                            // Keyed on the value: these inputs are uncontrolled
                            // (defaultValue), so React will not refresh them when
                            // the stamp changes the underlying date. Changing the
                            // key remounts the input with the new value.
                            key={`sub-${sf.id}-${day(sf.submission_date)}`}
                            defaultValue={day(sf.submission_date)}
                            onBlur={(e) => handleSfInlineSave(sf, 'Submission Date', e.target.value)}
                            style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                          />
                          <StampTodayButton
                            sf={sf} compact
                            dateField="Submission Date" snakeDateField="submission_date"
                            targetStatus="Sample Submitted" label="Submission date"
                            currentDate={sf.submission_date} currentStatus={sf.status}
                            onSave={saveSfFields} setToast={setToast} theme={theme}
                          />
                        </div>
                      </td>
```

Replace the Sample Approval Date `<td>` with:

```jsx
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="date"
                            key={`app-${sf.id}-${day(sf.sample_approval_date)}`}
                            defaultValue={day(sf.sample_approval_date)}
                            onBlur={(e) => handleSfInlineSave(sf, 'Sample Approval Date', e.target.value)}
                            style={{ padding: '4px 6px', background: theme.inputBg || '#0F172A', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '6px', color: theme.text, fontSize: '0.8rem' }}
                          />
                          <StampTodayButton
                            sf={sf} compact
                            dateField="Sample Approval Date" snakeDateField="sample_approval_date"
                            targetStatus="Approved" label="Sample approval date"
                            currentDate={sf.sample_approval_date} currentStatus={sf.status}
                            onSave={saveSfFields} setToast={setToast} theme={theme}
                          />
                        </div>
                      </td>
```

Add the `day` helper near `extractProfile` at the top of the file:

```jsx
const day = (v) => (v ? String(v).slice(0, 10) : '');
```

- [ ] **Step 3: Wire the modal**

The modal renders its fields from a map. Inside the `.map(field => (...))` body, the `<div key={field.key}>` wraps a label and one input. Replace that opening `<div key={field.key}>` and its label with a version that appends the button for the two date fields, leaving every other field untouched:

```jsx
                <div key={field.key}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{field.label}</label>
                    {editingSampleFollowup && field.key === 'submission_date' && (
                      <StampTodayButton
                        sf={editingSampleFollowup}
                        dateField="Submission Date" snakeDateField="submission_date"
                        targetStatus="Sample Submitted" label="Submission date"
                        currentDate={sampleFollowupForm.submission_date}
                        currentStatus={sampleFollowupForm.status}
                        theme={theme} setToast={setToast}
                        onSave={async (sf, args) => {
                          await saveSfFields(sf, args);
                          setSampleFollowupForm(f => ({
                            ...f,
                            submission_date: args.dateValue,
                            status: args.newStatus || f.status,
                          }));
                        }}
                      />
                    )}
                    {editingSampleFollowup && field.key === 'sample_approval_date' && (
                      <StampTodayButton
                        sf={editingSampleFollowup}
                        dateField="Sample Approval Date" snakeDateField="sample_approval_date"
                        targetStatus="Approved" label="Sample approval date"
                        currentDate={sampleFollowupForm.sample_approval_date}
                        currentStatus={sampleFollowupForm.status}
                        theme={theme} setToast={setToast}
                        onSave={async (sf, args) => {
                          await saveSfFields(sf, args);
                          setSampleFollowupForm(f => ({
                            ...f,
                            sample_approval_date: args.dateValue,
                            status: args.newStatus || f.status,
                          }));
                        }}
                      />
                    )}
                  </div>
```

The original `<label ...>{field.label}</label>` line is replaced by the block above, so delete it. Everything after it — the `field.type === 'corrector' ? ... : ...` chain — stays exactly as it is.

The button only renders when `editingSampleFollowup` is set: on an unsaved new record there is no row to patch, exactly as the Trials section behaves.

The `onSave` wrapper writes the change through and then syncs the open form, so the modal's own date field and Status dropdown show the new values immediately rather than reverting when the user next types.

- [ ] **Step 4: Verify lint and build**

```bash
npx eslint src/components/sample/StampTodayButton.jsx src/pages/SampleFollowupPage.jsx src/utils/sampleStatus.js
```

Expected: no errors from `StampTodayButton.jsx` or `sampleStatus.js`; `SampleFollowupPage.jsx` keeps only its 2 pre-existing errors.

```bash
npm run build && npm test
```

Expected: build succeeds; the full suite passes (542 tests — 529 existing, plus 4 from Task 1 and 9 from Task 2).

- [ ] **Step 5: Commit**

```bash
git add src/components/sample/StampTodayButton.jsx src/pages/SampleFollowupPage.jsx
git commit -m "feat(sample-dates): stamp today on submission and approval dates"
```

---

## Final verification

A browser check against the local **test** server. Never quote its counts as facts about real data.

- [ ] **Rebuild the frontend**

```bash
docker compose build frontend && docker compose up -d frontend
```

- [ ] **Walk the feature** at `http://localhost` → Sample Followup:
  1. Find a record with an empty Submission Date and status Pending. Click the Today button in its row. The date fills with today, the input visibly updates, Status becomes `Sample Submitted`, and the toast says `status moved to Sample Submitted`.
  2. Click the same button again. A confirm appears naming both dates; decline it and confirm **nothing** changed.
  3. Accept it on a second try and confirm the date saves and the toast says `status unchanged` (the record is already at that stage).
  4. On that same record, click the Sample Approval Date button. Status advances to `Approved`.
  5. Click the Submission Date button on that Approved record. The date saves and the toast says `status unchanged` — Status stays `Approved`.
  6. Set a record's Status to `Rejected` by hand, then click either Today button. The date saves; Status stays `Rejected`; the toast says `status unchanged`.
  7. Open a record with the eye icon and repeat step 1 from inside the modal. The modal's date field and Status dropdown both update without closing it.

- [ ] **Confirm the audit trail recorded both fields**

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT id, die_no, submission_date, sample_status, change_log FROM die_orders ORDER BY updated_at DESC LIMIT 3;"
```

Expected: the record you just stamped is top of the list, with the date and status both updated, and `change_log` carrying one entry per changed field.

The `MSYS_NO_PATHCONV=1` prefix is required from Git Bash, or it rewrites `/var/run/postgresql` into a Windows path and psql fails to resolve the host. The explicit `-h` is also required: the db container inherits a stale `PGHOST` from `.env`, which sends a bare `psql` out over TCP into the password-checking rule.

- [ ] **Restore any record you changed** to the values it had before, by id. Never an unscoped `UPDATE`. Note the original values before you start, and ask before touching anything you did not create.
