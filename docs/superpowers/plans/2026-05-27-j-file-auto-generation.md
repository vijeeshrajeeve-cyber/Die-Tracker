# J-File Auto-Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "Generate & Save" in the Generate Die Order PDF modal, automatically produce and download the filled BACK UP DIE ORDERING FORM (J-file) alongside the existing profile drawing stamp.

**Architecture:** A new `jFileTemplate.cjs` service loads a bundled template PDF (`server/assets/backup-j-template.pdf`) and stamps text at calibrated coordinates using `pdf-lib`, pulling data from `existing_die_details`, `existing_production_data`, and `die_orders` via the shared pg pool. The existing `generate-order-pdf` endpoint runs both generators with `Promise.allSettled` and returns a single JSON response containing both PDFs as base64 strings. The frontend writes the order PDF back (existing) and triggers a browser download for the J-file.

**Tech Stack:** pdf-lib (existing), Node.js `node:test` (built-in, Node 24), Express, pg pool (existing)

---

## File Map

| File | Change | Responsibility |
|---|---|---|
| `server/assets/backup-j-template.pdf` | **CREATE** | Bundled standard template (copy) |
| `server/services/jFileTemplate.cjs` | **CREATE** | J-file PDF filling + DB queries |
| `server/services/jFileTemplate.test.cjs` | **CREATE** | Unit tests (node:test) |
| `server/services/dieOrderTemplate.cjs` | **MODIFY** | Add `PENDING_ORDER_KG` to `VALUE_KEYS` |
| `server/routes/backup-requests.cjs` | **MODIFY** | Parallel generation, JSON response |
| `src/api.js` | **MODIFY** | Parse JSON response, return structured object |
| `src/components/backup/BackupDieRequests.jsx` | **MODIFY** | New field, J-file download handler |

---

## Task 1 — Bundle Template Asset

**Files:**
- Create: `server/assets/backup-j-template.pdf`

- [ ] **Step 1: Create directory and copy template**

```powershell
New-Item -ItemType Directory -Force server\assets
Copy-Item "C:\Users\vijee\Desktop\19.05.2026\Test sub\standard template.pdf" server\assets\backup-j-template.pdf
```

- [ ] **Step 2: Verify the copy is a valid 1-page US-Letter PDF**

```powershell
node -e "const {PDFDocument}=require('pdf-lib');const fs=require('fs');PDFDocument.load(fs.readFileSync('server/assets/backup-j-template.pdf')).then(p=>{const pg=p.getPages()[0];console.log('pages:',p.getPageCount(),'W:',pg.getWidth(),'H:',pg.getHeight())})"
```
Expected: `pages: 1 W: 612 H: 792`

- [ ] **Step 3: Commit**

```powershell
git add server/assets/backup-j-template.pdf
git commit -m "assets: bundle backup J-file template PDF"
```

---

## Task 2 — Create jFileTemplate.cjs Service (TDD)

**Files:**
- Create: `server/services/jFileTemplate.test.cjs`
- Create: `server/services/jFileTemplate.cjs`

### Step 1 — Write failing tests

- [ ] Create `server/services/jFileTemplate.test.cjs`:

