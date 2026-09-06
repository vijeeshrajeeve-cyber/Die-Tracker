# Skip Trial on Die Receipt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Confirm Die Receivance modal mark Tooling and Backup dies as having skipped the sample trial, stamping the sample fields at receipt so they land on the Sample Followup page as Approved.

**Architecture:** The patch the modal sends today is lifted out of the click handler in `src/pages/FlowPage.jsx` into a pure module `src/utils/dieReceivance.js`, which also decides whether the option is shown and what its default is. The modal gains one checkbox row and one form key. No server, schema, or Sample Followup page changes.

**Tech Stack:** React 18 + Vite frontend, `node:test` for the pure module (`npm test` already globs `src/**/*.test.js`). Spec: `docs/superpowers/specs/2026-09-06-skip-trial-on-receipt-design.md`.

## Global Constraints

- Option is shown only when `order.TYPE` is `'T'` (Tooling) or `'B'` (Backup). `'N'` never sees it.
- Default: checked for `'T'`, unchecked for `'B'`. Seeded when the modal opens for an order, not on every render.
- When checked the patch carries exactly: `'Submission Date'` = received date, `'Sample Approval Date'` = received date, `'No of Trial'` = `0`, `'Sample Status'` = `'Approved'`.
- Change-log reason when checked: `Corrector: <name> · Trial skipped (Tooling)` or `... (Backup)`. Unchecked: `Corrector: <name>`.
- No new column, endpoint, or persisted flag.
- Work on a feature branch `feat/skip-trial-on-receipt` off `main`.
- Frontend verification is `npx eslint <changed files>` plus `npm run build`; `npm run lint` fails on 77 pre-existing problems and must not be used as a gate.

---

### Task 1: Pure receivance module with tests

**Files:**
- Create: `src/utils/dieReceivance.js`
- Test: `src/utils/dieReceivance.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `skipTrialAllowed(type: string | undefined): boolean`
  - `skipTrialDefault(type: string | undefined): boolean`
  - `buildReceivancePatch({ order, form, skipTrial }): { patch, logEntry }` where `form` is `{ die_received_date: string, corrector: string }`, `patch` is the object to send to `ordersAPI.patch`, and `patch['Change Log']` is `[logEntry]`.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/skip-trial-on-receipt main
```

- [ ] **Step 2: Write the failing tests**

