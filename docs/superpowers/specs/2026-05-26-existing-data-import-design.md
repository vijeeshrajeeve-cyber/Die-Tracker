# Existing Data Import — Design Spec

**Goal:** Build a frontend UI for importing existing die details and production data by plant, surfaced as an admin-only section in Settings.

**Architecture:** Self-contained `ExistingDataPage` component embedded in `SettingsPage` as a new collapsible section. No state lifted to parent. Backend endpoints and API client already exist.

**Tech Stack:** React 19, PapaParse (CSV), XLSX (Excel), `existingDataAPI` from `src/api.js`

---

## Placement

- File: `src/pages/ExistingDataPage.jsx`
- Integrated into: `src/pages/SettingsPage.jsx` as a new collapsible section, positioned after Profile Master
- Access: admin-only (Settings tab is already admin-gated — no additional access check needed)
- No new navigation tab, no new props to `DieOrderingSystem.jsx` — `plants` is already passed to `SettingsPage`

## Component: ExistingDataPage

**Props:**
- `plants` — array of plant objects from DB (already available in SettingsPage)
- `theme` — theme object (already available in SettingsPage)
- `setToast` — for success/error toasts (already available in SettingsPage)

**Internal state:**
```
activeTab: 'die-details' | 'production'
meta: { dieDetails: [{plant, count, last_imported}], productionData: [{...}] } | null
metaLoading: boolean

// Per-tab state (independent):
ddPlant, ddFile, ddRows, ddImporting, ddStatus
pdPlant, pdFile, pdRows, pdImporting, pdStatus
```

## UI Layout

### Tabs
Two tabs at the top of the card: **Die Details** and **Production Data**. Active tab highlighted with `theme.primary` underline.

### Per-tab content (identical structure)

1. **Plant dropdown** — `<select>` populated from `plants` prop. Label: "Plant". Required before import.

2. **File picker** — styled file input button (matches app pattern), accepts `.csv, .xlsx, .xls`. Label changes to filename once selected. Clicking again resets.

3. **Preview bar** — shown only when both plant is selected AND file is parsed. Shows:
   > "Ready to import **1,204 rows** into **GEX 1**"
   Disappears if plant or file changes.

4. **Import button** — disabled until preview bar is visible. Label: "Import" / "Importing…" during flight. Calls the appropriate API method.

5. **Status banner** — shown after import attempt:
   - Success (green): "Imported 1,200 rows, skipped 4"
   - Error (red): error message from API
   - Auto-dismisses after 5 seconds

### Status table (shared, below tabs)

Loaded on mount via `existingDataAPI.getMeta()`. Refreshed after any successful import.

| Plant | Die Details | Last Imported | Production Data | Last Imported |
|-------|-------------|---------------|-----------------|---------------|
| GEX 1 | 1,204       | 20 May 2026   | 852             | 18 May 2026   |
| GEX 2 | —           | —             | —               | —             |

Shows all plants from `plants` prop; rows with no data show "—".

## File Parsing

Triggered on file selection (`onChange`), not on import click — so the count preview is immediate.

- **CSV / TSV / TXT**: `Papa.parse(file, { header: true, skipEmptyLines: true })`
- **XLSX / XLS**: `XLSX.read(buffer, { type: 'array' })` → first sheet → `XLSX.utils.sheet_to_json()`

`sourceFile` sent to API = `file.name`.

## API Integration

```js
// Die Details tab
existingDataAPI.importDieDetails({ plant, rows, sourceFile })
  → POST /existing-data/die-details/import
  → Returns: { imported, skipped, total, meta }

// Production tab
existingDataAPI.importProduction({ plant, rows, sourceFile })
  → POST /existing-data/production/import
  → Returns: { imported, skipped, total, meta }

// On mount + after each import
existingDataAPI.getMeta()
  → GET /existing-data/meta
  → Returns: { dieDetails: [...], productionData: [...] }
```

The backend replaces all rows for the plant in a transaction (DELETE + INSERT), so no merge logic is needed client-side.

## Error Handling

- File parse error → show red banner "Could not parse file: \<message\>"
- No plant selected on import click → not possible (button disabled)
- API error → show red banner with `error.message`
- Network failure → show red banner "Import failed — check connection"

## Integration into SettingsPage

Add `ExistingDataPage` as a new collapsible section in `SettingsPage.jsx` following the existing accordion pattern. Place it after the Profile Master section. Pass `plants`, `theme`, and `setToast` as props.

No changes needed to `DieOrderingSystem.jsx` — all required props already flow into SettingsPage.
