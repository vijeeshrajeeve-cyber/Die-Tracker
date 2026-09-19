# Import Existing QD Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin upload an old, already-issued QD form (PDF). The app pre-fills what it can read, the admin completes it, and it is saved as an Approved, **Imported** QD whose document is the original PDF. An admin-only Undo import removes a wrong import.

**Architecture:** A pure text parser (`src/utils/qdFormText.js`) reads labelled fields out of pdfjs text in the browser. A new server service (`server/services/qdImport.cjs`) validates the input and creates the QD inside one transaction. It reuses `createQD` and `updateStatus`, so imported QDs obey the same status and FOC round rules. `qdDocument.buildQdPdfBytes` returns the stored original for imported QDs, which covers download, preview and email attachments in one place.

**Tech Stack:** Node 24 / Express 5 / pg / multer (backend, CommonJS `.cjs`), React 19 + Vite (frontend, ESM), pdfjs-dist (browser text extraction), `node:test` for all tests.

**Spec:** `docs/superpowers/specs/2026-09-19-qd-import-existing-design.md`

## Global Constraints

- Admin-only everywhere: the server uses `adminMiddleware` from `server/routes/auth.cjs`; the client shows the controls only when `role === 'admin'`.
- Imported QDs: `approval_state = 'Approved'`, `imported = true`, and `submitted_*` / `approved_*` / `assigned_approver` stay `NULL`. They never trigger the Purchase email.
- The QD keeps the number printed on the form. Uniqueness is case-insensitive.
- An imported QD's document is **always the stored original PDF**. Never redraw it and never fall back to a redrawn form.
- File category for the original: exactly `original_form`. `POST /:id/files` must NOT accept it.
- Status reason written at import: exactly `Status at import`.
- The raised, closed and received dates may not be in the future; the ETA may. The closed and received dates may not be before the raised date.
- Plant options are the same as the Raise form: `GEX 2`, `GEX 1`.
- The local Docker stack is a **test server**. Delete test data only by the ids you created.
- Backend image: `docker compose build <svc> && docker compose up -d <svc>`. A restart does NOT pick up source edits.
- Lint: `npm run lint` has ~77 pre-existing failures. Lint only your own files with `npx eslint <files>`, then run `npm run build` separately.
- End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Map

| File | Change | Responsibility |
|---|---|---|
| `src/utils/qdFormText.js` | create | Pure: pdfjs items → text → labelled fields |
| `src/utils/qdFormText.test.js` | create | Parser tests against the real sample's text |
| `server/services/qdImport.cjs` | create | Validate, insert, attach original, undo |
| `server/services/qdImport.test.cjs` | create | Service tests with a fake pg client |
| `server/db.cjs`, `init.sql` | modify | `imported` column |
| `server/services/qdDocument.cjs` | modify | Serve the original for imported QDs |
| `server/services/qdDocument.test.cjs` | create | Original vs redrawn document |
| `server/routes/quality-discrepancies.cjs` | modify | `GET /exists`, `POST /import`, `DELETE /:id/import`, document 404 |
| `src/api.js`, `src/api.test.js` | modify | `importExisting`, `qdNoExists`, `undoImport` |
| `src/utils/constants.js` | modify | `QD_IMPORTED_BADGE` |
| `src/components/qd/ImportQDModal.jsx` | create | Upload + pre-fill + complete + save |
| `src/pages/QDTrackerPage.jsx` | modify | Admin button, lazy modal, Imported pill |
| `server/services/qualityDiscrepancies.cjs` | modify | `category` in the listed files |
| `src/components/qd/QDDetailPanel.jsx` | modify | Imported badge, "Original QD form" chip, Undo import |

---

### Task 1: PDF text parser

**Files:**
- Create: `src/utils/qdFormText.js`
- Test: `src/utils/qdFormText.test.js`

**Interfaces:**
- Produces:
  - `qdFormTextFromItems(pages: Array<Array<{str: string, hasEOL?: boolean}>>): string`
  - `parseQdFormText(text: string): { qdNo, raisedDate, supplierCode, profileNo, dieSuffix, issue, recommendedAction, preparedBy, authorizedBy }`. All are strings; `''` when not found.
  - `parseFormDate(raw: string): string` ('YYYY-MM-DD' or '')
  - `joinWrappedLines(raw: string): string`
  - `supplierCodeFromQdNo(qdNo: string): string`
  - `dieNoFromFilename(name: string): string`

- [ ] **Step 1: Write the failing test**

Create `src/utils/qdFormText.test.js`. `SAMPLE` is the exact text pdfjs extracts from the real form `320601-201 Quality discrepancy 2026PH-04.pdf` (joined as `qdFormTextFromItems` joins it):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  qdFormTextFromItems, parseQdFormText, parseFormDate, joinWrappedLines,
  supplierCodeFromQdNo, dieNoFromFilename,
} from './qdFormText.js';

// The text pdfjs pulls out of the real 2026PH-04 form, joined item by item
// with a newline wherever pdfjs set hasEOL. Word's table cells come out in
// reading order; the labelled fields are what the parser relies on.
const SAMPLE = 'DATE 4-Jun-26\nQD # 2026PH-04\nProfile\nNo Die no\nDie\nReceived\ndate\nSupplier\nName Press Die Type Die size\nNo of\nCavity Tooling\nNo of\ntrials\nNo of\ncorrection\ndone\n30601 201 9-Apr-26 Phoenix P2 Hollow 475x280 1 BOL\n30587 5 4\nDate Die Soaking\nHours\nDie\nTemperature\nBillet\ntemp\nBreak\nthrough\nPressure\nRunning\nPressure\nBillet\nlength Alloy Ram\nSpeed\nAny Delay\nobserved\n1st Billet\nDetails 502 204 167 499 6063 4.2\nLast Billet\nDetails 498 204 162 601 6063 6\nNo\nQuality Discrepancy : The quality issue was raised because a heavy blend was observed on the\nprofile after trial production.\nDuring the initial trial, the required profile shape was not achieved. Therefore, the die was sent to PHME for\nrework to remove concavity.\nAfter the rework trial, the required shape was achieved, but a heavy blend was still observed. The attached\nimage clearly shows this issue.\nThe input material weight used was 513 kg.\nManufacturing Defect Die Performance Yes\nQuality Discrepancy\nPart-A (To be filled by Gulfex Team)\nProduction Parameters\n1-Jun-26 4 hours 460 No any delay\nobserved1st Trial NoseLast trial NoseBlend Marks on Profile\nYES NO ETA\nReceived By (Supplier)\nQuality Discrepancy Closed on\nPrepared By Veera\nAuthorized By Imran Mulla\nPart-B (To be filled by Supplier)\nQuality Discrepancy Acceptance\nAction Taken\nSupplier Comments/Corrective Action\nNote- Quality Discrepancy should be closed within 10 Working Days\nName Signature\nProfile Image Approved design\nRecommended Action :\nBased on the above observations, we kindly request you to provide a replacement FOC dieplate\non an urgent basis.As for 1st trialAs for last trial';

test('reads every labelled field from the 2026PH-04 form', () => {
  assert.deepEqual(parseQdFormText(SAMPLE), {
    qdNo: '2026PH-04',
    raisedDate: '2026-06-04',
    supplierCode: 'PH',
    profileNo: '30601',
    dieSuffix: '201',
    issue: 'The quality issue was raised because a heavy blend was observed on the profile after trial production.\n'
      + 'During the initial trial, the required profile shape was not achieved. Therefore, the die was sent to PHME for rework to remove concavity.\n'
      + 'After the rework trial, the required shape was achieved, but a heavy blend was still observed. The attached image clearly shows this issue.\n'
      + 'The input material weight used was 513 kg.',
    recommendedAction: 'Based on the above observations, we kindly request you to provide a replacement FOC dieplate on an urgent basis.',
    preparedBy: 'Veera',
    authorizedBy: 'Imran Mulla',
  });
});

test('joins pdfjs items, breaking lines on hasEOL and between pages', () => {
  const pages = [
    [{ str: 'DATE' }, { str: ' ' }, { str: '4-Jun-26' }, { str: '', hasEOL: true }, { str: 'QD #' }],
    [{ str: 'Prepared By' }, { str: ' ' }, { str: 'Veera', hasEOL: true }],
  ];
  assert.equal(qdFormTextFromItems(pages), 'DATE 4-Jun-26\nQD #\nPrepared By Veera\n');
  assert.equal(qdFormTextFromItems(undefined), '');
});

test('form dates become ISO dates; anything else is blank', () => {
  assert.equal(parseFormDate('4-Jun-26'), '2026-06-04');
  assert.equal(parseFormDate('04-June-2026'), '2026-06-04');
  assert.equal(parseFormDate('9-Apr-26'), '2026-04-09');
  assert.equal(parseFormDate('31-Feb-26'), '');
  assert.equal(parseFormDate('Jun 4'), '');
  assert.equal(parseFormDate(''), '');
});

test('a die row that is not profile + suffix is left blank, not guessed', () => {
  const shifted = 'done\n9-Apr-26 Phoenix P2 Hollow\n';
  const p = parseQdFormText(shifted);
  assert.equal(p.profileNo, '');
  assert.equal(p.dieSuffix, '');
});

