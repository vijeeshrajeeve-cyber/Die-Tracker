# PDF Import Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite the PDFImportModal to extract die order data from the structured info box in die drawing PDFs using position-based text extraction, with batch multi-file upload support.

**Architecture:** Replace the crude regex-based extraction with PDF.js positional text grouping (same proven technique as PIImportModal). Support multiple file upload with preview table. Switch from single-record `onAddRecord` to batch `onImportRecords` callback.

**Tech Stack:** PDF.js (pdfjs-dist, already installed), React (inline component in DieOrderingSystem.jsx)

---

### Task 1: Rewrite PDFImportModal with Position-Based Extraction + Batch Support

**Files:**
- Modify: `src/DieOrderingSystem.jsx:233-416` (inline PDFImportModal component)
- Modify: `src/DieOrderingSystem.jsx:2839` (render line - change props)
- Modify: `src/components/modals/PDFImportModal.jsx` (standalone copy - replace entirely)

**Key discovery:** There are TWO copies of PDFImportModal:
1. **Inline** in `DieOrderingSystem.jsx` at line 233-416 - THIS is what's actually used
2. **Standalone** in `src/components/modals/PDFImportModal.jsx` - exists but NOT imported by DieOrderingSystem

Both need to be updated. The inline version is the one rendered at line 2839.

**Step 1: Rewrite the inline PDFImportModal in DieOrderingSystem.jsx (lines 233-416)**

Replace the entire `const PDFImportModal = ...` block with the new implementation below.

The new component:
- Accepts `{ onClose, onImportRecords, existingOrders }` props (matching PIImportModal pattern)
- Supports multi-file upload (drag-and-drop + file picker with `multiple`)
- Parses each PDF using position-based text extraction
- Shows preview table with editable Type/Plant columns and remove button
- Detects existing orders for update flagging

**PRESS to Plant mapping:**
```javascript
const PRESS_TO_PLANT_PDF = {
  '25': 'GEX 2', 'P25': 'GEX 2',
  '35': 'GEX 2', 'P35': 'GEX 2',
  '2': 'GEX 1', 'P2': 'GEX 1',
  '4': 'GEX 1', 'P4': 'GEX 1',
  '5': 'GEX 1', 'P5': 'GEX 1',
  'B': 'GEX 1', 'D': 'GEX 1', 'E': 'GEX 1', 'F': 'GEX 1',
};
```

**PDF parsing function `parseSinglePDF(file, existingOrders)`:**

1. Load PDF with `pdfjsLib.getDocument()`
2. Get page 1, call `getTextContent()`
3. Group text items by Y position (round to nearest int, merge within 3px)
4. Sort each Y group by X position, join into line text
5. Scan lines for labeled fields using these patterns:

| Label Pattern | Value Extraction | Field |
|---|---|---|
| `SUPPLIER` on same line | Next non-empty text after "SUPPLIER" | Supplier |
| Date pattern `DD/MM/YYYY` on SUPPLIER line | parseDateDMY | Die Requested Date |
| `DIE SIZE` | `(\d{2,4})[Xx](\d{2,4})` | Die Size |
| `No OF CAV` or `No. of cavites` | `(\d+)` | Mandrels per Cavity |
| `PRESS` | `P?\s*(\d{1,2}|[A-F])` | Plant (via mapping) |
| `SOLID` | Value after label: Yes/OK/Solid | _solid (display) |
| `HOLLOW` | Value after label | _hollow (display) |
| `INSERT No` | Text after label | _insertNo (display) |
| `3D MODULE` or `3D Module` | Yes/OK/No | simulationEnabled |
| `MODE OF SHIPMENT` or `SHIPMENT` | "Air" -> AIR, else LAND | Type of shipment |
| `PROFILE WEIGHT` | `-?\d+(\.\d+)?\s*%` | _weightNote (display) |
| `FINISH` line context | Detect Mill/Anodizing/Powder | _finish (display) |

6. Extract die number: first from filename `(\d{3,6}[-_]\d{2,4})`, confirmed from PDF bottom area
7. Parse filename metadata: urgency, component type, revision, copy

