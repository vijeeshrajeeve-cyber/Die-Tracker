# J-File Auto-Generation Design

**Date:** 2026-05-27  
**Status:** Approved  
**Feature:** Auto-generate the Backup Die Ordering Form (J-file) during die order PDF preparation

---

## Overview

When a user clicks "Generate & Save" in the Generate Die Order PDF modal on the Backup Die Requests page, the system will **also automatically generate the J-file** (the BACK UP DIE ORDERING FORM) by pulling data from the existing die list and production data tables. The user only needs to supply one new input: the pending order quantity in Kg.

---

## Background

Each backup die request has two associated documents:
1. **Profile Drawing PDF** — an existing PDF the user selects; the die-order template is stamped onto its first page.
2. **J-file** — the `BACK UP DIE ORDERING FORM`, a US Letter (612×792 pt) template at `server/assets/backup-j-template.pdf`. Named `{die_no} J.pdf` (e.g. `014752-702 J.pdf`).

The J-file is currently filled manually. This feature automates it.

---

## Architecture

```
User clicks "Generate & Save"
        │
        ▼
BackupDieRequests.jsx — handleGenerateOrderPdf()
        │
        │  POST /api/backup-requests/:id/generate-order-pdf
        │  Body: raw profile drawing PDF bytes
        │  Header: X-Form-Values (JSON, URL-encoded) — existing + pendingOrderKg
        │
        ▼
server/routes/backup-requests.cjs
        ├── generateBackupOrderPdf(pdfBytes, values)   ← unchanged
        │
        └── generateJFilePdf(backupRequest, values, pool)  ← NEW
            ├── loads server/assets/backup-j-template.pdf
            ├── queries existing_die_details by profile
            ├── queries existing_production_data for volumes
            ├── queries die_orders for previous suppliers
            └── stamps text at measured coordinates
        │
        ▼
Response: JSON
  {
    orderPdf:  "<base64>",       // stamped profile drawing
    jFilePdf:  "<base64>",       // filled J-file (null if generation failed)
    jFileName: "014752-702 J.pdf",
    jFileError: "..."            // present only if jFilePdf is null
  }
        │
        ▼
Client:
  ├── writes orderPdf → overwrites chosen file (existing behaviour)
  └── downloads jFilePdf → browser download as jFileName
      (if jFilePdf null → shows non-blocking warning toast)
```

---

## File Changes

| File | Change |
|---|---|
| `server/assets/backup-j-template.pdf` | **NEW** — copy of the standard template |
| `server/services/jFileTemplate.cjs` | **NEW** — J-file filling service |
| `server/routes/backup-requests.cjs` | **MODIFIED** — call jFileTemplate, change response shape |
| `src/api.js` | **MODIFIED** — `generateOrderPdf` returns `{orderPdfBlob, jFilePdfBlob, jFileName, jFileError}` |
| `src/components/backup/BackupDieRequests.jsx` | **MODIFIED** — add `PENDING_ORDER_KG` field, handle J-file download |

---

## Data Mapping

### Template: BACK UP DIE ORDERING FORM (US Letter, 612×792 pt)

#### Auto-filled — no new user input needed:

| Template Field | Source |
|---|---|
| Customer Name | `backup_die_requests.customer` |
| Row 1 → Profile | `die_no.split('-')[0]` e.g. `014752` from `014752-702` |
| Row 1 → New Die No. | `die_no` after first `-` e.g. `702` |
| Row 1 → Press | `backup_die_requests.press` |
| Row 1 → Die Type | `orderValues.SOLID` → "Solid" / `orderValues.HOLLOW` → "Hollow" |
| Row 1 → Die Size | `orderValues.DIE_SIZE` |
| Preferred Supplier | `orderValues.SUPPLIER` |
| Active dies — No. of Active Dies (col 7, rows 1–10) | `SELECT die_no, raw_data FROM existing_die_details WHERE profile_number = '{profile}' LIMIT 10` — formatted as `{die_no} {supplier}` where supplier comes from `raw_data` if present, else from most recent `die_orders.supplier` for that die |
| Active dies — Extruded Volume (col 8, rows 1–10) | `SELECT SUM(quantity) FROM existing_production_data WHERE die_no = '{each_active_die}'` — formatted as `{value} Kg` |
| Order Volume last 12 Months | `SELECT SUM(quantity) FROM existing_production_data WHERE profile_number = '{profile}'` formatted as `{value} Kg` |
| Previous suppliers | `SELECT DISTINCT supplier FROM die_orders WHERE die_no LIKE '{profile}%' AND supplier IS NOT NULL` — comma-separated |
| Die Ordering Explanation | `Pending order- {pendingOrderKg} Kg    as on {dd/mm/yyyy today}` |

