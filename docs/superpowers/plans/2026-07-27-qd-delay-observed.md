# QD "Any Delay Observed" — Yes/No with details — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the free-text "Any Delay Observed" billet field into a Yes/No choice that reveals a details box when the answer is Yes, and print the answer on the QD PDF.

**Architecture:** The answer stays in the existing `qd_billet_parameters.any_delay_observed` column (now holding only `Yes`/`No`); a new sibling column `any_delay_details` holds the explanation. Both are per billet (`first`/`last`), exactly as today. The server needs no route changes — one shared `BILLET_COLS` array drives the upsert. The PDF gains one wrapped line under the Production Parameters table, built by a pure exported helper so it can be unit-tested without parsing a PDF.

**Tech Stack:** Node + Express + node-postgres (CommonJS `.cjs` on the server), React 18 with inline styles (no CSS framework), pdf-lib for the PDF, `node:test` + `node:assert/strict` for tests.

**Spec:** [docs/superpowers/specs/2026-07-27-qd-delay-observed-design.md](../specs/2026-07-27-qd-delay-observed-design.md)

## Global Constraints

- Server files are CommonJS `.cjs` with `'use strict';` at the top.
- Tests use Node's built-in runner: `node --test`. There is no Jest/Vitest. Service tests mock the `pg` client as `{ query: async (sql, params) => ... }` — they never touch a real database.
- There is **no frontend component test framework.** Frontend changes are verified with `npm run lint` and `npm run build` only.
- Every schema change goes in **two** places: an idempotent `DO $$ ... IF NOT EXISTS ... $$` block in `server/db.cjs` (runs on every backend boot) **and** the matching `CREATE TABLE` in `init.sql` (fresh installs only).
- `any_delay_observed` must stay nullable with **no CHECK constraint** — four existing rows hold legacy `YES`/`NO` in the wrong casing and must keep saving.
- Strings drawn into the PDF pass through `sanitize()`, which is WinAnsi-only. Use ASCII `-` and the middle dot `·` (U+00B7, code 183 — WinAnsi-safe); an em dash `—` would be rewritten to `-` anyway.
- `npm test` runs the whole server suite; it must be green before every commit.

---

## File Structure

| File | Change | Responsibility |
| --- | --- | --- |
| `server/db.cjs` | Modify (after line 556) | Idempotent migration adding `any_delay_details` |
| `init.sql` | Modify (line 434) | Same column for fresh installs |
| `server/services/qualityDiscrepancies.cjs` | Modify (line 206-207) | Add the column to `BILLET_COLS` |
| `server/services/qualityDiscrepancies.test.cjs` | Modify (append) | Round-trip + not-empty tests |
| `server/services/qdPdf.cjs` | Modify (~line 105, helpers, exports) | `buildDelayLine()` + draw it |
| `server/services/qdPdf.test.cjs` | Modify (append) | `buildDelayLine()` unit tests |
| `src/components/qd/RaiseQDModal.jsx` | Modify (lines 19, ~128, 388-395) | Yes/No pills + conditional details box |

---

### Task 1: Store the delay details

**Files:**
- Modify: `server/db.cjs:556`
- Modify: `init.sql:434`
- Modify: `server/services/qualityDiscrepancies.cjs:206-207`
- Test: `server/services/qualityDiscrepancies.test.cjs` (append at end)

**Interfaces:**
- Consumes: nothing.
- Produces: the column name `any_delay_details` on `qd_billet_parameters`, and its presence in the exported `saveBilletParameters(client, qdId, params)` upsert. Tasks 2 and 3 read `billet.any_delay_details`.

- [ ] **Step 1: Write the failing tests**

Append to `server/services/qualityDiscrepancies.test.cjs`:

```js
test('saveBilletParameters persists the delay details alongside the Yes/No answer', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 7, {
    first: { any_delay_observed: 'Yes', any_delay_details: 'press held 20 min for billet change' },
    last: {},
  });
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.ok(up, 'first billet should be upserted');
  assert.match(up.sql, /any_delay_details/);
  assert.match(up.sql, /any_delay_details = EXCLUDED\.any_delay_details/);
  assert.ok(up.params.includes('press held 20 min for billet change'));
});

test('a billet carrying only delay details is kept, not deleted as empty', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 1 }; } };
  await q.saveBilletParameters(client, 8, { first: { any_delay_details: 'waiting on the press log' }, last: {} });
  const del = calls.find(c => /DELETE FROM qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  const up = calls.find(c => /INSERT INTO qd_billet_parameters/.test(c.sql) && c.params.includes('first'));
  assert.equal(del, undefined, 'a details-only billet must not be deleted as empty');
  assert.ok(up, 'a details-only billet should be upserted so it can be corrected');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/qualityDiscrepancies.test.cjs`