test('absent labels and empty names come back blank', () => {
  const blank = parseQdFormText('');
  for (const v of Object.values(blank)) assert.equal(v, '');
  // An unsigned Prepared By must not swallow the next line.
  const p = parseQdFormText('Prepared By\nAuthorized By Imran Mulla\n');
  assert.equal(p.preparedBy, '');
  assert.equal(p.authorizedBy, 'Imran Mulla');
  // The form title and "Quality Discrepancy Closed on" are not the issue.
  assert.equal(parseQdFormText('Quality Discrepancy\nQuality Discrepancy Closed on\nManufacturing Defect').issue, '');
});

test('the supplier code comes only from a YYYYCC-NN number', () => {
  assert.equal(supplierCodeFromQdNo('2026PH-04'), 'PH');
  assert.equal(supplierCodeFromQdNo('2026ph-4'), 'PH');
  assert.equal(supplierCodeFromQdNo('2026-01'), '');
  assert.equal(supplierCodeFromQdNo(''), '');
});

test('filename die numbers follow the PDF import convention', () => {
  // The sample's filename and its form disagree (320601 vs 30601): the modal
  // shows both, which is why this helper exists at all.
  assert.equal(dieNoFromFilename('320601-201 Quality discrepancy 2026PH-04.pdf'), '320601-201');
  assert.equal(dieNoFromFilename('051150_807.pdf'), '051150-807');
  assert.equal(dieNoFromFilename('QD-2026PD-02.pdf'), '');
});