```javascript
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

// ── Mock pg pool ─────────────────────────────────────────────────────────
function makePool({ activeDies = [], extrudedByDie = {}, orderVolume = 0, prevSuppliers = [] } = {}) {
  return {
    query: async (sql, params) => {
      if (sql.includes('existing_die_details')) {
        return { rows: activeDies, rowCount: activeDies.length };
      }
      if (sql.includes('existing_production_data')) {
        if (sql.includes('profile_number')) {
          return { rows: [{ total: orderVolume }] };
        }
        // per-die query: params[0] is die_no
        const vol = extrudedByDie[params?.[0]] ?? 0;
        return { rows: [{ total: vol }] };
      }
      if (sql.includes('die_orders')) {
        return { rows: prevSuppliers.map(s => ({ supplier: s })) };
      }
      return { rows: [] };
    },
  };
}

const SAMPLE_REQUEST = {
  die_no: '014752-702',
  customer: 'Gutmann Systems Middle East FZCO',
  press: 'P7',
};

const SAMPLE_VALUES = {
  HOLLOW: 'Y',
  SOLID: '',
  DIE_SIZE: 'Dia 320x160',
  SUPPLIER: 'PDTMC',
  PENDING_ORDER_KG: '16280',
};

// ── Pure helper tests (no template file needed) ───────────────────────────
test('extractProfile: splits on first hyphen', () => {
  const { extractProfile } = require('./jFileTemplate.cjs');
  assert.equal(extractProfile('014752-702'), '014752');
  assert.equal(extractProfile('24216-201'), '24216');
  assert.equal(extractProfile('24216-2501'), '24216');
  assert.equal(extractProfile('NODASH'), 'NODASH');
  assert.equal(extractProfile(''), '');
  assert.equal(extractProfile(null), '');
});

test('extractNewDieNo: returns portion after first hyphen', () => {
  const { extractNewDieNo } = require('./jFileTemplate.cjs');
  assert.equal(extractNewDieNo('014752-702'), '702');
  assert.equal(extractNewDieNo('24216-2501'), '2501');
  assert.equal(extractNewDieNo('NODASH'), '');
  assert.equal(extractNewDieNo(''), '');
});

test('formatKg: formats integers with thousands separator and Kg suffix', () => {
  const { formatKg } = require('./jFileTemplate.cjs');
  assert.equal(formatKg(60374), '60,374 Kg');
  assert.equal(formatKg(0), '0 Kg');
  assert.equal(formatKg(null), '0 Kg');
  assert.equal(formatKg(undefined), '0 Kg');
  assert.equal(formatKg(1000000), '1,000,000 Kg');
});

test('formatDate: returns DD/MM/YYYY', () => {
  const { formatDate } = require('./jFileTemplate.cjs');
  const result = formatDate(new Date('2026-05-12'));
  assert.equal(result, '12/05/2026');
});

// ── Integration test (requires Task 1 template to be in place) ────────────
test('generateJFilePdf: returns a Buffer starting with %PDF', async () => {
  const { generateJFilePdf } = require('./jFileTemplate.cjs');
  const pool = makePool({
    activeDies: [
      { die_no: '014752-2505', raw_data: { Supplier: 'PDTMC' } },
    ],
    extrudedByDie: { '014752-2505': 44351 },
    orderVolume: 60374,
    prevSuppliers: ['PDTMC', 'EXTEC-NEW ZEALAND'],
  });

  const result = await generateJFilePdf(SAMPLE_REQUEST, SAMPLE_VALUES, pool);
  assert.ok(Buffer.isBuffer(result), 'result must be a Buffer');
  assert.ok(result.length > 10000, 'buffer should be non-trivially large');
  assert.equal(result.slice(0, 4).toString(), '%PDF', 'must be a valid PDF');
});

test('generateJFilePdf: succeeds with empty DB (all fields blank/zero)', async () => {
  const { generateJFilePdf } = require('./jFileTemplate.cjs');
  const pool = makePool(); // all empty
  const result = await generateJFilePdf(SAMPLE_REQUEST, SAMPLE_VALUES, pool);
  assert.equal(result.slice(0, 4).toString(), '%PDF');
});
```

- [ ] **Step 2: Run tests — expect MODULE NOT FOUND failure**

```powershell
node --test server/services/jFileTemplate.test.cjs
```
Expected: fails with `Cannot find module './jFileTemplate.cjs'`

### Step 3 — Implement the service

- [ ] Create `server/services/jFileTemplate.cjs`:

```javascript
'use strict';
const path = require('path');
const fs = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

// ── Template ────────────────────────────────────────────────────────────────
const TEMPLATE_PATH = path.join(__dirname, '../assets/backup-j-template.pdf');
let _templateBytes = null;
function getTemplateBytes() {
  if (!_templateBytes) _templateBytes = fs.readFileSync(TEMPLATE_PATH);
  return _templateBytes;
}

// ── Layout constants (calibrated by coordinate probe against backup-j-template.pdf)
// Page: 612 × 792 pt (US Letter). In pdf-lib, y = 0 is the bottom of the page.
const FS = 8;      // main font size (pt)
const FS_SM = 7;   // smaller size for long-value columns
const BLACK = rgb(0, 0, 0);

// Table column x-positions (text baseline, ~2 pt left padding inside each cell)
const COL_X = {
  profile:   56,
  newDieNo:  147,
  press:     239,
  dieType:   287,
  dieSize:   362,
  activeDie: 442,   // "No. of Active Dies" column
  extruded:  532,   // "Extruded Volume on Active Dies" column
};

// Row text-baseline y-positions: Row 1 at index 0, stride 16 pt downward
const ROW_BASE_Y  = 638;
const ROW_STRIDE  = 16;
const rowY = (i) => ROW_BASE_Y - i * ROW_STRIDE; // i = 0..9

// Static field positions confirmed by probe
const FIELD = {
  customerName:  { x: 155, y: 742 },
  orderVolume:   { x: 215, y: 722 },
  prefSupplier:  { x: 195, y: 482 },
  prevSuppliers: { x: 195, y: 462 },
  pendingKg:     { x: 130, y: 328 },
  asOnDate:      { x: 420, y: 328 },
};

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Extract profile (everything before the first '-'). */
function extractProfile(dieNo) {
  if (!dieNo) return '';
  const idx = String(dieNo).indexOf('-');
  return idx === -1 ? String(dieNo) : String(dieNo).substring(0, idx);
}

/** Extract new die number (everything after the first '-'). */
function extractNewDieNo(dieNo) {
  if (!dieNo) return '';
  const idx = String(dieNo).indexOf('-');
  return idx === -1 ? '' : String(dieNo).substring(idx + 1);
}

/** Format a number as "N,NNN Kg". */
function formatKg(value) {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('en-US') + ' Kg';
}

/** Format a Date as DD/MM/YYYY. */
function formatDate(date = new Date()) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

/** Normalise an object key: lowercase, strip non-alphanumeric. */
const normalizeKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Try a list of aliases against a raw_data JSONB object. */
function getFieldFromRaw(rawData, aliases) {
  if (!rawData || typeof rawData !== 'object') return null;
  const norm = {};
  for (const [k, v] of Object.entries(rawData)) norm[normalizeKey(k)] = v;
  for (const alias of aliases) {
    const v = norm[normalizeKey(alias)];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/**
 * Draw text clamped to maxWidth — truncates with a trailing '…' when needed.
 */
function drawClamped(page, text, x, y, font, size, maxWidth) {
  if (!text) return;
  let s = text;
  while (s.length > 1 && font.widthOfTextAtSize(s, size) > maxWidth) {
    s = s.slice(0, -1);
  }
  page.drawText(s, { x, y, font, size, color: BLACK });
}

// ── Database queries ────────────────────────────────────────────────────────

async function queryActiveDies(pool, profile) {
  const { rows } = await pool.query(
    `SELECT die_no, raw_data
     FROM existing_die_details
     WHERE profile_number = $1
     ORDER BY die_no
     LIMIT 10`,
    [profile]
  );
  return rows;
}

async function queryExtrudedVolume(pool, dieNo) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::bigint AS total
     FROM existing_production_data
     WHERE die_no = $1`,
    [dieNo]
  );
  return Number(rows[0]?.total || 0);
}