Expected: FAIL — the first test fails on `assert.match(up.sql, /any_delay_details/)` because `BILLET_COLS` does not contain the column. The second fails because `hasAnyValue` sees no known column with a value, so the billet is deleted and `up` is `undefined`.

- [ ] **Step 3: Add the column to the shared column list**

In `server/services/qualityDiscrepancies.cjs`, replace lines 206-207:

```js
const BILLET_COLS = ['die_soaking_hours','die_temperature','billet_temp','breakthrough_pressure',
  'running_pressure','billet_length','alloy','ram_speed','any_delay_observed','any_delay_details'];
```

This one array drives the INSERT column list, the `ON CONFLICT DO UPDATE` set and `hasAnyValue`, so nothing else in the service changes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/qualityDiscrepancies.test.cjs`
Expected: PASS — all tests in the file, including the two new ones.

- [ ] **Step 5: Add the migration**

In `server/db.cjs`, immediately after line 556 (`CREATE INDEX IF NOT EXISTS idx_qd_billet_qd ON qd_billet_parameters (qd_id);`), insert:

```sql
      -- Delay explanation. Split out of any_delay_observed, which now holds only
      -- Yes/No; the two need to coexist so the answer stays filterable.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='qd_billet_parameters' AND column_name='any_delay_details') THEN
          ALTER TABLE qd_billet_parameters ADD COLUMN any_delay_details TEXT;
        END IF;
      END $$;
```

- [ ] **Step 6: Mirror it in init.sql**

In `init.sql`, change line 434 from:

```sql
    any_delay_observed   TEXT,
```

to:

```sql
    any_delay_observed   TEXT,
    any_delay_details    TEXT,
```

- [ ] **Step 7: Apply the migration and confirm the column exists**

Run:

```bash
docker compose build backend && docker compose up -d backend && sleep 12 && MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "\d qd_billet_parameters"
```

Expected: the table listing includes `any_delay_details | text`.

Two things this command gets right that the obvious version does not. `docker compose restart backend` is **not** enough — `Dockerfile.backend` copies the source in and the service has no bind-mount for `server/` (only the storage volumes), so a restart re-runs the old `db.cjs` and the column never appears. And `-h /var/run/postgresql` is required, because the db container inherits a stale `PGHOST` from `.env`, so a bare `psql` goes out over TCP into the scram rule and fails to authenticate.

- [ ] **Step 8: Run the full server suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 9: Commit**

```bash
git add server/db.cjs init.sql server/services/qualityDiscrepancies.cjs server/services/qualityDiscrepancies.test.cjs
git commit -m "feat(qd): any_delay_details column stored per billet"
```

---

### Task 2: Print the delay answer on the QD PDF

**Files:**
- Modify: `server/services/qdPdf.cjs` (helpers section ~line 143, draw site ~line 105, exports at end)
- Test: `server/services/qdPdf.test.cjs` (append at end)

**Interfaces:**
- Consumes: `billet.any_delay_observed` and `billet.any_delay_details` from Task 1.
- Produces: `buildDelayLine(billets) -> string`, exported from `qdPdf.cjs`. Takes the same `billets` array `generateQdPdf` already receives (`[{ billet: 'first'|'last', ... }]`) and returns the line to draw, or `''` when there is nothing to say.

- [ ] **Step 1: Write the failing tests**

Append to `server/services/qdPdf.test.cjs`:

```js
test('buildDelayLine renders each billet that has an answer', () => {
  assert.equal(
    buildDelayLine([
      { billet: 'first', any_delay_observed: 'No' },
      { billet: 'last', any_delay_observed: 'Yes', any_delay_details: 'press held 20 min for billet change' },
    ]),
    'Delay observed - 1st billet: No · Last billet: Yes - press held 20 min for billet change'
  );
});

test('buildDelayLine is empty when neither billet answered, so existing PDFs are unchanged', () => {
  assert.equal(buildDelayLine([]), '');
  assert.equal(buildDelayLine([{ billet: 'first', billet_temp: '502' }]), '');
  assert.equal(buildDelayLine([{ billet: 'first', any_delay_observed: '   ' }]), '');
});

