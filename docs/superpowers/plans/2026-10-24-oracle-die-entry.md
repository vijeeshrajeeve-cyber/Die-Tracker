# Oracle Die Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Hollow/Solid on orders, let toolings skip Oracle Entry, and give Dinesh a batch copy + "Fill die" bookmarklet that fills Oracle's die-creation screens.

**Architecture:** A new `die_orders.die_type` column (PDF import + one-time mandrel backfill + drawer edit). A small shared rule module `src/utils/oracleEntry.js` holds the tooling skip and the tracker→Oracle value mapping; the bookmarklet is a self-contained function in `src/utils/oracleFill.js` serialised into a `javascript:` URL.

**Tech Stack:** React (rolldown-vite), Express + pg, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-24-oracle-die-entry-design.md`

## Global Constraints

- Die type values: `'HOLLOW' | 'SOLID' | null`; API key `Die Type`; column `die_type`.
- Tooling = `TYPE === 'T'`. Toolings never get a die type, never enter Oracle Entry, never appear in a batch.
- Oracle defaults: category `GEX.DIE`, items `1`, description `Die`, status `Active`, reason `Die available`, die life Hollow `55` / Solid `50`, presses row priority `1`, remark `.`, correctors `IMRAN` ×2, press `P2` → `2`, dates `dd-Mon-yyyy`.
- The bookmarklet never clicks an Oracle button and never fills a field it cannot positively identify by label.
- Backend tests: `npm test`. Frontend: `npx eslint <changed files>` + `npm run build` (repo-wide lint has 77 pre-existing problems).

## Review Focus

- PDF with no mark or marks on both Solid and Hollow → die type stays blank (Task 1 test).
- Bolster/insert sub-orders cut from a die's PDF must not inherit the die's type (Task 1 test).
- Die numbers with leading zeros or extra dashes (`030724-701`, `BOL 2-2-A`) → split on the last `-`; non-numeric index → die excluded from batch with a reason (Task 4 test).
- Die Size not `NNNxNNN` (e.g. `N/A`) → diameter/thickness left for Dinesh, flagged (Task 4 test).
- A tooling in Design to EMS with blank Oracle Entry must still get an entry date (work queue + daily summary) (Task 3 test).

---

### Task 1: Read Solid/Hollow from the die order PDF

**Files:**
- Modify: `src/utils/pdfImportFields.js` (add `readDieType`)
- Test: `src/utils/pdfImportFields.test.js`
- Modify: `src/components/modals/PDFImportModal.jsx` (Format A loop, `mainOrder`, `createSubOrder`)
- Modify: `src/utils/pdfImportFills.js` (`FILLABLE_FIELDS` gains `'Die Type'`)

**Interfaces:**
- Produces: `readDieType(items: {text: string, x: number}[]) -> 'HOLLOW' | 'SOLID' | null`

- [ ] Tests: `SOLID - HOLLOW - OK` → HOLLOW; `SOLID - OK HOLLOW -` → SOLID; `SOLID - YES HOLLOW -` → SOLID; `SOLID - ok HOLLOW -` → SOLID; `SOLID - HOLLOW -` → null; `SOLID - OK HOLLOW - OK` → null; trailing junk after HOLLOW's mark (`OK 30732-401,`) still HOLLOW. Items given as separate `{text,x}` tokens in x order.
- [ ] Run, see fail. Implement: find the SOLID and HOLLOW label items by x; a mark token matches `/^(OK|YES|Y|✓|✔|√)$/i`; mark with x between the labels → SOLID, after HOLLOW (first token only) → HOLLOW.
- [ ] In Format A, on the line containing both labels call it with that line's items; if null and the next line has a lone mark, re-run on combined items. Main order gets `'Die Type': dieType || existingOrderRaw?.['Die Type'] || null`; sub-orders set `'Die Type': null`.
- [ ] Run the parser harness (memory: rolldown bundle) over the 15 sample PDFs; record which read HOLLOW/SOLID/null. Expect Format A PDFs to agree with their `pdftotext` line.
- [ ] `npm test`, eslint, commit `feat(pdf-import): capture Solid/Hollow die type`.

### Task 2: Store die type and backfill existing orders

**Files:**
- Modify: `server/db.cjs` (column + one-time backfill guarded by `app_migrations` id `die_type_backfill_v1`), `init.sql`
- Modify: `server/routes/orders.cjs` (POST insert, PATCH `FIELD_MAP`, validation `isIn(['HOLLOW','SOLID',''])`)
- Modify: `server/services/orderPresentation.cjs`, `server/services/orderDetailEdits.cjs`, `src/utils/orderDetailEdits.js` (`'Die Type': { type: 'text', oneOf: ['HOLLOW','SOLID'] }`)
- Modify: `src/DieOrderingSystem.jsx` drawer details (select Hollow/Solid/blank next to Mandrels)
- Test: `server/services/orderDetailEdits.test.cjs` / `src/utils/orderDetailEdits.test.js` parity already enforced; add a `presentOrder` assertion.

- [ ] Backfill SQL: `UPDATE die_orders SET die_type = CASE WHEN COALESCE(mandrels_per_cavity,0) > 0 THEN 'HOLLOW' ELSE 'SOLID' END WHERE die_type IS NULL AND COALESCE(type,'') <> 'T'`, run once.
- [ ] Tests pass, eslint, build; rebuild backend on the test server and confirm the column + counts by type. Commit `feat(orders): die type column with mandrel backfill`.

### Task 3: Toolings skip Oracle Entry

**Files:**
- Create: `src/utils/oracleEntry.js` + `src/utils/oracleEntry.test.js`
- Modify: `src/pages/FlowPage.jsx` (`handleCompleteStep`, stage date), `src/DieOrderingSystem.jsx` (`determineStatus`, stage date ~2715), `src/pages/OrdersPage.jsx:37`
- Modify: `server/services/dailySummaryData.cjs:94` (`ageFrom: ['oracle_entry', 'pr_entry']`), `server/migrations/20260921_work_queue.sql:206` (anchor `COALESCE(NULLIF(s->>'oracle_entry',''), s->>'pr_entry')`)

**Interfaces:**
- Produces: `isTooling(order) -> boolean`; `nextStatusAfter(order, status) -> string` (PR on a tooling → `'PENDING FOR DESIGN TO EMS'`, else `WORKFLOW_STEPS[status].nextStatus`); `designToEmsSince(order) -> string|null` (`Oracle Entry` || `PR Entry`).

- [ ] Tests for all three, including `TYPE` lowercase/blank.
- [ ] `determineStatus`: when PR + design dates are set and the order is a tooling, skip to the Design-to-EMS/DONE checks as if Oracle Entry were set (without writing it).
- [ ] Daily-summary test for a tooling at Design to EMS aging from `pr_entry`.
- [ ] Commit `feat(flow): toolings skip Oracle Entry`.

### Task 4: Oracle batch payload

**Files:** add to `src/utils/oracleEntry.js` + tests.

**Interfaces:**
- Produces: `toOracleDie(order) -> { ok: true, die } | { ok: false, reason }` where `die = { dieNo, profileId, dieIndex, itemCode, cavities, diameter, thickness, supplier, supplierNames: string[], dieType: 'Hollow'|'Solid'|null, dieLife: 55|50|null, press, orderedDate, flags: string[] }`; `buildOracleBatch(orders) -> { text, dies, skipped: [{dieNo, reason}] }`, `text = 'DIETRACKER-ORACLE-BATCH v1\n' + JSON.stringify(dies)`.
- `itemCode = 'GEX.DIE_' + profileId + '_' + dieIndex`; `supplierNames` = the code plus every `SUPPLIER_ALIASES` key mapping to it; date `21-Oct-2026`; flags e.g. `'die type missing'`, `'size not NNNxNNN'`, `'press missing'`.

- [ ] Tests: 30713-201 (PHME, P2, 320X160, cav 1, HOLLOW, ordered 2026-10-21) → exact die object from the recording; tooling → skipped; `030724-701` keeps leading zero; `N/A` size flagged.
- [ ] Commit `feat(oracle): batch payload for Oracle die entry`.

### Task 5: Fill die bookmarklet

**Files:** Create `src/utils/oracleFill.js` (self-contained `export function oracleFill()` — no imports, no closures over module scope), `src/utils/oracleFill.test.js` (serialisation: `bookmarkletHref()` starts with `javascript:` and `new Function` parses the body).

Behaviour (spec §3): screen detection by heading text (`Create Item` + `Create Selection`; `Enter Number/Description`; `Update GEX`); field lookup by label text → nearest following `input/select/textarea` in the same table row; select by option text (case-insensitive, then `supplierNames` match, then startsWith); fire `input`/`change`/`blur`; batch in `localStorage['dietracker.oracleBatch']` with `pointer`; Update GEX picks the die from `Item: GEX.DIE_…` header; floating panel with filled/missed lists and Prev/Next/New batch/Close.

- [ ] Verify against a static mock of the three Oracle screens built from the recording (scratchpad), in the browser pane.
- [ ] Commit `feat(oracle): Fill die bookmarklet`.

### Task 6: Oracle Entry page UI

**Files:** Modify `src/pages/FlowPage.jsx` (Oracle Entry only: row checkboxes, "Copy batch for Oracle" using the existing clipboard fallback, skipped-dies toast, "Set up Fill die" panel with the draggable link and 3-line instructions).

- [ ] eslint, build, browser check on the dev server against the test server API; screenshot. Commit `feat(oracle): copy batch + Fill die setup on Oracle Entry page`.