async function queryOrderVolume(pool, profile) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(quantity), 0)::bigint AS total
     FROM existing_production_data
     WHERE profile_number = $1`,
    [profile]
  );
  return Number(rows[0]?.total || 0);
}

async function queryPrevSuppliers(pool, profile) {
  const { rows } = await pool.query(
    `SELECT DISTINCT supplier
     FROM die_orders
     WHERE die_no LIKE $1 || '-%'
       AND supplier IS NOT NULL
       AND supplier <> ''
     ORDER BY supplier`,
    [profile]
  );
  return rows.map((r) => r.supplier);
}

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Generate the filled BACK UP DIE ORDERING FORM (J-file).
 *
 * @param {object} backupRequest  Row from backup_die_requests (die_no, customer, press …)
 * @param {object} orderValues    Values from the Generate Order modal, including PENDING_ORDER_KG
 * @param {object} pool           pg Pool instance
 * @returns {Promise<Buffer>}     Filled PDF as Buffer
 */
async function generateJFilePdf(backupRequest, orderValues, pool) {
  const dieNo   = backupRequest.die_no || '';
  const profile = extractProfile(dieNo);

  // ── Parallel DB queries ─────────────────────────────────────────────────
  const [activeDieRows, orderVolume, prevSuppliersList] = await Promise.all([
    queryActiveDies(pool, profile),
    queryOrderVolume(pool, profile),
    queryPrevSuppliers(pool, profile),
  ]);

  // Per-die extruded volumes (sequential is fine — usually ≤10 rows)
  const extrudedVolumes = await Promise.all(
    activeDieRows.map((r) => queryExtrudedVolume(pool, r.die_no))
  );

  // ── Load template ───────────────────────────────────────────────────────
  const pdf  = await PDFDocument.load(getTemplateBytes());
  const page = pdf.getPages()[0];
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // ── Header ──────────────────────────────────────────────────────────────
  page.drawText(backupRequest.customer || '', {
    x: FIELD.customerName.x, y: FIELD.customerName.y, font, size: FS, color: BLACK,
  });

  page.drawText(formatKg(orderVolume), {
    x: FIELD.orderVolume.x, y: FIELD.orderVolume.y, font, size: FS, color: BLACK,
  });

  // ── Table Row 1 (the new die being ordered) ─────────────────────────────
  const dieType = orderValues.HOLLOW ? 'Hollow' : (orderValues.SOLID ? 'Solid' : '');
  const y1 = rowY(0); // 638

  page.drawText(extractProfile(dieNo),    { x: COL_X.profile,  y: y1, font, size: FS, color: BLACK });
  page.drawText(extractNewDieNo(dieNo),   { x: COL_X.newDieNo, y: y1, font, size: FS, color: BLACK });
  page.drawText(backupRequest.press || '', { x: COL_X.press,    y: y1, font, size: FS, color: BLACK });
  page.drawText(dieType,                  { x: COL_X.dieType,  y: y1, font, size: FS, color: BLACK });
  drawClamped(page, orderValues.DIE_SIZE || '', COL_X.dieSize, y1, font, FS, 70);

  // ── Active dies — "No. of Active Dies" + "Extruded Volume" columns ───────
  // Col 7 (activeDie) width ≈ 88 pt; col 8 (extruded) width ≈ 50 pt
  for (let i = 0; i < activeDieRows.length && i < 10; i++) {
    const y = rowY(i);
    const row = activeDieRows[i];
    const rawData = (typeof row.raw_data === 'object' && row.raw_data) ? row.raw_data : {};

    const supplier = getFieldFromRaw(rawData, [
      'supplier', 'die supplier', 'manufacturer', 'vendor', 'source', 'made by', 'madeby',
    ]) || '';
    const activeDieText = supplier ? `${row.die_no} ${supplier}` : row.die_no;
    drawClamped(page, activeDieText, COL_X.activeDie, y, font, FS_SM, 88);

    const vol = extrudedVolumes[i] || 0;
    if (vol > 0) {
      drawClamped(page, formatKg(vol), COL_X.extruded, y, font, FS_SM, 50);
    }
  }

  // ── Below-table fields ───────────────────────────────────────────────────
  drawClamped(page, orderValues.SUPPLIER || '', FIELD.prefSupplier.x, FIELD.prefSupplier.y, font, FS, 380);

  if (prevSuppliersList.length > 0) {
    drawClamped(page, prevSuppliersList.join(' , '), FIELD.prevSuppliers.x, FIELD.prevSuppliers.y, font, FS, 380);
  }

  // ── Die Ordering Explanation ─────────────────────────────────────────────
  page.drawText(formatKg(Number(orderValues.PENDING_ORDER_KG) || 0), {
    x: FIELD.pendingKg.x, y: FIELD.pendingKg.y, font, size: FS, color: BLACK,
  });
  page.drawText(formatDate(), {
    x: FIELD.asOnDate.x, y: FIELD.asOnDate.y, font, size: FS, color: BLACK,
  });

  return Buffer.from(await pdf.save());
}

module.exports = { generateJFilePdf, extractProfile, extractNewDieNo, formatKg, formatDate };
```

