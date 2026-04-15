# PDF Import Improvement Design

## Problem

The current `PDFImportModal` uses basic extraction:
- Die number from filename only
- First 4+ letter word as supplier (unreliable)
- First date found as requested date
- Crude regex for die size
- No batch support

The die drawing PDFs (TestData/) contain a structured info box with labeled fields that can be reliably extracted using position-based text extraction.

## Approach

**Position-based info box extraction** (same technique as PIImportModal) with batch multi-file upload support.

## Field Mapping

| PDF Info Box Field | System Field | Extraction Method |
|---|---|---|
| Die number (bottom-right of PDF + filename) | DIE NO | Regex `\d{3,6}-\d{2,4}` from filename, confirmed from PDF content |
| SUPPLIER | Supplier | Label-adjacent text extraction |
| DATE (next to SUPPLIER) | Die Requested Date | DD/MM/YYYY parse |
| DIE SIZE | Die Size | Label-adjacent, normalize to `NNNxNNN` format |
| No OF CAV | Mandrels per Cavity | Integer extraction |
| PRESS | Plant (via mapping) | P25/P35 -> GEX 2, P2/P4/P5/B/D/E/F -> GEX 1 |
| SOLID / HOLLOW | (display only) | Yes/No/OK detection |
| INSERT No | (display only) | Label-adjacent text |
| REQUESTED DELIVERY DATE | *Ignored* | - |
| 3D MODULE FOR SIMULATION | simulationEnabled | Yes/No/OK detection |
| MODE OF SHIPMENT | Type of shipment | "By Air" -> AIR, "By Road" -> LAND |
| NOTE: PROFILE WEIGHT... % | (display only) | Extract percentage |
| FINISH | (display only) | Detect Mill/Anodizing/Powder |

**Ordered date** is left null (set later when order is actually placed).

## Filename Intelligence

Extract metadata from filename patterns:
- **Urgency**: `-urgent` or `-urgetn` suffix
- **Component type**: `Die plate only`, `Insert Mandrel only`
- **Revision**: `-R` suffix
- **Copy**: `- Copy` suffix

These appear as badge tags in the preview table.

## Plant Mapping (PRESS -> Plant)

```
P25, P35 -> GEX 2
P2, P4, P5 -> GEX 1
B, D, E, F -> GEX 1
```

## Batch Upload

- Accept multiple PDF files via drag-and-drop or file picker
- Parse each file independently, collect results into a single preview table
- Each row is editable (Type, Plant dropdowns) and removable
- Existing order detection: flag die numbers already in system for update
- Import all at once

## Preview Table Columns

Die No | Size | Supplier | Plant | Type | Cavity | Shipment | Req. Date | Badges | Actions

Badges: URGENT (red), Die Plate Only (blue), Insert Mandrel Only (purple), Revision (gray)

## Parsing Strategy

1. Load PDF with PDF.js
2. Extract page 1 text content with positional data (transform[4]=X, transform[5]=Y)
3. Group text items by Y position (3px merge tolerance)
4. Sort items within each Y group by X position
5. Scan lines for known labels: SUPPLIER, DIE SIZE, PRESS, No OF CAV, etc.
6. For each label found, extract the value from the same line or adjacent items
7. Also scan bottom area of page for die number pattern as confirmation
8. Apply plant mapping from PRESS code
9. Parse shipment type and simulation flag
10. Merge with filename-derived metadata

## Component Changes

- **Modified**: `src/components/modals/PDFImportModal.jsx` - Complete rewrite with batch support and position-based extraction
- **No other files need changes** - the modal already uses `onAddRecord` callback; we'll change to use `onImportRecords` (same as PIImportModal) for batch support
- **Parent component** (`DieOrderingSystem.jsx`) may need minor update to pass `existingOrders` and `onImportRecords` to PDFImportModal