Create `src/utils/dieReceivance.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { skipTrialAllowed, skipTrialDefault, buildReceivancePatch } from './dieReceivance.js';

const order = {
  id: 7,
  'DIE NO': 'ABC-1',
  TYPE: 'T',
  STATUS: 'DONE',
  Plant: 'GEX 1',
  Press: '',
  'Ascona Reference': '',
  'Sample Status': '',
};
const form = { die_received_date: '2026-09-06', corrector: '  Ravi  ' };

test('skip trial is allowed for Tooling and Backup only', () => {
  assert.equal(skipTrialAllowed('T'), true);
  assert.equal(skipTrialAllowed('B'), true);
  assert.equal(skipTrialAllowed('N'), false);
  assert.equal(skipTrialAllowed(undefined), false);
  assert.equal(skipTrialAllowed(''), false);
});

test('skip trial defaults on for Tooling and off for everything else', () => {
  assert.equal(skipTrialDefault('T'), true);
  assert.equal(skipTrialDefault('B'), false);
  assert.equal(skipTrialDefault('N'), false);
  assert.equal(skipTrialDefault(undefined), false);
});

test('unchecked patch is the plain receipt', () => {
  const { patch, logEntry } = buildReceivancePatch({ order, form, skipTrial: false });
  assert.deepEqual(patch, {
    STATUS: 'DIE RECEIVED',
    'Die Received Date': '2026-09-06',
    'Corrector': 'Ravi',
    'Press': 'GEX 1',
    'Ascona Reference': 'No',
    'Sample Status': 'Pending',
    'Change Log': [logEntry],
  });
  assert.deepEqual(logEntry, {
    date: '2026-09-06',
    field: 'STATUS',
    oldValue: 'DONE',
    newValue: 'DIE RECEIVED',
    stage: 'DONE',
    reason: 'Corrector: Ravi',
  });
});

test('unchecked patch keeps an existing sample status, press and Ascona reference', () => {
  const existing = { ...order, Press: 'P2', 'Ascona Reference': 'Yes', 'Sample Status': 'On hold' };
  const { patch } = buildReceivancePatch({ order: existing, form, skipTrial: false });
  assert.equal(patch['Sample Status'], 'On hold');
  assert.equal(patch['Press'], 'P2');
  assert.equal(patch['Ascona Reference'], 'Yes');
  assert.equal('Submission Date' in patch, false);
  assert.equal('Sample Approval Date' in patch, false);
  assert.equal('No of Trial' in patch, false);
});

test('checked patch stamps the sample fields at the received date', () => {
  const { patch, logEntry } = buildReceivancePatch({ order, form, skipTrial: true });
  assert.equal(patch['Submission Date'], '2026-09-06');
  assert.equal(patch['Sample Approval Date'], '2026-09-06');
  assert.equal(patch['No of Trial'], 0);
  assert.equal(patch['Sample Status'], 'Approved');
  assert.equal(patch['Die Received Date'], '2026-09-06');
  assert.equal(patch.STATUS, 'DIE RECEIVED');
  assert.equal(logEntry.reason, 'Corrector: Ravi · Trial skipped (Tooling)');
  assert.deepEqual(patch['Change Log'], [logEntry]);
});

test('checked patch names Backup in the reason for a B die', () => {
  const { logEntry } = buildReceivancePatch({ order: { ...order, TYPE: 'B' }, form, skipTrial: true });
  assert.equal(logEntry.reason, 'Corrector: Ravi · Trial skipped (Backup)');
});

test('checked patch overrides an existing sample status', () => {
  const held = { ...order, 'Sample Status': 'On hold' };
  const { patch } = buildReceivancePatch({ order: held, form, skipTrial: true });
  assert.equal(patch['Sample Status'], 'Approved');
});

test('skip is ignored for a New die even if asked for', () => {
  const { patch, logEntry } = buildReceivancePatch({ order: { ...order, TYPE: 'N' }, form, skipTrial: true });
  assert.equal('Submission Date' in patch, false);
  assert.equal(patch['Sample Status'], 'Pending');
  assert.equal(logEntry.reason, 'Corrector: Ravi');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
node --test src/utils/dieReceivance.test.js
```

Expected: fails with `Cannot find module` for `./dieReceivance.js`.

- [ ] **Step 4: Write the module**

Create `src/utils/dieReceivance.js`:

```js
// What the Confirm Die Receivance modal sends, and whether it may offer to
// skip the sample trial.
//
// Tooling and some Backup dies are fit for use the moment they arrive, so the
// receipt can stamp the sample fields straight away instead of leaving the
// die Pending on the Sample Followup page for someone to close by hand. The
// option is a per-die human choice, which is why it lives in the form rather
// than as a server rule: Tooling defaults on, Backup defaults off, New dies
// never see it. Nothing is persisted beyond the stamped fields and the
// change-log reason — zero logged trials plus Approved is what a skipped die
// looks like, and the audit entry says why.

const TYPE_LABELS = { T: 'Tooling', B: 'Backup', N: 'New' };

export const skipTrialAllowed = (type) => type === 'T' || type === 'B';

export const skipTrialDefault = (type) => type === 'T';

export const buildReceivancePatch = ({ order, form, skipTrial }) => {
  const date = form.die_received_date;
  const corrector = (form.corrector || '').trim();
  const skipping = !!skipTrial && skipTrialAllowed(order.TYPE);
  const reason = skipping
    ? `Corrector: ${corrector} · Trial skipped (${TYPE_LABELS[order.TYPE]})`
    : `Corrector: ${corrector}`;

  const logEntry = {
    date,
    field: 'STATUS',
    oldValue: order.STATUS,
    newValue: 'DIE RECEIVED',
    stage: order.STATUS,
    reason,
  };

  const patch = {
    STATUS: 'DIE RECEIVED',
    'Die Received Date': date,
    'Corrector': corrector,
    'Press': order['Press'] || order.Plant || '',
    'Ascona Reference': order['Ascona Reference'] || 'No',
    'Sample Status': order['Sample Status'] || 'Pending',
    'Change Log': [logEntry],
  };

  if (skipping) {
    patch['Submission Date'] = date;
    patch['Sample Approval Date'] = date;
    patch['No of Trial'] = 0;
    patch['Sample Status'] = 'Approved';
  }

  return { patch, logEntry };
};
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test src/utils/dieReceivance.test.js
```