- [ ] **Step 4: Run tests — all should pass**

```powershell
node --test server/services/jFileTemplate.test.cjs
```
Expected: `✓ extractProfile: splits on first hyphen`, `✓ formatKg …`, `✓ generateJFilePdf: returns a Buffer …` — all 6 tests pass.

- [ ] **Step 5: Commit**

```powershell
git add server/services/jFileTemplate.cjs server/services/jFileTemplate.test.cjs
git commit -m "feat: add jFileTemplate service for J-file PDF generation"
```

---

## Task 3 — Extend VALUE_KEYS in dieOrderTemplate.cjs

**Files:**
- Modify: `server/services/dieOrderTemplate.cjs` (line ~257)

- [ ] **Step 1: Add `PENDING_ORDER_KG` to the exported array**

In `server/services/dieOrderTemplate.cjs`, find:
```javascript
const VALUE_KEYS = [
    'SUPPLIER', 'DATE', 'DIE_SIZE', 'NO_OF_CAV', 'PRESS',
    'SOLID', 'HOLLOW', 'BOLSTER_NO', 'INSERT_NO',
    'BOLSTER_SIZE', 'INSERT_SIZE', 'DELIVERY_DATE',
    'THREE_D_MODULE', 'SHIPMENT', 'PROFILE_WEIGHT_PCT',
    'FINISH_MILL', 'FINISH_ANODIZING', 'FINISH_POWDER',
];
```
Replace with:
```javascript
const VALUE_KEYS = [
    'SUPPLIER', 'DATE', 'DIE_SIZE', 'NO_OF_CAV', 'PRESS',
    'SOLID', 'HOLLOW', 'BOLSTER_NO', 'INSERT_NO',
    'BOLSTER_SIZE', 'INSERT_SIZE', 'DELIVERY_DATE',
    'THREE_D_MODULE', 'SHIPMENT', 'PROFILE_WEIGHT_PCT',
    'FINISH_MILL', 'FINISH_ANODIZING', 'FINISH_POWDER',
    'PENDING_ORDER_KG',
];
```

- [ ] **Step 2: Verify the array now contains 19 entries**

```powershell
node -e "const {VALUE_KEYS}=require('./server/services/dieOrderTemplate.cjs');console.log(VALUE_KEYS.length, VALUE_KEYS.includes('PENDING_ORDER_KG'))"
```
Expected: `19 true`

- [ ] **Step 3: Commit**

```powershell
git add server/services/dieOrderTemplate.cjs
git commit -m "feat: add PENDING_ORDER_KG to dieOrderTemplate VALUE_KEYS"
```

---

## Task 4 — Modify the generate-order-pdf Endpoint

**Files:**
- Modify: `server/routes/backup-requests.cjs`

The endpoint currently returns raw `application/pdf` bytes. After this task it returns JSON with two base64 PDFs.

- [ ] **Step 1: Add the import at the top of the file**

In `server/routes/backup-requests.cjs`, find the existing requires:
```javascript
const { generateBackupOrderPdf, VALUE_KEYS } = require('../services/dieOrderTemplate.cjs');
```
Replace with:
```javascript
const { generateBackupOrderPdf, VALUE_KEYS } = require('../services/dieOrderTemplate.cjs');
const { generateJFilePdf } = require('../services/jFileTemplate.cjs');
```

- [ ] **Step 2: Change the existence query to fetch the full row**

In the `/:id/generate-order-pdf` route handler, find:
```javascript
        const existsResult = await pool.query('SELECT 1 FROM backup_die_requests WHERE id = $1', [id]);
        if (existsResult.rowCount === 0) {
            return res.status(404).json({ error: 'Backup request not found' });
        }
```
Replace with:
```javascript
        const requestResult = await pool.query('SELECT * FROM backup_die_requests WHERE id = $1', [id]);
        if (requestResult.rowCount === 0) {
            return res.status(404).json({ error: 'Backup request not found' });
        }
        const backupRequest = requestResult.rows[0];
```