test('wrapped lines rejoin; a line ending a sentence starts a new paragraph', () => {
  assert.equal(joinWrappedLines('a heavy blend on the\nprofile.\nNext one'), 'a heavy blend on the profile.\nNext one');
  assert.equal(joinWrappedLines('  \n'), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/utils/qdFormText.test.js`
Expected: FAIL, `Cannot find module ... qdFormText.js`

- [ ] **Step 3: Write the implementation**

Create `src/utils/qdFormText.js`:

```js
// Reads the fields an old QD form states plainly, from the text pdfjs pulls out
// of it. The forms are the controlled template (server/assets/
// qd-form-template.pdf) exported from Word, so each value we read sits right
// after a printed label. Anything not found comes back '' -- never a guess.
//
// Deliberately NOT read: the die row past its first two cells, and the billet
// parameters. Word emits no text for an empty table cell, so one blank cell
// shifts every later value into the wrong column. The original PDF stays the
// QD's document, so those values are not lost.

// pdfjs text items -> one string: a newline wherever pdfjs set hasEOL, and one
// between pages.
export const qdFormTextFromItems = (pages) => (pages || [])
  .map((items) => (items || []).map((i) => `${i.str ?? ''}${i.hasEOL ? '\n' : ''}`).join(''))
  .join('\n');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

// '4-Jun-26' / '04-June-2026' -> '2026-06-04'. Two-digit years are 20YY.
// '' for anything that is not a real calendar date.
export const parseFormDate = (raw) => {
  const m = String(raw || '').trim().match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2}|\d{4})$/);
  if (!m) return '';
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return '';
  const day = Number(m[1]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

// Word wraps a paragraph across lines. A line that ends a sentence closes a
// paragraph; any other line break is only a wrap and becomes a space.
export const joinWrappedLines = (raw) => String(raw || '')
  .split('\n').map((l) => l.trim()).filter(Boolean)
  .reduce((out, line) => (out ? `${out}${/[.!?:]$/.test(out) ? '\n' : ' '}${line}` : line), '');

// The two-letter supplier code in a YYYYCC-NN QD number ('2026PH-04' -> 'PH').
export const supplierCodeFromQdNo = (qdNo) => {
  const m = String(qdNo || '').trim().toUpperCase().match(/^\d{4}([A-Z]{2})-\d+$/);
  return m ? m[1] : '';
};

// A die number in a filename -- the convention PDFImportModal already relies on
// ('320601-201 Quality discrepancy 2026PH-04.pdf' -> '320601-201').
export const dieNoFromFilename = (name) => {
  const m = String(name || '').match(/(\d{3,6})[-_](\d{2,4})/);
  return m ? `${m[1]}-${m[2]}` : '';
};

const firstMatch = (text, re) => (text.match(re)?.[1] || '').trim();

export const parseQdFormText = (text) => {
  const t = String(text || '');
  const qdNo = firstMatch(t, /QD\s*#[ \t]*([A-Za-z0-9][A-Za-z0-9/-]*)/).toUpperCase();
  // Upper-case DATE only: the billet table has a "Date" column of its own.
  const raisedDate = parseFormDate(firstMatch(t, /\bDATE[ \t]+(\S+)/));
  // The die row is the line after the header's last label, "done".
  const die = t.match(/\bdone[ \t]*\n[ \t]*(\d{3,6})[ \t]+(\d{1,4}[A-Za-z]?)(?=[ \t\n]|$)/);
  // The colon matters: "Quality Discrepancy" is also the form's title and the
  // start of "Quality Discrepancy Closed on".
  const issue = joinWrappedLines(firstMatch(t, /Quality Discrepancy[ \t]*:([\s\S]*?)Manufacturing Defect/));
  // Ends at the photo captions that follow it in the text layer.
  const recommendedAction = joinWrappedLines(
    firstMatch(t, /Recommended Action[ \t]*:([\s\S]*?)(?=As for 1st trial|As for last trial|Prepared By|$)/));
  // [ \t]+, not \s+: an unsigned line must not capture the line after it.
  const preparedBy = firstMatch(t, /Prepared By[ \t]+([^\n]+)/);
  const authorizedBy = firstMatch(t, /Authorized By[ \t]+([^\n]+)/);
  return {
    qdNo,
    raisedDate,
    supplierCode: supplierCodeFromQdNo(qdNo),
    profileNo: die ? die[1] : '',
    dieSuffix: die ? die[2] : '',
    issue,
    recommendedAction,
    preparedBy,
    authorizedBy,
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/utils/qdFormText.test.js`
Expected: PASS, 8 tests

- [ ] **Step 5: Check the parser against the real PDF**

This proves the fixture matches what pdfjs really produces. Write the scratch script in the session scratchpad, not the repo:

```js
// <scratchpad>/parse-real.mjs  — run from the repo root
import fs from 'fs';
import { pathToFileURL } from 'url';
const { getDocument } = await import(pathToFileURL(process.cwd() + '/node_modules/pdfjs-dist/legacy/build/pdf.mjs').href);
const { qdFormTextFromItems, parseQdFormText } = await import(pathToFileURL(process.cwd() + '/src/utils/qdFormText.js').href);
const pdf = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), disableWorker: true }).promise;
const pages = [];
for (let p = 1; p <= pdf.numPages; p++) pages.push((await (await pdf.getPage(p)).getTextContent()).items);
console.log(parseQdFormText(qdFormTextFromItems(pages)));
process.exit(0);
```

Run: `node <scratchpad>/parse-real.mjs "../320601-201 Quality discrepancy 2026PH-04.pdf"`
Expected: the same object as the first test's `deepEqual`.

- [ ] **Step 6: Lint and commit**

```bash
npx eslint src/utils/qdFormText.js src/utils/qdFormText.test.js
git add src/utils/qdFormText.js src/utils/qdFormText.test.js
git commit -m "feat(qd-import): read the labelled fields of an old QD form from its PDF text

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Import service and the `imported` column

**Files:**
- Create: `server/services/qdImport.cjs`
- Test: `server/services/qdImport.test.cjs`
- Modify: `server/db.cjs` (the QD migration block around line 452, next to `qd_requested_date`)
- Modify: `init.sql` (the `quality_discrepancies` CREATE TABLE, about lines 411–460)

**Interfaces:**
- Consumes: `qd.createQD`, `qd.addActivity`, `qd.updateStatus`, `qd.STATUSES`, `qd.SETTLED_STATUSES`, `qd.ISO_DATE` from `server/services/qualityDiscrepancies.cjs`.
- Produces (from `server/services/qdImport.cjs`):
  - `ORIGINAL_FORM = 'original_form'`
  - `validateImport(body, { today: 'YYYY-MM-DD' }) → fields`, where fields = `{ qdNo, raisedDate, supplier, dieNo, plant, issue, recommendedAction|null, preparedBy|null, authorizedBy|null, status, closedDate|null, etaDate|null, receivedDate|null }`. Throws `Error` with `clientError: true`.
  - `qdNoExists(client, qdNo) → Promise<boolean>`
  - `insertImportedQd(client, fields, { actor, userId, fileName }) → Promise<number>` (the new QD id). Throws `clientError` on a duplicate or unknown supplier.
  - `attachOriginal(client, { qdId, originalName, storedPath, mimeType, size, userId }) → Promise<void>`
  - `deleteImportedQd(client, id) → Promise<string[]>` (the stored paths). Throws `notFound: true` or `clientError: true`.

- [ ] **Step 1: Write the failing tests**

Create `server/services/qdImport.test.cjs`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const imp = require('./qdImport.cjs');

const TODAY = '2026-09-19';
const BASE = {
  qdNo: ' 2026ph-04 ', raisedDate: '2026-06-04', supplier: 'Phoenix', dieNo: '30601-201',
  plant: 'GEX 1', issue: 'Heavy blend on the profile.\nSecond paragraph.', status: 'Open',
  preparedBy: 'Veera', authorizedBy: 'Imran Mulla', recommendedAction: '',
};

// Just enough of pg for the import: records every call, knows which QD
// numbers and suppliers exist, and keeps qd_foc_rounds so the real
// updateStatus -> openFocRound -> recordReceipt path runs unmodified.
function fakeClient({ existingQdNos = [], suppliers = ['PHOENIX'], qdRow = null, files = [] } = {}) {
  const calls = [];
  const rounds = [];
  return {
    calls,
    rounds,
    async query(sql, params = []) {
      const s = String(sql);
      calls.push({ sql: s, params });
      if (s.includes('UPPER(qd_no)')) {
        const hit = existingQdNos.some((n) => n.toUpperCase() === String(params[0]).toUpperCase());
        return { rows: hit ? [{}] : [], rowCount: hit ? 1 : 0 };
      }
      if (s.includes('FROM suppliers')) {
        const name = suppliers.find((n) => n.toUpperCase() === String(params[0]).toUpperCase());
        return { rows: name ? [{ name }] : [], rowCount: name ? 1 : 0 };
      }
      if (s.includes('INSERT INTO quality_discrepancies')) return { rows: [{ id: 42 }], rowCount: 1 };
      if (s.includes('SELECT imported FROM quality_discrepancies')) {
        return { rows: qdRow ? [qdRow] : [], rowCount: qdRow ? 1 : 0 };
      }
      if (s.includes('SELECT stored_path FROM quality_discrepancy_files')) return { rows: files, rowCount: files.length };
      if (s.includes('FROM qd_foc_rounds')) {
        const rows = rounds.filter((r) => r.qd_id === params[0]);
        return { rows, rowCount: rows.length };
      }
      if (s.includes('INSERT INTO qd_foc_rounds')) {
        rounds.push({ id: rounds.length + 1, qd_id: params[0], round_no: params[1], promised_eta: params[2],
          received_date: null, trial_date: null, trial_result: null });
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('SET received_date')) {
        rounds.find((r) => r.id === params[2]).received_date = params[0];
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
}

const statusUpdates = (client) => client.calls
  .filter((c) => c.sql.includes('SET status = $1')).map((c) => c.params[0]);

test('validateImport trims, upper-cases the number and nulls dates the status does not use', () => {
  const f = imp.validateImport({ ...BASE, closedDate: '2026-06-20', etaDate: '2026-10-01' }, { today: TODAY });
  assert.equal(f.qdNo, '2026PH-04');
  assert.equal(f.status, 'Open');
  assert.equal(f.closedDate, null);
  assert.equal(f.etaDate, null);
  assert.equal(f.receivedDate, null);
  assert.equal(f.recommendedAction, null);
  assert.equal(f.preparedBy, 'Veera');
});

test('validateImport refuses each missing required field, as a client error', () => {
  for (const key of ['qdNo', 'raisedDate', 'supplier', 'dieNo', 'plant', 'issue']) {
    assert.throws(() => imp.validateImport({ ...BASE, [key]: '  ' }, { today: TODAY }),
      (e) => e.clientError === true && /required/.test(e.message), key);
  }
});

test('validateImport checks dates against today and the raised date', () => {
  const v = (extra) => () => imp.validateImport({ ...BASE, ...extra }, { today: TODAY });
  assert.throws(v({ raisedDate: '2026-09-20' }), /Date raised cannot be in the future/);
  assert.throws(v({ raisedDate: '04/06/2026' }), /Date raised must be a date/);
  assert.throws(v({ status: 'Closed' }), /Closed date is required/);
  assert.throws(v({ status: 'Closed', closedDate: '2026-06-01' }), /Closed date cannot be before/);
  assert.throws(v({ status: 'Rejected', closedDate: '2026-09-20' }), /Closed date cannot be in the future/);
  assert.throws(v({ status: 'FOC Accepted' }), /ETA is required/);
  // An ETA is a supplier's promise -- the future is exactly where it lives.
  assert.equal(v({ status: 'FOC Accepted', etaDate: '2026-12-01' })().etaDate, '2026-12-01');
  assert.throws(v({ status: 'FOC Received', etaDate: '2026-07-01' }), /Received date is required/);
  assert.throws(v({ status: 'FOC Received', etaDate: '2026-07-01', receivedDate: '2026-05-01' }), /Received date cannot be before/);
  assert.throws(v({ status: 'Paused' }), /Invalid status/);
});

test('a QD number already in the register is refused before anything is written', async () => {
  const client = fakeClient({ existingQdNos: ['2026PH-04'] });
  const f = imp.validateImport(BASE, { today: TODAY });
  await assert.rejects(imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' }),
    (e) => e.clientError === true && /2026PH-04 already exists/.test(e.message));
  assert.ok(!client.calls.some((c) => c.sql.includes('INSERT')));
});

test('an unknown supplier is refused', async () => {
  const client = fakeClient({ suppliers: [] });
  const f = imp.validateImport(BASE, { today: TODAY });
  await assert.rejects(imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' }),
    (e) => e.clientError === true && /Unknown supplier/.test(e.message));
});

test('a closed QD is inserted Approved, imported, with the paper dates and a back-dated raise', async () => {
  const client = fakeClient();
  const f = imp.validateImport({ ...BASE, status: 'Closed', closedDate: '2026-06-20' }, { today: TODAY });
  const id = await imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'old.pdf' });
  assert.equal(id, 42);

  const insert = client.calls.find((c) => c.sql.includes('INSERT INTO quality_discrepancies')).params;
  assert.equal(insert[0], '2026PH-04');
  assert.equal(insert[4], '2026-06-04');           // raised_date
  assert.equal(insert[6], 'PHOENIX');              // canonical name from the master
  assert.equal(insert[10], 'Heavy blend on the profile.'); // summary = first line
  assert.equal(insert[14], '2026-06-20');          // closed_at from the paper
  assert.equal(insert[15], 1);                     // created_by
  assert.equal(insert[16], 'Approved');
  assert.equal(insert[17], 'Veera');               // prepared_by from the form

  assert.ok(client.calls.some((c) => c.sql.includes('SET imported = TRUE') && c.params[0] === 42));
  const acts = client.calls.filter((c) => c.sql.includes('INSERT INTO quality_discrepancy_activity')).map((c) => c.params);
  assert.equal(acts[0][2], 'raised QD against die 30601-201');
  assert.equal(acts[0][1], 'Veera');
  assert.equal(acts[0][6], '2026-06-04 00:00:00');
  assert.match(acts[1][2], /imported from the original QD form old\.pdf · Authorized by Imran Mulla/);
  assert.deepEqual(statusUpdates(client), ['Closed']);
  assert.match(acts[2][2], /changed status to Closed — Status at import/);
});

test('an Open import changes no status', async () => {
  const client = fakeClient();
  await imp.insertImportedQd(client, imp.validateImport(BASE, { today: TODAY }), { actor: 'admin', userId: 1, fileName: 'a.pdf' });
  assert.deepEqual(statusUpdates(client), []);
});

test('FOC Received opens a round at the ETA, then records the receipt on it', async () => {
  const client = fakeClient();
  const f = imp.validateImport({ ...BASE, status: 'FOC Received', etaDate: '2026-07-15', receivedDate: '2026-07-20' }, { today: TODAY });
  await imp.insertImportedQd(client, f, { actor: 'admin', userId: 1, fileName: 'a.pdf' });
  assert.deepEqual(statusUpdates(client), ['FOC Accepted', 'FOC Received']);
  assert.equal(client.rounds.length, 1);
  assert.equal(client.rounds[0].promised_eta, '2026-07-15');
  assert.equal(client.rounds[0].received_date, '2026-07-20');
});

test('attachOriginal stores the PDF under the original_form category', async () => {
  const client = fakeClient();
  await imp.attachOriginal(client, { qdId: 42, originalName: 'old.pdf', storedPath: '2026PH-04/42/old.pdf', mimeType: 'application/pdf', size: 10, userId: 1 });
  const ins = client.calls.find((c) => c.sql.includes('INSERT INTO quality_discrepancy_files'));
  assert.equal(ins.params[6], 'original_form');
  assert.equal(imp.ORIGINAL_FORM, 'original_form');
});

test('undo refuses a QD raised in the app and deletes nothing', async () => {
  const client = fakeClient({ qdRow: { imported: false } });
  await assert.rejects(imp.deleteImportedQd(client, 42), (e) => e.clientError === true && /Only an imported QD/.test(e.message));
  assert.ok(!client.calls.some((c) => c.sql.startsWith('DELETE')));
});

test('undo of a missing QD is not found', async () => {
  await assert.rejects(imp.deleteImportedQd(fakeClient(), 42), (e) => e.notFound === true);
});

test('undo of an imported QD deletes it and hands back its files', async () => {
  const client = fakeClient({ qdRow: { imported: true }, files: [{ stored_path: 'a/42/old.pdf' }, { stored_path: 'a/42/p.png' }] });
  assert.deepEqual(await imp.deleteImportedQd(client, 42), ['a/42/old.pdf', 'a/42/p.png']);
  const del = client.calls.find((c) => c.sql.startsWith('DELETE FROM quality_discrepancies'));
  assert.deepEqual(del.params, [42]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/services/qdImport.test.cjs`
Expected: FAIL, `Cannot find module './qdImport.cjs'`

- [ ] **Step 3: Write the service**

Create `server/services/qdImport.cjs`:

```js
'use strict';
// Turns an old, already-issued QD form into a QD in the register. The paper
// form was raised and signed before the tracker existed, so the record goes
// straight to Approved -- no submit, no approval, no Purchase email -- and the
// uploaded PDF, never a redrawn one, stays its document (see qdDocument.cjs).
const qd = require('./qualityDiscrepancies.cjs');

const ORIGINAL_FORM = 'original_form';
const STATUS_REASON = 'Status at import';

// Mistakes the admin can fix; the route answers these with 400.
const importError = (message) => Object.assign(new Error(message), { clientError: true });
const str = (v) => String(v == null ? '' : v).trim();

function validateImport(body, { today }) {
  const b = body || {};
  const f = {
    qdNo: str(b.qdNo).toUpperCase(),
    raisedDate: str(b.raisedDate),
    supplier: str(b.supplier),
    dieNo: str(b.dieNo),
    plant: str(b.plant),
    issue: str(b.issue).replace(/\r\n/g, '\n'),
    recommendedAction: str(b.recommendedAction) || null,
    preparedBy: str(b.preparedBy) || null,
    authorizedBy: str(b.authorizedBy) || null,
    status: str(b.status) || 'Open',
    closedDate: null,
    etaDate: null,
    receivedDate: null,
  };
  if (!f.qdNo) throw importError('QD No is required');
  if (!f.dieNo) throw importError('Die No is required');
  if (!f.plant) throw importError('Plant is required');
  if (!f.supplier) throw importError('Supplier is required');
  if (!f.issue) throw importError('Quality issue is required');

  const date = (label, value, { notFuture = true } = {}) => {
    if (!value) throw importError(`${label} is required`);
    if (!qd.ISO_DATE.test(value)) throw importError(`${label} must be a date (YYYY-MM-DD)`);
    if (notFuture && value > today) throw importError(`${label} cannot be in the future`);
    return value;
  };
  date('Date raised', f.raisedDate);
  if (!qd.STATUSES.includes(f.status)) throw importError(`Invalid status: ${f.status}`);

  // Only the dates the chosen status asks for are kept, so a value left in a
  // hidden field can never be written against an unrelated status.
  if (qd.SETTLED_STATUSES.includes(f.status)) {
    f.closedDate = date('Closed date', str(b.closedDate));
    if (f.closedDate < f.raisedDate) throw importError('Closed date cannot be before the date raised');
  }
  if (f.status === 'FOC Accepted' || f.status === 'FOC Received') {
    // An ETA is the supplier's promise, so it may well be in the future.
    f.etaDate = date('ETA', str(b.etaDate), { notFuture: false });
  }
  if (f.status === 'FOC Received') {
    f.receivedDate = date('Received date', str(b.receivedDate));
    if (f.receivedDate < f.raisedDate) throw importError('Received date cannot be before the date raised');
  }
  return f;
}

async function qdNoExists(client, qdNo) {
  const { rowCount } = await client.query(
    'SELECT 1 FROM quality_discrepancies WHERE UPPER(qd_no) = UPPER($1) LIMIT 1', [str(qdNo)]);
  return rowCount > 0;
}

async function insertImportedQd(client, f, { actor, userId, fileName }) {
  if (await qdNoExists(client, f.qdNo)) throw importError(`QD ${f.qdNo} already exists in the register`);
  // The master's spelling, so contact_email lookups and the supplier rollup
  // treat this QD exactly like one raised in the app.
  const { rows: sup } = await client.query(
    'SELECT name FROM suppliers WHERE UPPER(name) = UPPER($1) LIMIT 1', [f.supplier]);
  if (!sup[0]) throw importError(`Unknown supplier "${f.supplier}" — add it under Settings → Suppliers first`);

  const id = await qd.createQD(client, {
    qdNo: f.qdNo,
    dieNo: f.dieNo,
    raisedDate: f.raisedDate,
    plant: f.plant,
    supplier: sup[0].name,
    status: 'Open',
    approvalState: 'Approved',
    issueSummary: f.issue.split('\n')[0].slice(0, 160),
    issueDetail: f.issue,
    recommendedAction: f.recommendedAction,
    preparedBy: f.preparedBy,
    // A settled QD keeps the paper's closed date: updateStatus below stamps
    // COALESCE(closed_at, CURRENT_DATE), so it does not overwrite it.
    closedAt: f.closedDate,
    createdBy: userId,
  });
  await client.query('UPDATE quality_discrepancies SET imported = TRUE WHERE id = $1', [id]);

  await qd.addActivity(client, {
    qdId: id, actor: f.preparedBy || actor, action: `raised QD against die ${f.dieNo}`,
    icon: 'flag', tone: 'flag', occurredAt: `${f.raisedDate} 00:00:00`,
  });
  // The authorizer need not be an app user, so the timeline is the one place
  // the name can be kept.
  await qd.addActivity(client, {
    qdId: id, actor,
    action: `imported from the original QD form ${fileName}${f.authorizedBy ? ` · Authorized by ${f.authorizedBy}` : ''}`,
    icon: 'check', tone: 'neutral', userId,
  });

  // Through the ordinary path, so the import obeys the same rules and FOC
  // round bookkeeping as any other status change. A receipt needs a round to
  // land on, so FOC Received is reached through FOC Accepted.
  const change = (status, extra) => qd.updateStatus(client, {
    id, status, reason: STATUS_REASON, actor, userId, ...extra,
  });
  if (f.status === 'FOC Received') {
    await change('FOC Accepted', { etaDate: f.etaDate });
    await change('FOC Received', { receivedDate: f.receivedDate });
  } else if (f.status !== 'Open') {
    await change(f.status, { etaDate: f.etaDate || undefined });
  }
  return id;
}

async function attachOriginal(client, { qdId, originalName, storedPath, mimeType, size, userId }) {
  await client.query(
    `INSERT INTO quality_discrepancy_files (qd_id, original_name, stored_path, mime_type, size_bytes, uploaded_by, category)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [qdId, originalName, storedPath, mimeType || 'application/pdf', size || null, userId || null, ORIGINAL_FORM]
  );
}

// Takes back a QD that came in through the importer, so a wrong import can be
// redone. It must never become a way to delete a QD raised in the app. Returns
// the stored paths so the caller can remove the files once this has committed.
async function deleteImportedQd(client, id) {
  const { rows } = await client.query('SELECT imported FROM quality_discrepancies WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw Object.assign(new Error('QD not found'), { notFound: true });
  if (!rows[0].imported) throw importError('Only an imported QD can be undone — this one was raised in the app');
  const files = await client.query('SELECT stored_path FROM quality_discrepancy_files WHERE qd_id = $1', [id]);
  // Activity, billets, files and FOC rounds all cascade.
  await client.query('DELETE FROM quality_discrepancies WHERE id = $1', [id]);
  return files.rows.map((r) => r.stored_path);
}

module.exports = { ORIGINAL_FORM, validateImport, qdNoExists, insertImportedQd, attachOriginal, deleteImportedQd };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/qdImport.test.cjs`
Expected: PASS, 12 tests

- [ ] **Step 5: Add the column: migration and fresh-install schema**

In `server/db.cjs`, directly after the `qd_requested_date` `DO $$ … END $$;` block (the one ending just before `-- ── QD approval workflow`), add:

```sql
      -- A QD brought in from an old, already-issued form (Import existing QD)
      -- rather than raised in the app. Its document is the uploaded original,
      -- and only these rows may be taken back with Undo import.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='imported') THEN
          ALTER TABLE quality_discrepancies ADD COLUMN imported BOOLEAN NOT NULL DEFAULT FALSE;
        END IF;
      END $$;
```

In `init.sql`, inside `CREATE TABLE IF NOT EXISTS quality_discrepancies`, change the last column line
`    received_by_supplier  TEXT` to:

```sql
    received_by_supplier  TEXT,
    -- Brought in from an old, already-issued form rather than raised in the app.
    imported              BOOLEAN NOT NULL DEFAULT FALSE
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, and no existing test changes behaviour.

- [ ] **Step 7: Commit**

```bash
git add server/services/qdImport.cjs server/services/qdImport.test.cjs server/db.cjs init.sql
git commit -m "feat(qd-import): service that turns an old QD form into an Approved, imported QD

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: The original PDF is the document

**Files:**
- Modify: `server/services/qdDocument.cjs` (`buildQdPdfBytes`, lines ~15–48)
- Create: `server/services/qdDocument.test.cjs`

**Interfaces:**
- Consumes: `ORIGINAL_FORM` from `server/services/qdImport.cjs`; `store.getRoot()` from `qdStorage.cjs`.
- Produces: `buildQdPdfBytes(pool, qdId) → { row, bytes }` (signature unchanged). For `row.imported` it returns the stored original's bytes, or throws `Error('Original QD form missing for QD <no>')`.

- [ ] **Step 1: Write the failing test**

Create `server/services/qdDocument.test.cjs`:

```js
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// qdStorage reads QD_FILES_ROOT at call time; point it at a scratch dir.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-doc-'));
process.env.QD_FILES_ROOT = root;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const { buildQdPdfBytes } = require('./qdDocument.cjs');

const ORIGINAL = Buffer.from('%PDF-1.4\n% the form exactly as it was issued\n');
fs.mkdirSync(path.join(root, '2026PH-04', '7'), { recursive: true });
fs.writeFileSync(path.join(root, '2026PH-04', '7', 'old.pdf'), ORIGINAL);

const ROW = {
  id: 7, qd_no: '2026PH-04', imported: true, die_no: '30601-201', profile_number: '30601',
  supplier: 'PHOENIX', plant: 'GEX 1', raised_date: '2026-06-04', status: 'Open',
  issue_summary: 'Heavy blend.', issue_detail: 'Heavy blend observed on the profile after trial production.',
  prepared_by: 'Veera', closed_at: null,
};
const ORIGINAL_FILE = {
  id: 1, original_name: 'old.pdf', mime_type: 'application/pdf',
  stored_path: path.join('2026PH-04', '7', 'old.pdf'), category: 'original_form',
};

function fakePool({ row, files = [] }) {
  return {
    async query(sql) {
      const s = String(sql);
      if (s.includes('FROM quality_discrepancy_files')) return { rows: files };
      if (s.includes('FROM quality_discrepancies')) return { rows: row ? [row] : [] };
      return { rows: [] };
    },
  };
}

test('an imported QD serves the original PDF, byte for byte', async () => {
  const { row, bytes } = await buildQdPdfBytes(fakePool({ row: ROW, files: [ORIGINAL_FILE] }), 7);
  assert.equal(row.qd_no, '2026PH-04');
  assert.ok(Buffer.from(bytes).equals(ORIGINAL));
});

test('an imported QD whose original is missing fails rather than redrawing', async () => {
  await assert.rejects(buildQdPdfBytes(fakePool({ row: ROW, files: [] }), 7), /Original QD form missing for QD 2026PH-04/);
  const gone = { ...ORIGINAL_FILE, stored_path: '2026PH-04/7/gone.pdf' };
  await assert.rejects(buildQdPdfBytes(fakePool({ row: ROW, files: [gone] }), 7), /Original QD form missing/);
});

test('a QD raised in the app is still drawn from its record', async () => {
  const { bytes } = await buildQdPdfBytes(fakePool({ row: { ...ROW, imported: false } }), 7);
  const buf = Buffer.from(bytes);
  assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(!buf.equals(ORIGINAL));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test server/services/qdDocument.test.cjs`
Expected: the first two tests FAIL (the imported row gets redrawn, so the bytes differ and nothing throws). The third passes.

- [ ] **Step 3: Implement the branch**

In `server/services/qdDocument.cjs`, add below the existing requires:

```js
const { ORIGINAL_FORM } = require('./qdImport.cjs');

// The PDF uploaded when an old QD was imported. Missing is an error, never a
// cue to redraw: a redrawn form would disagree with the one already issued.
async function readOriginalForm(row, files) {
  const original = files.find((f) => f.category === ORIGINAL_FORM);
  const root = path.resolve(store.getRoot());
  const abs = original ? path.resolve(root, original.stored_path) : null;
  const missing = () => new Error(`Original QD form missing for QD ${row.qd_no || row.id}`);
  if (!abs || !abs.startsWith(root)) throw missing();
  try {
    return await fsp.readFile(abs);
  } catch {
    throw missing();
  }
}
```

Then in `buildQdPdfBytes`, directly after `if (!row) throw new Error('QD not found');`, add:

```js
  // An imported QD's document is the form that was actually issued. Redrawing
  // it from the few fields typed in at import would produce a certification
  // record that disagrees with the one the supplier already holds.
  if (row.imported) return { row, bytes: await readOriginalForm(row, filesRes.rows) };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/services/qdDocument.test.cjs`
Expected: PASS, 3 tests. Then run `npm test`: everything passes.

- [ ] **Step 5: Commit**

```bash
git add server/services/qdDocument.cjs server/services/qdDocument.test.cjs
git commit -m "feat(qd-import): an imported QD's document is its original PDF, never a redraw

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Routes and API client

**Files:**
- Modify: `server/routes/quality-discrepancies.cjs`
- Modify: `src/api.js` (inside `qualityDiscrepanciesAPI`, after `deleteFile`)
- Test: `src/api.test.js`

**Interfaces:**
- Consumes: everything `qdImport` produces (Task 2); `adminMiddleware` from `./auth.cjs`.
- Produces (HTTP, all under `/api/quality-discrepancies`, all admin-only):
  - `GET /exists?qdNo=…` → `{ exists: boolean }`
  - `POST /import` multipart: `file` (PDF) plus the text fields of `validateImport` → `201 { id }`; `400 { error }`; `409 { error }`
  - `DELETE /:id/import` → `{ message }`; `400` when the QD was not imported; `404` when missing
  - `GET /:id/document` answers `404` for a missing original
- Produces (client, `qualityDiscrepanciesAPI`): `importExisting(file, fields) → { id }`, `qdNoExists(qdNo) → { exists }`, `undoImport(id) → { message }`

- [ ] **Step 1: Write the failing client test**

In `src/api.test.js`, change the import line to:

```js
const { frozenDesignsAPI, existingDataAPI, backupRequestsAPI, qualityDiscrepanciesAPI } = await import('./api.js');
```

Append:

```js
// The import posts the PDF and the admin's fields in one multipart request.
// Blank values are left out, so the server sees "not given", never "".
test('importExisting posts the PDF and the filled fields as multipart, skipping blanks', async () => {
  let seen;
  globalThis.fetch = async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ id: 9 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };
  const file = new File(['%PDF-1.4'], 'old.pdf', { type: 'application/pdf' });
  const res = await qualityDiscrepanciesAPI.importExisting(file, {
    qdNo: '2026PH-04', plant: 'GEX 1', etaDate: '', preparedBy: null,
  });
  assert.equal(res.id, 9);
  assert.match(seen.url, /\/quality-discrepancies\/import$/);
  assert.equal(seen.options.method, 'POST');
  assert.ok(seen.options.body instanceof FormData);
  assert.equal(seen.options.body.get('qdNo'), '2026PH-04');
  assert.equal(seen.options.body.get('file').name, 'old.pdf');
  assert.equal(seen.options.body.has('etaDate'), false);
  assert.equal(seen.options.body.has('preparedBy'), false);
  // The browser must set the multipart boundary itself.
  assert.equal(seen.options.headers['Content-Type'], undefined);
});

test('qdNoExists and undoImport hit their endpoints', async () => {
  const urls = [];
  globalThis.fetch = async (url, options) => {
    urls.push(`${options?.method || 'GET'} ${url}`);
    return new Response(JSON.stringify({ exists: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await qualityDiscrepanciesAPI.qdNoExists('2026PH-04'), { exists: true });
  await qualityDiscrepanciesAPI.undoImport(61);
  assert.match(urls[0], /^GET .*\/quality-discrepancies\/exists\?qdNo=2026PH-04$/);
  assert.match(urls[1], /^DELETE .*\/quality-discrepancies\/61\/import$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/api.test.js`
Expected: FAIL, `qualityDiscrepanciesAPI.importExisting is not a function`

- [ ] **Step 3: Add the client functions**

In `src/api.js`, inside `qualityDiscrepanciesAPI`, directly after the `deleteFile` entry, add:

```js
    // Admin only. One old, already-issued QD form (PDF) plus the fields the
    // admin confirmed: { qdNo, raisedDate, supplier, dieNo, plant, issue,
    // recommendedAction?, preparedBy?, authorizedBy?, status, closedDate?,
    // etaDate?, receivedDate? }. The server creates an Approved QD that keeps
    // this PDF as its document. Blank values are not sent.
    importExisting: async (file, fields) => {
        const form = new FormData();
        form.append('file', file);
        Object.entries(fields || {}).forEach(([key, value]) => {
            const v = value == null ? '' : String(value).trim();
            if (v) form.append(key, v);
        });
        return apiRequest('/quality-discrepancies/import', { method: 'POST', body: form, isMultipart: true });
    },

    // Admin only. Whether a QD number is already in the register, so the
    // import form can say so before anything else is filled in.
    qdNoExists: async (qdNo) =>
        apiRequest(`/quality-discrepancies/exists?${new URLSearchParams({ qdNo })}`),

    // Admin only. Removes a QD that came in through the importer (the server
    // refuses any other), with its timeline, files and FOC rounds.
    undoImport: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/import`, { method: 'DELETE' }),
```

- [ ] **Step 4: Run the client test to verify it passes**

Run: `node --test src/api.test.js`
Expected: PASS

- [ ] **Step 5: Add the routes**

In `server/routes/quality-discrepancies.cjs`:

(a) Add to the requires at the top:

```js
const { adminMiddleware } = require('./auth.cjs');
const qdImport = require('../services/qdImport.cjs');
```

(b) Directly after the `acceptFiles` middleware (the block ending `});` before `async function moveIntoPlace`), add:

```js
// The import takes exactly one file, and it must be the form itself.
const importUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: store.MAX_FILE_BYTES },
  fileFilter: (req, file, cb) => {
    if (/\.pdf$/i.test(file.originalname)) return cb(null, true);
    cb(new Error('The original QD form must be a PDF'));
  },
});

const acceptOriginalForm = (req, res, next) => {
  importUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `File too large (max ${Math.round(store.MAX_FILE_BYTES / 1024 / 1024)} MB)`
      : err.message;
    return res.status(400).json({ error: message });
  });
};
```

(c) Directly after the `POST /` create route (the handler ending with `client.release();\n  }\n});` before `// GET /settings`), add:

```js
// POST /api/quality-discrepancies/import  (admin, multipart: file + fields)
// Brings one old, already-issued QD form into the register. adminMiddleware
// runs before multer so a non-admin's upload never reaches the disk.
router.post('/import', adminMiddleware, acceptOriginalForm, async (req, res) => {
  const file = req.file;
  const discardTemp = () => (file ? fsp.unlink(file.path).catch(() => {}) : null);
  if (!file) return res.status(400).json({ error: 'Attach the original QD form (PDF)' });

  let fields;
  try {
    fields = qdImport.validateImport(req.body, { today: todayLocal() });
  } catch (e) {
    await discardTemp();
    return res.status(400).json({ error: e.message });
  }

  const client = await pool.connect();
  let dest = null;
  try {
    await client.query('BEGIN');
    const id = await qdImport.insertImportedQd(client, fields, {
      actor: actorFor(req), userId: req.user?.id, fileName: file.originalname,
    });
    const root = store.getRoot();
    dest = store.buildStoredPath(root, { qdNo: fields.qdNo, qdId: id, fileName: file.originalname });
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await moveIntoPlace(file.path, dest);
    await qdImport.attachOriginal(client, {
      qdId: id, originalName: file.originalname, storedPath: path.relative(root, dest),
      mimeType: file.mimetype, size: file.size, userId: req.user?.id,
    });
    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    // A rejected import leaves nothing on disk: neither the moved original nor
    // the temp upload.
    if (dest) await fsp.unlink(dest).catch(() => {});
    await discardTemp();
    if (e.clientError || isClientError(e.message)) return res.status(400).json({ error: e.message });
    if (e.code === '23505') return res.status(409).json({ error: `QD ${fields.qdNo} already exists in the register` });
    console.error('Import QD error:', e);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});
```

(d) Directly after the `GET /approvers` route, add:

```js
// GET /api/quality-discrepancies/exists?qdNo=2026PH-04 (admin) -> { exists }
// Lets the import form flag a number already in the register up front. The
// import route still enforces uniqueness itself.
router.get('/exists', adminMiddleware, async (req, res) => {
  try {
    const qdNo = String(req.query.qdNo || '').trim();
    res.json({ exists: qdNo ? await qdImport.qdNoExists(pool, qdNo) : false });
  } catch (e) {
    console.error('QD exists check error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

(e) Directly before `// GET /api/quality-discrepancies/files/:fileId  (download)`, add:

```js
// DELETE /api/quality-discrepancies/:id/import (admin) -- takes back a QD that
// came in through the importer so a wrong import can be redone. Refused for a
// QD raised in the app; there is still no general QD delete.
router.delete('/:id/import', adminMiddleware, async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(404).json({ error: 'QD not found' });
  const client = await pool.connect();
  let storedPaths;
  try {
    await client.query('BEGIN');
    storedPaths = await qdImport.deleteImportedQd(client, Number(req.params.id));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    if (e.notFound) return res.status(404).json({ error: e.message });
    if (e.clientError) return res.status(400).json({ error: e.message });
    console.error('Undo QD import error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
  // Files go only once the rows are gone for good: a stray file is harmless,
  // a row pointing at a deleted file is not.
  const root = path.resolve(store.getRoot());
  for (const rel of storedPaths) {
    const abs = path.resolve(root, rel);
    if (abs.startsWith(root)) await fsp.unlink(abs).catch(() => {});
  }
  res.json({ message: 'Import undone' });
});
```

(f) In `GET /:id/document`, change
`if (/QD not found/.test(e.message)) return res.status(404).json({ error: e.message });`
to
`if (/QD not found|Original QD form missing/.test(e.message)) return res.status(404).json({ error: e.message });`

- [ ] **Step 6: Syntax check and full suite**

Run: `node --check server/routes/quality-discrepancies.cjs && npm test`
Expected: no syntax output, and all tests PASS. The routes themselves are exercised live in Task 7. Routes have no test harness in this repo; the logic they call is covered in Tasks 2–3.

- [ ] **Step 7: Commit**

```bash
npx eslint src/api.js src/api.test.js
git add server/routes/quality-discrepancies.cjs src/api.js src/api.test.js
git commit -m "feat(qd-import): admin routes to import, check and undo an existing QD

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Import modal, admin button and Imported pill

**Files:**
- Modify: `src/utils/constants.js` (after `QD_LIST_BADGE_STATES`, ~line 267)
- Create: `src/components/qd/ImportQDModal.jsx`
- Modify: `src/pages/QDTrackerPage.jsx`

**Interfaces:**
- Consumes: `qdFormTextFromItems`, `parseQdFormText`, `dieNoFromFilename` (Task 1); `qualityDiscrepanciesAPI.importExisting`, `.qdNoExists`, `.list` (Task 4); supplier master rows `{ name, qd_code }` from `suppliersAPI.getAll()` (already loaded as `supplierMaster` in the page).
- Produces: `QD_IMPORTED_BADGE = { label, bg, fg }` (used again in Task 6). `<ImportQDModal theme suppliers onClose onImported(id) />`.

- [ ] **Step 1: Add the badge constant**

In `src/utils/constants.js`, directly after `export const QD_LIST_BADGE_STATES = …;`, add:

```js
// Marks a QD brought in from an old, already-issued form rather than raised in
// the app. Shared by the register and the drawer, like QD_APPROVAL_BADGE.
export const QD_IMPORTED_BADGE = { label: 'Imported', bg: 'rgba(14,165,233,0.15)', fg: '#38BDF8' };
```

- [ ] **Step 2: Create the modal**

Create `src/components/qd/ImportQDModal.jsx`:

```jsx
import React, { useState } from 'react';
import { X, Upload, FileText, AlertTriangle } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { qualityDiscrepanciesAPI } from '../../api';
import { QD_STATUSES } from '../../utils/constants';
import { qdFormTextFromItems, parseQdFormText, dieNoFromFilename } from '../../utils/qdFormText';
import DatePickerField from '../DatePickerField';
import useDialog from '../../hooks/useDialog';
import { BRAND, BRAND_ALPHA } from '../../utils/brand';

// Loaded lazily by QDTrackerPage, so pdfjs only ships to someone who opens this.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const PLANTS = ['GEX 2', 'GEX 1'];
const SETTLED = ['Closed', 'Rejected'];
const EMPTY = {
  qdNo: '', raisedDate: '', supplier: '', dieNo: '', plant: '', issue: '',
  recommendedAction: '', preparedBy: '', authorizedBy: '',
  status: 'Open', closedDate: '', etaDate: '', receivedDate: '',
};

async function readPdfText(file) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    pages.push((await (await pdf.getPage(p)).getTextContent()).items);
  }
  return qdFormTextFromItems(pages);
}

// Brings one old, already-issued QD form into the register. What the form
// states plainly is filled in; the admin checks it and supplies what the form
// never records (plant, where the QD stands today).
export default function ImportQDModal({ theme = {}, suppliers = [], onClose, onImported }) {
  const dialogRef = useDialog({ open: true, onClose });
  const [file, setFile] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState('');
  const [filenameDieNo, setFilenameDieNo] = useState('');
  const [duplicate, setDuplicate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const bg = theme.cardBg || '#09090b';
  const border = theme.cardBorder || '#27272a';
  const text = theme.text || '#fafafa';
  const muted = theme.textMuted || '#a1a1aa';
  const dim = theme.textDim || '#71717a';
  const inputBg = theme.inputBg || '#09090b';
  const label = { fontSize: '0.72rem', fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' };
  const field = { padding: '9px 12px', background: inputBg, border: `1px solid ${border}`, borderRadius: 8, color: text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box', width: '100%' };
  const group = { display: 'flex', flexDirection: 'column', gap: 6 };
  const req = <span style={{ color: '#FCA5A5' }}>*</span>;

  const set = (key) => (value) => setF((prev) => ({ ...prev, [key]: value }));

  // Advisory only -- the server refuses a duplicate on save regardless.
  const checkDuplicate = async (qdNo) => {
    const n = String(qdNo || '').trim();
    if (!n) return setDuplicate(false);
    try {
      setDuplicate(!!(await qualityDiscrepanciesAPI.qdNoExists(n)).exists);
    } catch {
      setDuplicate(false);
    }
  };

  const onPick = async (e) => {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (!/\.pdf$/i.test(picked.name)) {
      setError('Choose the QD form as a PDF');
      return;
    }
    setError('');
    setFile(picked);
    setReading(true);
    setDuplicate(false);
    const fromName = dieNoFromFilename(picked.name);
    setFilenameDieNo(fromName);
    try {
      const p = parseQdFormText(await readPdfText(picked));
      const formDie = p.profileNo && p.dieSuffix ? `${p.profileNo}-${p.dieSuffix}` : '';
      const supplier = (p.supplierCode
        && suppliers.find((s) => String(s.qd_code || '').toUpperCase() === p.supplierCode)?.name) || '';
      setF({
        ...EMPTY, qdNo: p.qdNo, raisedDate: p.raisedDate, supplier, dieNo: formDie || fromName,
        issue: p.issue, recommendedAction: p.recommendedAction, preparedBy: p.preparedBy, authorizedBy: p.authorizedBy,
      });
      const found = [p.qdNo, p.raisedDate, formDie, p.issue].some(Boolean);
      setReadNote(found
        ? 'Filled in from the form. Check every field before importing.'
        : 'Nothing could be read from this PDF. Type the fields in.');
      if (p.qdNo) checkDuplicate(p.qdNo);
    } catch {
      setF({ ...EMPTY, dieNo: fromName });
      setReadNote('This PDF could not be read. Type the fields in; it can still be imported.');
    } finally {
      setReading(false);
    }
  };

  const needsClosed = SETTLED.includes(f.status);
  const needsEta = f.status === 'FOC Accepted' || f.status === 'FOC Received';
  const needsReceived = f.status === 'FOC Received';
  const missing = [
    ['qdNo', 'QD No'], ['raisedDate', 'date raised'], ['supplier', 'supplier'], ['dieNo', 'die no'],
    ['plant', 'plant'], ['issue', 'quality issue'],
    ...(needsClosed ? [['closedDate', 'closed date']] : []),
    ...(needsEta ? [['etaDate', 'ETA']] : []),
    ...(needsReceived ? [['receivedDate', 'received date']] : []),
  ].filter(([key]) => !String(f[key] || '').trim()).map(([, name]) => name);
  const canSave = !!file && !missing.length && !duplicate && !saving && !reading;
  const dieMismatch = !!filenameDieNo && !!f.dieNo && filenameDieNo !== f.dieNo;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      // Only the dates the chosen status asks for go up.
      const { id } = await qualityDiscrepanciesAPI.importExisting(file, {
        ...f,
        closedDate: needsClosed ? f.closedDate : '',
        etaDate: needsEta ? f.etaDate : '',
        receivedDate: needsReceived ? f.receivedDate : '',
      });
      await onImported(id);
    } catch (err) {
      setError(err.message || 'Import failed');
      setSaving(false);
    }
  };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Import existing QD" tabIndex={-1}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={onClose}>
      <style>{`@keyframes qdImportIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: translateY(0); } }
        .qd-import-cta:hover { filter: brightness(1.06); }`}</style>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: bg, border: `1px solid ${border}`, borderRadius: 16, width: 720, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)', animation: 'qdImportIn 0.2s ease-out', color: text }}>

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 24px', borderBottom: `1px solid ${border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '1rem', fontWeight: 700 }}>Import existing QD</div>
            <div style={{ fontSize: '0.8rem', color: dim, marginTop: 6 }}>
              Brings an already-issued QD form into the register. It is saved as Approved, with no approval step and no Purchase email, and the PDF you upload stays its document.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={15} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', border: `2px dashed ${border}`, borderRadius: 10, cursor: reading ? 'wait' : 'pointer', color: file ? text : dim, fontSize: '0.85rem' }}>
            {file ? <FileText size={18} style={{ color: '#F87171' }} /> : <Upload size={18} />}
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {reading ? 'Reading the form…' : file ? file.name : 'Choose the QD form (PDF)'}
            </span>
            {file && !reading && <span style={{ fontSize: '0.75rem', color: dim }}>Change</span>}
            <input aria-label="Choose the QD form PDF" type="file" accept=".pdf,application/pdf" style={{ display: 'none' }} onChange={onPick} disabled={reading || saving} />
          </label>
          {readNote && <div style={{ fontSize: '0.8rem', color: dim }}>{readNote}</div>}

          {file && !reading && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div style={group}>
                <label style={label} htmlFor="importqd-qdno">QD No {req}</label>
                <input id="importqd-qdno" value={f.qdNo} style={field}
                  onChange={(e) => { set('qdNo')(e.target.value); setDuplicate(false); }}
                  onBlur={(e) => checkDuplicate(e.target.value)} />
                {duplicate && <span style={{ fontSize: '0.75rem', color: '#FCA5A5' }}>QD {f.qdNo.trim().toUpperCase()} is already in the register.</span>}
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-raised">Date raised {req}</label>
                <DatePickerField id="importqd-raised" value={f.raisedDate} theme={theme} onChange={set('raisedDate')} placeholder="Select date" />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-supplier">Supplier {req}</label>
                <select id="importqd-supplier" value={f.supplier} onChange={(e) => set('supplier')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option value="">Select supplier</option>
                  {suppliers.map((s) => s.name).filter(Boolean).sort().map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-plant">Plant {req}</label>
                <select id="importqd-plant" value={f.plant} onChange={(e) => set('plant')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  <option value="">Select plant (not on the form)</option>
                  {PLANTS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-die">Die No {req}</label>
                <input id="importqd-die" value={f.dieNo} onChange={(e) => set('dieNo')(e.target.value)} style={field} placeholder="e.g. 30601-201" />
                {dieMismatch && (
                  <span style={{ fontSize: '0.75rem', color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AlertTriangle size={13} /> The filename says {filenameDieNo}.
                    <button type="button" onClick={() => set('dieNo')(filenameDieNo)}
                      style={{ background: 'transparent', border: 'none', color: '#FBBF24', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '0.75rem' }}>
                      Use {filenameDieNo}
                    </button>
                  </span>
                )}
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-issue">Quality issue {req}</label>
                <textarea id="importqd-issue" value={f.issue} onChange={(e) => set('issue')(e.target.value)} rows={5}
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
                <span style={{ fontSize: '0.72rem', color: dim }}>The first line becomes the summary in the register.</span>
              </div>
              <div style={{ ...group, gridColumn: 'span 2' }}>
                <label style={label} htmlFor="importqd-action">Recommended action</label>
                <textarea id="importqd-action" value={f.recommendedAction} onChange={(e) => set('recommendedAction')(e.target.value)} rows={2}
                  style={{ ...field, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-prepared">Prepared by</label>
                <input id="importqd-prepared" value={f.preparedBy} onChange={(e) => set('preparedBy')(e.target.value)} style={field} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-authorized">Authorized by</label>
                <input id="importqd-authorized" value={f.authorizedBy} onChange={(e) => set('authorizedBy')(e.target.value)} style={field} />
              </div>
              <div style={group}>
                <label style={label} htmlFor="importqd-status">Status today {req}</label>
                <select id="importqd-status" value={f.status} onChange={(e) => set('status')(e.target.value)} style={{ ...field, cursor: 'pointer' }}>
                  {QD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              {needsClosed && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-closed">Closed date {req}</label>
                  <DatePickerField id="importqd-closed" value={f.closedDate} theme={theme} onChange={set('closedDate')} placeholder="Select date" />
                </div>
              )}
              {needsEta && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-eta">ETA from supplier {req}</label>
                  <DatePickerField id="importqd-eta" value={f.etaDate} theme={theme} onChange={set('etaDate')} placeholder="Select ETA" />
                </div>
              )}
              {needsReceived && (
                <div style={group}>
                  <label style={label} htmlFor="importqd-received">Date received {req}</label>
                  <DatePickerField id="importqd-received" value={f.receivedDate} theme={theme} onChange={set('receivedDate')} placeholder="Select date received" />
                </div>
              )}
            </div>
          )}
          {error && <div style={{ fontSize: '0.8rem', color: '#FCA5A5' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, padding: '16px 24px', borderTop: `1px solid ${border}` }}>
          {file && !reading && missing.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: dim, marginRight: 'auto' }}>Still needed: {missing.join(', ')}</span>
          )}
          <button onClick={onClose} style={{ padding: '9px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 8, color: muted, fontWeight: 500, fontSize: '0.85rem', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={save} disabled={!canSave} className="qd-import-cta"
            style={{ padding: '9px 18px', background: canSave ? BRAND.navy : border, border: 'none', borderRadius: 8, color: canSave ? '#fff' : muted, fontWeight: 600, fontSize: '0.85rem', cursor: canSave ? 'pointer' : 'not-allowed', boxShadow: canSave ? `0 4px 12px ${BRAND_ALPHA.navyGlow}` : 'none' }}>
            {saving ? 'Importing…' : 'Import QD'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the QD Tracker**

In `src/pages/QDTrackerPage.jsx`:

(a) Change the React import to `import React, { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react';` and add `Upload` to the lucide import list.

(b) Change the constants import to:
`import { QD_STATUS_CONFIG, QD_STATUSES, QD_APPROVAL_BADGE, QD_LIST_BADGE_STATES, QD_IMPORTED_BADGE } from '../utils/constants';`

(c) After the component imports (after `import { BRAND, BRAND_ALPHA } from '../utils/brand';`), add:

```js
// Lazy: the import modal pulls in pdfjs, and only an admin importing an old
// QD form ever needs it.
const ImportQDModal = lazy(() => import('../components/qd/ImportQDModal'));
```

(d) Next to `const [showRaise, setShowRaise] = useState(false);`, add:

```js
  const [showImport, setShowImport] = useState(false);
  const isAdmin = user?.role === 'admin';
```

(e) Directly after the `approvalPill` helper, add:

```jsx
  // Marks a QD brought in from an old form. Sits beside the approval pill,
  // which an imported QD never shows (it is Approved).
  const importedPill = (q) => (q.imported ? (
    <span style={{ padding: '2px 7px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', background: QD_IMPORTED_BADGE.bg, color: QD_IMPORTED_BADGE.fg }}>
      {QD_IMPORTED_BADGE.label}
    </span>
  ) : null);
```

(f) Replace **both** occurrences of `{approvalPill(q.approval_state)}` with
`{approvalPill(q.approval_state)}{importedPill(q)}` (edit with replace-all). One is in the register table and one in the supplier drill-down list.

(g) In the header button group, directly before the `Raise QD` button, add:

```jsx
          {isAdmin && (
            <button onClick={() => setShowImport(true)} className="qd-btn" title="Bring an old, already-issued QD form into the register"
              style={{ padding: '10px 16px', background: bg, border: `1px solid ${border}`, borderRadius: 10, color: text, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Upload size={16} /> Import existing QD
            </button>
          )}
```

(h) Directly before the final `</div>` of the page (after the `RaiseQDModal` block), add:

```jsx
      {showImport && (
        <Suspense fallback={null}>
          <ImportQDModal theme={theme} suppliers={supplierMaster}
            onClose={() => setShowImport(false)}
            onImported={async (id) => {
              // An imported QD is Approved, so it lives in the normal register,
              // and it may be from any year -- widen both so the drawer finds it.
              setShowImport(false);
              setShowDrafts(false);
              setYear('All');
              try {
                const next = await qualityDiscrepanciesAPI.list('All', { drafts: false });
                setData(prev => ({ ...next, years: next.years?.length ? next.years : prev.years }));
              } catch {
                // The effect-driven load() triggered by the state changes above retries.
              }
              setSelectedId(id);
            }} />
        </Suspense>
      )}
```

- [ ] **Step 4: Lint and build**

Run: `npx eslint src/components/qd/ImportQDModal.jsx src/pages/QDTrackerPage.jsx src/utils/constants.js`
Expected: no errors in these files. Warnings already on untouched lines of `QDTrackerPage.jsx` may be pre-existing: compare with `git stash; npx eslint src/pages/QDTrackerPage.jsx; git stash pop` if unsure.

Run: `npm run build`
Expected: build succeeds, and a separate chunk for `ImportQDModal` appears in the output.

- [ ] **Step 5: Commit**

```bash
git add src/utils/constants.js src/components/qd/ImportQDModal.jsx src/pages/QDTrackerPage.jsx
git commit -m "feat(qd-import): admin Import existing QD modal and Imported pill in the register

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Drawer: Imported badge, original form chip, Undo import

**Files:**
- Modify: `server/services/qualityDiscrepancies.cjs` (`listQDs` files query, ~line 318)
- Modify: `src/components/qd/QDDetailPanel.jsx`

**Interfaces:**
- Consumes: `QD_IMPORTED_BADGE` (Task 5), `qualityDiscrepanciesAPI.undoImport` (Task 4), `dialogs.confirm` from `src/components/ui/DialogProvider.jsx`, and the `onClose` / `onChanged` props the drawer already has.
- Produces: listed QD files now carry `category`.

- [ ] **Step 1: Carry the file category to the client**

In `server/services/qualityDiscrepancies.cjs`, in `listQDs`, change
`` `SELECT id, qd_id, original_name, mime_type, size_bytes, uploaded_at ``
to
`` `SELECT id, qd_id, original_name, mime_type, size_bytes, uploaded_at, category ``

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Drawer changes**

In `src/components/qd/QDDetailPanel.jsx`:

(a) Add `Undo2` to the lucide import list (after `Eye,`). Change the constants import to include `QD_IMPORTED_BADGE`. Add:
`import { dialogs } from '../ui/DialogProvider';`

(b) Directly after `const handleResend = () => run(() => qualityDiscrepanciesAPI.resendPurchase(qd.id));`, add:

```js
  // Only for a QD brought in by the importer (the server refuses any other).
  // It exists so a wrong import can be redone, which is why it takes everything
  // recorded since with it.
  const handleUndoImport = async () => {
    const ok = await dialogs.confirm({
      title: `Undo import of QD ${qd.qd_no}`,
      message: 'This QD leaves the register together with everything recorded on it since it was imported: status changes, notes, FOC rounds and attachments. Its number becomes free to import again.',
      confirmLabel: 'Undo import',
    });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await qualityDiscrepanciesAPI.undoImport(qd.id);
      onClose();
      await onChanged();
    } catch (e) {
      setError(e.message || 'Could not undo the import');
      setBusy(false);
    }
  };
```

(c) In the header, directly after the `{aBadge && ( … )}` span block, add:

```jsx
              {qd.imported && (
                <span title="Brought in from an existing QD form" style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, background: QD_IMPORTED_BADGE.bg, color: QD_IMPORTED_BADGE.fg }}>{QD_IMPORTED_BADGE.label}</span>
              )}
```

(d) In the Actions row, directly after the `Preview QD form` button, add:

```jsx
          {me?.role === 'admin' && qd.imported && (
            <button onClick={handleUndoImport} disabled={busy} className="qd-action" title="Remove this imported QD so it can be imported again correctly"
              style={{ padding: '8px 14px', background: bg, border: '1px solid rgba(239,68,68,0.35)', borderRadius: 8, color: '#FCA5A5', fontWeight: 500, fontSize: 13, cursor: busy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Undo2 size={15} /> Undo import
            </button>
          )}
```

(e) In the attachments list, change the chip's button so the original is named for what it is. Replace

```jsx
                <button key={f.id} type="button" className="qd-chip"
```

with

```jsx
                <button key={f.id} type="button" className="qd-chip" title={f.original_name}
```

and replace `<Icon size={15} style={{ color: isPdf(f.original_name) ? '#F87171' : '#60A5FA' }} /> {f.original_name}` with

```jsx
<Icon size={15} style={{ color: isPdf(f.original_name) ? '#F87171' : '#60A5FA' }} /> {f.category === 'original_form' ? 'Original QD form' : f.original_name}
```

- [ ] **Step 3: Lint and build**

Run: `npx eslint src/components/qd/QDDetailPanel.jsx`
Expected: no new errors (compare with `main` if a pre-existing warning appears).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add server/services/qualityDiscrepancies.cjs src/components/qd/QDDetailPanel.jsx
git commit -m "feat(qd-import): Imported badge, original form chip and admin Undo import in the drawer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Deploy to the test server and click through

**Files:** none (verification only)

- [ ] **Step 1: Full suite and build from a clean tree**

Run: `npm test && npm run build`
Expected: all tests pass; build succeeds.

- [ ] **Step 2: Rebuild both containers**

```bash
docker compose build backend frontend
docker compose up -d backend frontend
```

Then confirm the migration applied (Git Bash needs `MSYS_NO_PATHCONV=1`):

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='quality_discrepancies' AND column_name='imported'"
```

Expected: one row, `imported | boolean | false`. Also check the count before testing:
`SELECT COUNT(*) FROM quality_discrepancies` (8 on 2026-09-19). Note it.

- [ ] **Step 3: Browser check (needs the user)**

There are no test-server credentials on this machine. Do NOT mint a JWT or brute-force a login. Ask the user to sign in **as an admin** in the Browser pane at `http://localhost`, and to pick `320601-201 Quality discrepancy 2026PH-04.pdf` (on the Desktop, in `18.06.2026`) when the file dialog opens. The built-in browser cannot drive a native file picker. Then verify with `read_page` / screenshots:

1. QD Tracker header shows **Import existing QD** (and a non-admin would not, which you can confirm from the code path `isAdmin`).
2. After picking the PDF: QD No `2026PH-04`, Date raised `2026-06-04`, Supplier `PHOENIX`, Die No `30601-201` with the amber "The filename says 320601-201" note, the issue in 4 paragraphs, Recommended action, Prepared by `Veera`, Authorized by `Imran Mulla`. Plant is empty and the footer says "Still needed: plant".
3. Choose plant `GEX 1`, status `Closed`: a Closed date field appears. Enter `2026-06-20` and import.
4. The drawer opens on 2026PH-04 with the **Imported** and **Approved**-state badges, the chip **Original QD form**, and a timeline reading "Veera raised QD against die 30601-201" (dated 2026-06-04), "imported from the original QD form … · Authorized by Imran Mulla", and "changed status to Closed — Status at import".
5. **Preview QD form** shows the original PDF, not the redrawn form. Verify via `read_network_requests` that `/document` returned `application/pdf` with a size equal to the original's size (760,756 bytes). Chrome's PDF plugin may render blank in automated screenshots, which is not a bug.
6. The register row shows the **Imported** pill.
7. Open Import existing QD again with the same PDF: "QD 2026PH-04 is already in the register." and Import is disabled.
8. **Undo import** → confirm → the drawer closes and 2026PH-04 leaves the register.

- [ ] **Step 4: Prove the test left nothing behind**

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT COUNT(*) FROM quality_discrepancies" -c "SELECT id FROM quality_discrepancies WHERE qd_no = '2026PH-04'"
docker exec die-ordering-backend ls /app/storage/qd-files/2026PH-04 2>&1
```

Expected: the count equals the Step 2 number, no `2026PH-04` row, and no file left for the undone id (an empty `2026PH-04/<id>` directory is acceptable). If undo failed during the check, delete **only** the id the check created, by id, and count again.

- [ ] **Step 5: Wrap up**

Report to the user what was verified, with the evidence. Then use superpowers:finishing-a-development-branch to decide merge/PR. Note the known limitation: `origin` pushes are blocked by the credential mismatch (see memory).