test('buildDelayLine drops details under a No and tolerates legacy uppercase', () => {
  assert.equal(
    buildDelayLine([{ billet: 'first', any_delay_observed: 'NO', any_delay_details: 'stale note' }]),
    'Delay observed - 1st billet: NO'
  );
  assert.equal(
    buildDelayLine([{ billet: 'last', any_delay_observed: 'YES', any_delay_details: 'die change' }]),
    'Delay observed - Last billet: YES - die change'
  );
});
```

Also change the import at the top of the file (line 5) from:

```js
const { generateQdPdf } = require('./qdPdf.cjs');
```

to:

```js
const { generateQdPdf, buildDelayLine } = require('./qdPdf.cjs');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/qdPdf.test.cjs`
Expected: FAIL with `TypeError: buildDelayLine is not a function` — it is not exported yet.

- [ ] **Step 3: Write the helper**

In `server/services/qdPdf.cjs`, in the helpers section immediately after `drawWrapped` (after line 153), add:

```js
// The delay answer as one line for under the Production Parameters table.
// Returns '' when neither billet answered, so QDs raised before this field
// existed render exactly as they did before.
const BILLET_LABEL = { first: '1st billet', last: 'Last billet' };

function buildDelayLine(billets = []) {
  const parts = [];
  for (const which of ['first', 'last']) {
    const b = (billets || []).find((x) => x.billet === which);
    const answer = t(b?.any_delay_observed).trim();
    if (!answer) continue;
    const details = t(b?.any_delay_details).trim();
    // Legacy rows hold 'YES'/'NO'; print them as stored but match case-insensitively.
    const showDetails = answer.toLowerCase() === 'yes' && details;
    parts.push(`${BILLET_LABEL[which]}: ${answer}${showDetails ? ` - ${details}` : ''}`);
  }
  return parts.length ? `Delay observed - ${parts.join(' · ')}` : '';
}
```

- [ ] **Step 4: Export it**

Change the last line of `server/services/qdPdf.cjs` from:

```js
module.exports = { generateQdPdf };
```

to:

```js
module.exports = { generateQdPdf, buildDelayLine };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test server/services/qdPdf.test.cjs`
Expected: PASS — all tests in the file.

- [ ] **Step 6: Draw the line in the PDF**

In `server/services/qdPdf.cjs`, replace line 105 (`  y -= 8;`, the line between the billet `for` loop and the `// Quality Discrepancy description (wrapped)` comment) with:

```js
  y -= 8;

  // One wrapped line rather than a tenth column in the table above, which would
  // squeeze all nine existing columns below legibility. drawWrapped (unlike
  // text) does not truncate, so a long explanation flows onto further lines.
  const delayLine = buildDelayLine(billets);
  if (delayLine) {
    y = drawWrapped(page, font, delayLine, M, y, 535, 8);
    y -= 6;
  }
```

- [ ] **Step 7: Verify the PDF still renders**

Run: `node --test server/services/qdPdf.test.cjs`
Expected: PASS — including `generateQdPdf returns a non-empty PDF for a fully-populated QD`, which now exercises the draw site through `billets`.

- [ ] **Step 8: Run the full server suite**

Run: `npm test`
Expected: PASS, no failures.

- [ ] **Step 9: Commit**

```bash
git add server/services/qdPdf.cjs server/services/qdPdf.test.cjs
git commit -m "feat(qd): print the delay observed answer on the QD PDF"
```

---

### Task 3: Yes/No control with a conditional details box

**Files:**
- Modify: `src/components/qd/RaiseQDModal.jsx:19` (field descriptor)
- Modify: `src/components/qd/RaiseQDModal.jsx:128-129` (state helpers)
- Modify: `src/components/qd/RaiseQDModal.jsx:388-395` (grid renderer)

**Interfaces:**
- Consumes: `any_delay_details` from Task 1. Both the create path (line 209, `billets`) and `buildEditPayload` (line 174, `billets`) already send the whole `billets` object, so the new key reaches the server with no API change.
- Produces: nothing other tasks depend on.

There is no frontend test framework, so this task is verified by lint, build, and driving the real form.

- [ ] **Step 1: Mark the field as a Yes/No question**

In `src/components/qd/RaiseQDModal.jsx`, replace line 19:

```js
  { key: 'any_delay_observed', label: 'Any Delay Observed', type: 'yesNo', detailsKey: 'any_delay_details' },
```

- [ ] **Step 2: Add the state helpers**

Immediately after `setBilletField` (after line 129), add:

```js
  // Rows created while this was a free-text box hold 'YES'/'NO', so match
  // case-insensitively; the canonical 'Yes'/'No' is what gets written back.
  const normalizeYesNo = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    return s === 'yes' ? 'Yes' : s === 'no' ? 'No' : '';
  };

  // Answering 'No' clears the details — an explanation must never outlive the
  // 'Yes' it belonged to.
  const setBilletYesNo = (which, bf) => (v) =>
    setBillets((prev) => ({
      ...prev,
      [which]: { ...prev[which], [bf.key]: v, ...(v === 'Yes' ? null : { [bf.detailsKey]: '' }) },
    }));
```

- [ ] **Step 3: Render the control**

Replace lines 388-395 (the `BILLET_FIELDS.map(...)` block inside the Production parameters grid) with:

```jsx
                  {BILLET_FIELDS.map((bf) => {
                    const answer = bf.type === 'yesNo' ? normalizeYesNo(billets[which]?.[bf.key]) : null;
                    return (
                      // A Yes/No plus its details box cannot fit a 130px grid
                      // cell, so this field takes the whole row.
                      <div key={bf.key} style={bf.type === 'yesNo' ? { ...group, gridColumn: '1 / -1' } : group}>
                        <label style={{ ...label, fontSize: '0.65rem' }}>{bf.label}</label>
                        {bf.type === 'yesNo' ? (
                          <>
                            {yesNo(answer, setBilletYesNo(which, bf))}
                            {answer === 'Yes' && (
                              <textarea value={billets[which]?.[bf.detailsKey] || ''}
                                onChange={setBilletField(which, bf.detailsKey)} rows={2}
                                placeholder="What was the delay?"
                                style={{ ...field, marginTop: 8, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
                            )}
                          </>
                        ) : bf.key === 'alloy' ? (
                          optionSelect(alloyOptions, billets[which]?.alloy, setBilletField(which, 'alloy'))
                        ) : (
                          <input value={billets[which]?.[bf.key] || ''} onChange={setBilletField(which, bf.key)} style={field} />
                        )}
                      </div>
                    );
                  })}
```

- [ ] **Step 4: Lint**

Run: `npx eslint src/components/qd/RaiseQDModal.jsx`
Expected: no new errors. The repo has 82 pre-existing lint errors elsewhere; this file must contribute none.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `✓ built in ...`, no errors. (The "chunks larger than 500 kB" warning is pre-existing.)

- [ ] **Step 6: Deploy and drive the real form**

Run:

```bash
docker compose build frontend && docker compose up -d frontend
```

Then in the browser at `http://localhost/`, on the QD Tracker page:
1. Raise a QD, open **Production parameters**.
2. On **1st Billet** pick **No** — no details box appears.
3. On **Last Billet** pick **Yes** — a details box appears; type `press held 20 min for billet change`.
4. Switch Last Billet to **No** — the details box disappears; switch back to **Yes** — it is empty, not the old text.
5. Set it back to **Yes** with the text, save as draft, reopen the draft for editing — both answers and the details survive.
6. Confirm with:

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT billet, any_delay_observed, any_delay_details FROM qd_billet_parameters ORDER BY qd_id DESC, billet LIMIT 4;"
```

Expected: the newest rows show `Yes` / the typed details, and `No` / empty.

7. Open one of the four pre-existing QDs that hold legacy `YES`/`NO` for edit and confirm the pill shows as selected rather than blank.

- [ ] **Step 7: Commit**

```bash
git add src/components/qd/RaiseQDModal.jsx
git commit -m "feat(qd): Yes/No delay question with a conditional details box"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| Data model — `any_delay_details` column, db.cjs + init.sql, no CHECK | Task 1, Steps 5-6 |
| Server — `BILLET_COLS`, `hasAnyValue` keeps details-only rows | Task 1, Steps 1-4 |
| Form — full-row span, `yesNo` pills, case-insensitive read, Yes reveals details, No clears them | Task 3, Steps 1-3 |
| PDF — wrapped line under the table, omit unanswered billets, nothing drawn when neither answered | Task 2 |
| Testing — service round-trip, details-only not deleted, PDF line present/absent, lint + build + browser | Task 1 Step 1, Task 2 Step 1, Task 3 Steps 4-6 |
| Out of scope — no tracker column, no CSV, no filtering, no backfill | Nothing in any task touches these |

**Type consistency:** `buildDelayLine` is named identically in Task 2 Steps 1, 3, 4 and 6. `normalizeYesNo` and `setBilletYesNo` are defined in Task 3 Step 2 and used in Step 3. `bf.detailsKey` is set in Step 1 and read in Steps 2 and 3. The column name `any_delay_details` is identical across Tasks 1, 2 and 3.