- [ ] **Step 3: Replace the PDF generation and response block**

Find:
```javascript
        try {
            const pdfBuffer = await generateBackupOrderPdf(req.body, values);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Content-Disposition', `attachment; filename="backup-die-order-${id}.pdf"`);
            res.send(pdfBuffer);
        } catch (error) {
            console.error('Generate order PDF error:', error);
            res.status(500).json({ error: 'Failed to generate die order PDF', detail: error.message });
        }
```
Replace with:
```javascript
        try {
            const [orderSettled, jFileSettled] = await Promise.allSettled([
                generateBackupOrderPdf(req.body, values),
                generateJFilePdf(backupRequest, values, pool),
            ]);

            // Order PDF is required — propagate failure
            if (orderSettled.status === 'rejected') throw orderSettled.reason;

            const orderPdf = orderSettled.value.toString('base64');

            let jFilePdf = null;
            let jFileError;
            if (jFileSettled.status === 'fulfilled') {
                jFilePdf = jFileSettled.value.toString('base64');
            } else {
                jFileError = jFileSettled.reason?.message || 'J-file generation failed';
                console.error('J-file generation error:', jFileSettled.reason);
            }

            const jFileName = (backupRequest.die_no || 'backup') + ' J.pdf';
            const response = { orderPdf, jFilePdf, jFileName };
            if (jFileError) response.jFileError = jFileError;
            res.json(response);
        } catch (error) {
            console.error('Generate order PDF error:', error);
            res.status(500).json({ error: 'Failed to generate die order PDF', detail: error.message });
        }
```

- [ ] **Step 4: Verify the route file has no syntax errors**

```powershell
node -e "require('./server/routes/backup-requests.cjs'); console.log('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```powershell
git add server/routes/backup-requests.cjs
git commit -m "feat: generate-order-pdf endpoint now returns JSON with orderPdf + jFilePdf base64"
```

---

## Task 5 — Update the API Client

**Files:**
- Modify: `src/api.js`

- [ ] **Step 1: Add `base64ToBlob` helper**

In `src/api.js`, just before the `backupRequestsAPI` export (around line 301), add:
```javascript
// Convert a base64 string to a Blob (used for J-file and order PDF download)
const base64ToBlob = (b64, mimeType) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
};
```

- [ ] **Step 2: Replace the `generateOrderPdf` method body**

Find the existing method (lines ~326-354):
```javascript
    generateOrderPdf: async (id, pdfFileOrBlob, values) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/backup-requests/${id}/generate-order-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/pdf',
                'X-Form-Values': encodeURIComponent(JSON.stringify(values || {})),
                ...(token && { Authorization: `Bearer ${token}` }),
            },
            body: pdfFileOrBlob,
        });
        if (!response.ok) {
            if (response.status === 401) {
                logout();
                window.location.reload();
            }
            let errMsg = `PDF generation failed (HTTP ${response.status})`;
            try {
                const j = await response.json();
                if (j?.error) errMsg = j.error;
                if (j?.detail) errMsg += `: ${j.detail}`;
            } catch (_) { /* response wasn't JSON */ }
            throw new Error(errMsg);
        }
        return await response.blob();
    },
```
Replace with:
```javascript
    generateOrderPdf: async (id, pdfFileOrBlob, values) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/backup-requests/${id}/generate-order-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/pdf',
                'X-Form-Values': encodeURIComponent(JSON.stringify(values || {})),
                ...(token && { Authorization: `Bearer ${token}` }),
            },
            body: pdfFileOrBlob,
        });
        if (!response.ok) {
            if (response.status === 401) {
                logout();
                window.location.reload();
            }
            let errMsg = `PDF generation failed (HTTP ${response.status})`;
            try {
                const j = await response.json();
                if (j?.error) errMsg = j.error;
                if (j?.detail) errMsg += `: ${j.detail}`;
            } catch (_) { /* response wasn't JSON */ }
            throw new Error(errMsg);
        }
        // Response is now JSON: { orderPdf, jFilePdf, jFileName, jFileError? }
        const data = await response.json();
        return {
            orderPdfBlob: base64ToBlob(data.orderPdf, 'application/pdf'),
            jFilePdfBlob: data.jFilePdf ? base64ToBlob(data.jFilePdf, 'application/pdf') : null,
            jFileName:    data.jFileName || 'backup J.pdf',
            jFileError:   data.jFileError,
        };
    },