#### One new user-supplied input:

| Form Field | Key in X-Form-Values | Default | Usage |
|---|---|---|---|
| Pending Order (Kg) | `PENDING_ORDER_KG` | `0` | Stamped in Die Ordering Explanation |

#### Reason checkboxes:
Default: **High Order Volume Expected ☑** and **Other ☑** — same as all analysed real J-files. No checkbox UI added; defaults are hardcoded.

---

## Active Dies Table Layout

Row 1 fills all 8 columns.  
Rows 2–10 fill only columns 7 (No. of Active Dies) and 8 (Extruded Volume), matching the real J-file pattern.

---

## J-File Service: `server/services/jFileTemplate.cjs`

```
generateJFilePdf(backupRequest, orderValues, pool) → Promise<Buffer>
```

Uses `pdf-lib` coordinate-based text stamping (same pattern as `dieOrderTemplate.cjs`).  
Template page dimensions: 612 × 792 pt (US Letter).  
Coordinates to be measured from the template during implementation.

---

## Modified Endpoint

`POST /api/backup-requests/:id/generate-order-pdf`

**Input:** unchanged (raw PDF bytes body + `X-Form-Values` header, now including `PENDING_ORDER_KG`)

**Output:** changes from raw `application/pdf` bytes to `application/json`:
```json
{
  "orderPdf":  "<base64 string>",
  "jFilePdf":  "<base64 string | null>",
  "jFileName": "014752-702 J.pdf",
  "jFileError": "<string, omitted if jFilePdf is present>"
}
```

J-file generation runs in `Promise.all` alongside the order PDF.  
If J-file generation throws, the error is caught, `jFilePdf` is set to `null`, and `jFileError` is populated — the main order PDF is always returned.

`VALUE_KEYS` in `dieOrderTemplate.cjs` gains `PENDING_ORDER_KG`.

---

## Modified API Client

`backupRequestsAPI.generateOrderPdf(id, pdfFileOrBlob, values)` now returns:
```js
{
  orderPdfBlob: Blob,
  jFilePdfBlob: Blob | null,
  jFileName: string,
  jFileError: string | undefined
}
```

---

## Frontend Changes

### New field in Generate Order modal:
- Label: **PENDING ORDER (KG)**
- Key: `PENDING_ORDER_KG`
- Type: `text` input (free entry, e.g. `16280`)
- Default: `0`
- Positioned in the existing 2-column grid after PROFILE WEIGHT START %

### handleGenerateOrderPdf updates:
1. Write `orderPdfBlob` back to chosen file — unchanged.
2. If `jFilePdfBlob`:
   - Create object URL → trigger anchor download → revoke URL
   - Filename: `jFileName`
3. If `jFileError`:
   - Show warning (non-blocking): *"Order PDF saved. J-file could not be generated: {jFileError}"*
4. Modal closes after both steps.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| No die list data for profile | Active die rows blank; J-file still generated |
| No production data for profile | Order Volume and Extruded Volumes show `0 Kg` |
| J-file generation throws | `jFilePdf: null`, `jFileError` set; order PDF still returned and saved |
| Die number has no `-` | Full die_no used as Profile; New Die No. blank |
| More than 10 active dies | Only first 10 stamped (table limit) |
| Supplier not found | Die number shown without supplier suffix |
| Previous suppliers list empty | Field left blank |

---

## J-File Naming Convention

`{die_no} J.pdf` — space before capital J, matching observed files:
- `014752-702 J.pdf`
- `026003-802 J.pdf`
- `24216-201 J.pdf`

---

## Out of Scope

- Editing or previewing the J-file before download
- Saving J-file back via File System Access API (browser download is sufficient)
- Adding UI for reason checkboxes (defaults cover all real-world cases seen)
- Rows 2–5 Profile/New Die No./Press/Die Type/Die Size columns (blank by design, matching real J-files)