Expected: 8 passing, 0 failing.

- [ ] **Step 6: Run the full suite and lint the new files**

```bash
npm test
npx eslint src/utils/dieReceivance.js src/utils/dieReceivance.test.js
```

Expected: all tests pass; eslint prints nothing.

- [ ] **Step 7: Commit**

```bash
git add src/utils/dieReceivance.js src/utils/dieReceivance.test.js
git commit -m "feat(skip-trial): pure receivance patch builder with skip-trial rule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Wire the modal to the module and add the checkbox

**Files:**
- Modify: `src/pages/FlowPage.jsx` (imports near the top; form state at line 88; Confirm-row button at line 405; modal body lines 445–461; Confirm click handler lines 466–498)

**Interfaces:**
- Consumes from Task 1: `skipTrialAllowed(type)`, `skipTrialDefault(type)`, `buildReceivancePatch({ order, form, skipTrial })`.
- Produces: nothing downstream.

- [ ] **Step 1: Import the module**

Find the existing import block in `src/pages/FlowPage.jsx` that pulls from `../utils/...` (search for `from '../utils/today'`) and add alongside it:

```js
import { skipTrialAllowed, skipTrialDefault, buildReceivancePatch } from '../utils/dieReceivance';
```

- [ ] **Step 2: Add the form key**

Line 88 currently reads:

```js
const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '' });
```

Change to:

```js
const [dieReceivanceForm, setDieReceivanceForm] = useState({ die_received_date: '', corrector: '', skip_trial: false });
```

- [ ] **Step 3: Seed the default when the modal opens**

Line 405's Confirm-row button has this `onClick`:

```js
onClick={(e) => { e.stopPropagation(); setDieReceivanceOrder(order); setDieReceivanceForm({ die_received_date: todayLocal(), corrector: '' }); }}
```

Change the form seed to:

```js
onClick={(e) => { e.stopPropagation(); setDieReceivanceOrder(order); setDieReceivanceForm({ die_received_date: todayLocal(), corrector: '', skip_trial: skipTrialDefault(order.TYPE) }); }}
```

- [ ] **Step 4: Render the checkbox row**

Inside the modal, the fields live in a `<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>` holding the date field and the corrector field (lines 445–461). Immediately after the corrector field's closing `</div>` and before that flex column's closing `</div>`, insert:

```jsx
{skipTrialAllowed(dieReceivanceOrder.TYPE) && (
  <label htmlFor="flowpage-skip-trial" style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '10px 12px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: '8px', cursor: 'pointer' }}>
    <input
      id="flowpage-skip-trial"
      type="checkbox"
      checked={!!dieReceivanceForm.skip_trial}
      onChange={(e) => setDieReceivanceForm({ ...dieReceivanceForm, skip_trial: e.target.checked })}
      style={{ marginTop: '2px', accentColor: '#22C55E' }}
    />
    <span>
      <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>Skip trial</span>
      <span style={{ display: 'block', fontSize: '0.75rem', color: theme.textMuted, marginTop: '2px' }}>Sample marked submitted and approved on the received date, with no trials.</span>
    </span>
  </label>
)}
```

- [ ] **Step 5: Replace the inline patch construction with the module**

The Confirm button's `onClick` (lines 466–498) currently builds `dieReceivanceLog` and `patch` inline. Replace the whole `try` block (including its `catch`) with:

```js
try {
  const { patch } = buildReceivancePatch({ order: dieReceivanceOrder, form: dieReceivanceForm, skipTrial: dieReceivanceForm.skip_trial });
  await ordersAPI.patch(dieReceivanceOrder.id, patch);
  setData(prev => prev.map(o => o.id === dieReceivanceOrder.id ? {
    ...o, ...patch, changeCount: (o.changeCount || 0) + 1,
  } : o));
  const skipped = 'Submission Date' in patch;
  setDieReceivanceOrder(null);
  setToast({ message: `Die ${dieReceivanceOrder['DIE NO']} confirmed${skipped ? ', trial skipped' : ''} & moved to Sample Followup`, type: 'success' });
  setActiveTab('flow-sample-followup');
  setTimeout(() => setToast(null), 3000);
} catch (error) {
  setToast({ message: 'Failed to confirm: ' + error.message, type: 'error' });
  setTimeout(() => setToast(null), 5000);
}
```

The two validation `if` lines above the `try` (empty date, empty corrector) stay as they are.

- [ ] **Step 6: Lint and build**

```bash
npx eslint src/pages/FlowPage.jsx
npm run build
```

Expected: eslint prints nothing for this file; build finishes with no errors. (Do not use `npm run lint` as the gate; it fails on 77 pre-existing problems.)

- [ ] **Step 7: Run the test suite**

```bash
npm test
```

Expected: all passing.

- [ ] **Step 8: Commit**

```bash
git add src/pages/FlowPage.jsx
git commit -m "feat(skip-trial): offer to skip the sample trial when receiving Tooling and Backup dies

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Browser verification on the test server

