# Preserve First Design-Received Date & Log Re-Receipts Per Revision

**Date:** 2026-07-16
**Status:** Approved (design)

## Problem

Completing the `AWAITING FOR DESIGN` step sets `Design Received Date = today`. When a
revision sends an order **back** to that stage, completing it again **overwrites**
`Design Received Date`, destroying the record of when the design was first received. The
same overwrite affects `3D Model Received Date` for simulation-enabled orders sent back to
`UNDER SIMULATION`.

## Goal

1. `Design Received Date` and `3D Model Received Date` become **write-once** — set on the
   first receipt, never overwritten afterward.
2. Every subsequent receipt (after a revision) is recorded against that revision's record.
3. `Design Approved Date` continues to be set/updated at the approval step (no change).
4. The Order Details view shows the number-of-revisions counter.

## Non-Goals

- No change to how revisions are *requested* (`RevisionModal`, `POST /:id/revisions`).
- No change to `Design Approved Date` behavior.
- No change to manual date edits in the Order Detail modal — those stay literal.

## Existing State (already built)

- `order_revisions` table: `id, order_id, revision_number, from_status, to_status, notes,
  revision_date, revision_pdf, created_by, created_by_name, created_at`
  (defined in [server/db.cjs](../../../server/db.cjs)).
- `die_orders.design_revision_count` and `die_orders.last_revision_date`.
- `RevisionModal` (request), `RevisionHistoryModal` (view history).
- Workflow map in [src/utils/constants.js](../../../src/utils/constants.js):
  - `AWAITING FOR DESIGN` → dateField `Design Received Date` → next `PENDING FOR DESIGN APPROVAL`
  - `UNDER SIMULATION` → dateField `3D Model Received Date` → next `PENDING FOR DESIGN APPROVAL`
- Stage completion happens in [`FlowPage.jsx` `handleCompleteStep`](../../../src/pages/FlowPage.jsx),
  which currently issues a generic `ordersAPI.patch(order.id, { STATUS, [dateField]: today, ... })`.

## Design

### 1. Schema — `order_revisions`

Add two nullable columns, filled when the reworked artifact is completed:

- `design_received_date TEXT`
- `model_received_date TEXT`

Two columns (not one shared "received_date"): a simulation-enabled order sent back to
`AWAITING FOR DESIGN` re-receives **both** a design and, later in the same revision cycle, a
3D model. `to_status` alone cannot disambiguate which receipt a date represents.

Added via the same idempotent `ALTER TABLE ... IF NOT EXISTS column` migration pattern
already used in `server/db.cjs`.

### 2. Server — dedicated stage-completion endpoint

New endpoint: `PATCH /orders/:id/complete-stage`

Request body: `{ field, date, nextStatus, changeLogEntry }` where `field` is one of the
known workflow date fields.

Behavior:

- Always advance `status = nextStatus` (+ append change-log, bump `updated_at`), same as a
  normal completion.
- For `field` mapping to `design_received_date` **or** `three_d_model_received_date`:
  - If the order's column is **NULL/empty** → set it to `date` (first receipt).
  - Else → **do not touch** the top-level column. Instead update the **latest** row in
    `order_revisions` for this order (highest `revision_number`) whose corresponding
    `design_received_date` / `model_received_date` is still NULL, setting it to `date`.
- For any other `field` → set the top-level column normally (this endpoint can be the single
  path for all completions, or the frontend may keep using generic PATCH for non-design
  stages — implementation plan decides; either is acceptable).

All done in one transaction (`FOR UPDATE` on the order row, mirroring the existing
`POST /:id/revisions` handler).

Rationale for a dedicated endpoint over detecting inside the generic `PATCH /orders/:id`:
manual date edits in the Order Detail modal must remain literal — an admin correcting a typo
in the first `Design Received Date` should edit that field, not be silently redirected onto a
revision row. Separating "advance the workflow" from "edit a field" keeps that boundary clean
and atomic.

### 3. Frontend

- **[`FlowPage.jsx` `handleCompleteStep`](../../../src/pages/FlowPage.jsx):** for the
  `AWAITING FOR DESIGN` and `UNDER SIMULATION` stages, call the new
  `ordersAPI.completeStage(...)` instead of the generic patch. Update local `data` state so
  that on a re-receipt the top-level date does **not** visually change (only status advances /
  revision row updates). First receipts still set the top-level date as today.
- **[`RevisionHistoryModal.jsx`](../../../src/components/modals/RevisionHistoryModal.jsx):**
  render the re-received date(s) on each revision card when present, e.g.
  "Design re-received: <date>" and/or "3D model re-received: <date>".
- **[`OrderDetailModal` Timeline](../../../src/DieOrderingSystem.jsx):** add a **Revisions**
  row showing `Design Revision Count`. When the count > 0, render it as a button/link that
  opens `RevisionHistoryModal` for the order.
- **`api.js`:** add `ordersAPI.completeStage(id, payload)`.

## Data Flow (revision cycle, simulation disabled)

1. Order at `PENDING FOR DESIGN APPROVAL`. Reviewer requests revision → existing
   `POST /:id/revisions` creates revision row #N (notes, revision_date), status →
   `AWAITING FOR DESIGN`, `design_revision_count = N`.
2. Designer reworks, completes `AWAITING FOR DESIGN` → `completeStage`:
   `design_received_date` already set → row #N `.design_received_date = today`; status →
   `PENDING FOR DESIGN APPROVAL`; top-level `Design Received Date` unchanged.
3. Reviewer completes approval → `Design Approved Date = today` (existing behavior).

For simulation-enabled orders, step 2 also produces a later `UNDER SIMULATION` completion
that fills row #N `.model_received_date`.

## Testing

- Migration adds both columns idempotently (safe to re-run).
- First design completion sets top-level `Design Received Date`; leaves revision rows null.
- Revision → re-completion writes to the latest revision row's `design_received_date`, leaves
  top-level unchanged.
- Simulation path fills `model_received_date` on the same revision row.
- `PATCH /orders/:id` manual edit of `Design Received Date` still overwrites literally.
- Order Detail modal shows correct revision count and opens history.
