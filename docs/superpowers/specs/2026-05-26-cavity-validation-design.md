# Cavity Validation — Server-Side Explicit Rule

**Date:** 2026-05-26

## Goal

Make the `Cavity` field an officially validated field in the server's `orderValidation` middleware so it is explicitly sanitized as an integer on every create/update, matching the pattern of other integer fields.

## Context

The full PDF import → DB pipeline is already correctly wired:
- `PDFImportModal` parses "No OF CAV" → sets `'Cavity'` on cleanOrders
- `usePIImport.handlePIImport` calls `ordersAPI.create/update` with `'Cavity'`
- Server stores `Math.round(order['Cavity'] || 0)` in the `cavity` column

The gap: `orderValidation` in `server/routes/orders.cjs` has no `body('Cavity')` rule, so the field passes through unvalidated.

## Change

**File:** `server/routes/orders.cjs`

Add one rule to the `orderValidation` array (around line 103–104, next to `Mandrels per Cavity` and `Total Mandrels`):

```js
body('Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid cavity count'),
```

**Range rationale:** `min: 0` (no negative cavities), `max: 10000` (same ceiling as `Mandrels per Cavity` — generous upper bound).

## No Other Changes

- No DB changes (column exists)
- No client-side changes (field already set correctly)
- No API contract changes (field was already accepted; now it's validated)