**Files:**
- Modify (temporarily): `vite.config.js` — the `/api` proxy target, reverted before commit.

**Interfaces:** none.

- [ ] **Step 1: Point the dev proxy at nginx**

In `vite.config.js` change the `/api` proxy target from `http://localhost:3001` to `http://localhost:80` (port 3001 is not published by compose; nginx on 80 proxies `/api/` to the backend).

- [ ] **Step 2: Start the dev server and log in**

Use the Browser pane's `preview_start` with the project's Vite dev entry from `.claude/launch.json` (create it if missing: `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`, `port: 5173`). Log in with the credentials the user uses on the test server; do not brute-force (the account locks after ~5 failures).

- [ ] **Step 3: Check the three type cases**

On the Flow page, open Confirm Die Receivance for:
- a Tooling die (`TYPE` `T`): the Skip trial row is present and ticked;
- a Backup die (`TYPE` `B`): present and clear;
- a New die (`TYPE` `N`): the row is absent.

Use `read_page` to confirm the checkbox state rather than relying on a screenshot. If no die of a given type sits in a done stage on the test server, note the case as unverified in the final report rather than inventing data.

- [ ] **Step 4: Confirm a ticked Tooling die and check Sample Followup**

Confirm receipt with the box ticked. On the Sample Followup page the row shows status `Approved`, Submission Date and Sample Approval Date equal to the received date, and `0` in No. of Trial in normal (not italic) style. Open the row's change log and confirm the reason reads `Corrector: <name> · Trial skipped (Tooling)`.

- [ ] **Step 5: Take a screenshot of the modal for the user**

`computer {action: "screenshot"}` with the Tooling modal open and the row visible.

- [ ] **Step 6: Revert the proxy**

```bash
git checkout -- vite.config.js
git status
```

Expected: the proxy edit is gone and the tree is clean.

---

### Task 4: Finish the branch

- [ ] **Step 1: Confirm tests and build one last time**

```bash
npm test
npm run build
```

- [ ] **Step 2: Merge into main**

```bash
git checkout main
git merge --no-ff feat/skip-trial-on-receipt -m "Merge branch 'feat/skip-trial-on-receipt' into main"
```

Pushing is blocked on this machine (git authenticates as a different GitHub user than the repo owner); leave the merge local and tell the user.