**Filename metadata extraction:**
```javascript
const extractFilenameMetadata = (filename) => {
  const name = filename.replace(/\.pdf$/i, '');
  return {
    dieNo: (name.match(/^(\d{3,6}[-_]\d{2,4})/) || [])[1] || name.replace(/[-\s]*(urgent|urgetn|R|Die plate only|Insert Mandrel only|- Copy).*$/i, '').trim(),
    isUrgent: /[-\s](urgent|urgetn)/i.test(name),
    isDiePlateOnly: /die\s*plate\s*only/i.test(name),
    isInsertMandrelOnly: /insert\s*mandrel\s*only/i.test(name),
    isRevision: /[-\s]R(?:\.pdf)?$/i.test(filename) || /[-_]\d{2,4}-R/i.test(name),
    isCopy: /- Copy/i.test(name),
  };
};
```

**Build order record (same shape as PIImportModal):**
```javascript
{
  id: existingOrder?.id || null,
  isExisting: !!existingOrder,
  Plant: plantFromPress || 'GEX 1',
  'Order No': existingOrder?.['Order No'] || `PDF-${Date.now().toString().slice(-6)}`,
  'DIE NO': dieNo,
  TYPE: existingOrder?.TYPE || null,
  'Die Size': dieSize || 'N/A',
  'Die Requested Date': requestedDate || null,
  'Ordered date': null,
  'Type of shipment': shipmentType,
  'Mandrels per Cavity': cavity || 0,
  'Total Mandrels': 0,
  'Design Received Date': null,
  '3D Model Received Date': null,
  simulationEnabled: simulationEnabled,
  'Design Approved Date': null,
  Delay: 0,
  'PR Entry': null,
  'Oracle Entry': null,
  Supplier: supplier,
  STATUS: existingOrder?.STATUS || 'PENDING FOR ORDERING',
  'OVERALL DELAY': 0,
  ETA: null,
  month: requestedDate ? MONTHS[new Date(requestedDate).getMonth()] : null,
  // Display-only metadata
  _urgency: meta.isUrgent ? 'URGENT' : null,
  _componentType: meta.isDiePlateOnly ? 'DIE PLATE ONLY' : meta.isInsertMandrelOnly ? 'INSERT MANDREL ONLY' : null,
  _isRevision: meta.isRevision,
  _cavity: cavity,
  _finish: finish,
}
```

**UI layout (matches PIImportModal style):**
- Modal width: `maxWidth: '1100px'` (wider for table)
- Header: orange-red gradient icon, "Import Die Order PDFs" title
- Drop zone: accepts `multiple` files
- Progress: show parsing progress "Parsing 3 of 12 PDFs..."
- Error summary: list files that failed to parse
- Preview table columns: Die No (with badges), Size, Supplier, Plant (dropdown), Type (dropdown), Cavity, Shipment, Req Date, Actions (remove)
- Badges: URGENT (red), DIE PLATE ONLY (blue), MANDREL ONLY (purple), REVISION (gray)
- Footer: "Import N Die Orders" button, same import logic as PIImportModal

**Step 2: Update the render line in DieOrderingSystem.jsx**

Change line 2839 from:
```jsx
{showPDFImportModal && <PDFImportModal onClose={() => setShowPDFImportModal(false)} onAddRecord={handleAddRecord} />}
```
To:
```jsx
{showPDFImportModal && <PDFImportModal onClose={() => setShowPDFImportModal(false)} onImportRecords={handlePIImport} existingOrders={data} />}
```

This reuses the same `handlePIImport` function that PIImportModal uses, which handles both create and update.

**Step 3: Update the standalone PDFImportModal.jsx**

Replace `src/components/modals/PDFImportModal.jsx` with the same component code (extracted to standalone file). This keeps the standalone file in sync even though the inline version is what's actually used.

**Step 4: Test manually**

1. Run `npm run dev`
2. Upload a single PDF from TestData (e.g., `007097-2506.pdf`) - verify extraction:
   - Die No: `007097-2506`
   - Supplier: `PDTMC`
   - Die Requested Date: `2026-01-12` (from DATE field)
   - Die Size: `280X160`
   - Plant: `GEX 2` (from P25)
   - Shipment: `LAND` (By Road)
   - Simulation: No
3. Upload multiple PDFs at once - verify all appear in preview table
4. Upload an urgent file (e.g., `11598-438-urgent.pdf`) - verify URGENT badge appears
5. Upload a "Die plate only" file - verify badge appears
6. Test editing Type and Plant dropdowns in preview
7. Test removing an order from preview
8. Import and verify records created in database

**Step 5: Commit**

```bash
git add src/DieOrderingSystem.jsx src/components/modals/PDFImportModal.jsx
git commit -m "feat: improve PDF import with position-based extraction and batch support"
```