```

- [ ] **Step 3: Commit**

```powershell
git add src/api.js
git commit -m "feat: update generateOrderPdf API client to handle JSON response with J-file"
```

---

## Task 6 — Update BackupDieRequests.jsx

**Files:**
- Modify: `src/components/backup/BackupDieRequests.jsx`

### Step 1 — Add PENDING_ORDER_KG to initial orderValues

- [ ] In `openOrderModal` (around line 354), find the `setOrderValues({` call and add `PENDING_ORDER_KG: '0'` as the last property:

Find:
```javascript
    setOrderValues({
      SUPPLIER: '',
      DATE: getTodayDateString(),
      DIE_SIZE: '',
      NO_OF_CAV: request['Cavity'] ? String(request['Cavity']) : '',
      PRESS: request['Press'] || '',
      SOLID: '',
      HOLLOW: '',
      BOLSTER_NO: '',
      INSERT_NO: '',
      BOLSTER_SIZE: '',
      INSERT_SIZE: '',
      DELIVERY_DATE: request['Requested Date'] || '',
      THREE_D_MODULE: '',
      SHIPMENT: '',
      PROFILE_WEIGHT_PCT: '',
      FINISH_MILL: false,
      FINISH_ANODIZING: false,
      FINISH_POWDER: false,
    });
```
Replace with:
```javascript
    setOrderValues({
      SUPPLIER: '',
      DATE: getTodayDateString(),
      DIE_SIZE: '',
      NO_OF_CAV: request['Cavity'] ? String(request['Cavity']) : '',
      PRESS: request['Press'] || '',
      SOLID: '',
      HOLLOW: '',
      BOLSTER_NO: '',
      INSERT_NO: '',
      BOLSTER_SIZE: '',
      INSERT_SIZE: '',
      DELIVERY_DATE: request['Requested Date'] || '',
      THREE_D_MODULE: '',
      SHIPMENT: '',
      PROFILE_WEIGHT_PCT: '',
      FINISH_MILL: false,
      FINISH_ANODIZING: false,
      FINISH_POWDER: false,
      PENDING_ORDER_KG: '0',
    });
```

### Step 2 — Update handleGenerateOrderPdf

- [ ] Find the entire `handleGenerateOrderPdf` function (lines ~404-434) and replace it:

Find:
```javascript
  const handleGenerateOrderPdf = async () => {
    if (!orderFileHandle || !orderRow) return;

    setOrderBusy(true);
    setOrderError('');
    try {
      const permOpts = { mode: 'readwrite' };
      if (orderFileHandle.queryPermission) {
        let permission = await orderFileHandle.queryPermission(permOpts);
        if (permission !== 'granted' && orderFileHandle.requestPermission) {
          permission = await orderFileHandle.requestPermission(permOpts);
        }
        if (permission !== 'granted') {
          throw new Error('Permission to overwrite the file was denied.');
        }
      }

      const file = await orderFileHandle.getFile();
      const generated = await backupRequestsAPI.generateOrderPdf(orderRow.id, file, orderValues);
      const writable = await orderFileHandle.createWritable();
      await writable.write(generated);
      await writable.close();

      setShowOrderModal(false);
      alert(`Die order saved to "${orderFileHandle.name}". The original file has been replaced.`);
    } catch (error) {
      setOrderError(error.message || String(error));
    } finally {
      setOrderBusy(false);
    }
  };
```
Replace with:
```javascript
  const handleGenerateOrderPdf = async () => {
    if (!orderFileHandle || !orderRow) return;

    setOrderBusy(true);
    setOrderError('');
    try {
      const permOpts = { mode: 'readwrite' };
      if (orderFileHandle.queryPermission) {
        let permission = await orderFileHandle.queryPermission(permOpts);
        if (permission !== 'granted' && orderFileHandle.requestPermission) {
          permission = await orderFileHandle.requestPermission(permOpts);
        }
        if (permission !== 'granted') {
          throw new Error('Permission to overwrite the file was denied.');
        }
      }

      const file = await orderFileHandle.getFile();
      const { orderPdfBlob, jFilePdfBlob, jFileName, jFileError } =
        await backupRequestsAPI.generateOrderPdf(orderRow.id, file, orderValues);

      // Write stamped order PDF back to the chosen file (existing behaviour)
      const writable = await orderFileHandle.createWritable();
      await writable.write(orderPdfBlob);
      await writable.close();

      // Download J-file via browser download
      if (jFilePdfBlob) {
        const url = URL.createObjectURL(jFilePdfBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = jFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      setShowOrderModal(false);
      if (jFileError) {
        alert(`Order PDF saved to "${orderFileHandle.name}".\nJ-file could not be generated: ${jFileError}`);
      } else {
        alert(`Order PDF saved to "${orderFileHandle.name}". J-file downloaded as "${jFileName}".`);
      }
    } catch (error) {
      setOrderError(error.message || String(error));
    } finally {
      setOrderBusy(false);
    }
  };
```

### Step 3 — Add PENDING ORDER KG input to the modal form

- [ ] In the Generate Die Order PDF modal form grid (around line 1117), find the PROFILE WEIGHT START % field:

```jsx
              <div>
                <label style={labelStyle}>PROFILE WEIGHT START %</label>
                <input type="text" value={orderValues.PROFILE_WEIGHT_PCT} onChange={(e) => setOrderValues({ ...orderValues, PROFILE_WEIGHT_PCT: e.target.value })} style={inputStyle} placeholder="e.g. 85" />
              </div>
```
Replace with:
```jsx
              <div>
                <label style={labelStyle}>PROFILE WEIGHT START %</label>
                <input type="text" value={orderValues.PROFILE_WEIGHT_PCT} onChange={(e) => setOrderValues({ ...orderValues, PROFILE_WEIGHT_PCT: e.target.value })} style={inputStyle} placeholder="e.g. 85" />
              </div>

              <div>
                <label style={labelStyle}>PENDING ORDER (KG)</label>
                <input type="text" value={orderValues.PENDING_ORDER_KG} onChange={(e) => setOrderValues({ ...orderValues, PENDING_ORDER_KG: e.target.value })} style={inputStyle} placeholder="e.g. 16280" />
              </div>
```

- [ ] **Step 4: Verify the app builds without errors**

```powershell
npm run build 2>&1 | Select-Object -Last 20
```
Expected: build completes with no errors.

- [ ] **Step 5: Commit**

```powershell
git add src/components/backup/BackupDieRequests.jsx src/api.js
git commit -m "feat: add PENDING ORDER KG field and J-file download to Generate Order modal"
```

---

## Task 7 — End-to-End Verification

- [ ] **Step 1: Start the app**

```powershell
npm run dev
```

- [ ] **Step 2: Navigate to Backup Die Requests, click the FileText icon on any request**

Verify the modal opens and shows the new **PENDING ORDER (KG)** field at the bottom.

- [ ] **Step 3: Fill in the form, select a profile drawing PDF, click "Generate & Save"**

Expected outcomes:
1. The chosen PDF file is overwritten with the die-order stamp (existing behaviour).
2. A browser download prompt appears / file downloads named `{die_no} J.pdf`.
3. A success alert appears: *"Order PDF saved to … J-file downloaded as …"*

- [ ] **Step 4: Open the downloaded J-file and verify fields**

Check that the generated J-file contains:
- Customer name in the Customer Name row
- Order volume in the Order Volume row
- Profile, New Die No., Press, Die Type, Die Size in Row 1 of the table
- Active dies (if any in the DB) in the No. of Active Dies column
- Preferred Supplier below the table
- Pending order Kg and today's date in the Die Ordering Explanation

- [ ] **Step 5: Final commit**

```powershell
git add -A
git commit -m "feat: complete J-file auto-generation from die list and production data"
```
