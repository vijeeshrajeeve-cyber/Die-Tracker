# QD Standard Format, Approval Workflow & Purchase Hand-off — Design

**Date:** 2026-07-23
**Feature area:** QD Tracker (`qd-tracker`)
**Related:** builds on the existing QD Tracker (see memory `qd-tracker-feature`)

## Summary

Extend the Quality Discrepancy (QD) feature so that:

1. The QD creation form captures the company's **standard QD format** (Part-A in full, plus a
   Part-B supplier-response section) rather than today's small subset.
2. A raised QD goes through an **approval gate** (Draft → Pending → Approved / Sent-back) handled
   by designated approvers.
3. On approval, the system **emails the Purchase team** the QD (with a generated PDF that
   reproduces the standard one-page form) for further processing.

Delivered in **two phases**: Phase 1 = the approval workflow + Purchase email on the current
fields; Phase 2 = full-format capture + PDF document. The approval lifecycle is tracked as a
**separate dimension** from the existing 7-value `status` vocabulary, so the current KPI /
avg-resolution logic is untouched.

## Decisions (from brainstorming)

- **Purchase hand-off = email** to the Purchase team via the existing SMTP service. No new
  in-app Purchase queue/view.
- **Approvers = specific named users**, chosen from the user list in Settings (admin-managed).
- **Form scope = full standard format**, exactly — the saved QD can reproduce the PDF 1:1.
- **Auto-fill, editable** — selecting the die/order pre-fills Part-A header fields from existing
  records; every field remains editable, free-text entry still allowed.
- **Generate a real PDF** matching the standard layout (attached to the Purchase email +
  downloadable/printable).
- **Approve or send back** — approver can approve or send back with a reason; raiser edits and
  resubmits.
- **Separate approval dimension** — `approval_state` tracked independently of `status`.
- **Draft state included** — a QD can be saved as Draft before submitting for approval.
  - QD number assigned **on submit** (Draft → Pending), not at Draft save, so abandoned drafts
    don't burn sequence numbers. Drafts show as "Draft (unnumbered)".
  - Drafts are **hidden** from the main register and KPIs (a row filter, not a KPI-logic change);
    a "My drafts" filter finds them.

## Data model

Migrations follow the existing idempotent `ALTER TABLE ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`
pattern in `server/db.cjs`. Flat columns on `quality_discrepancies`; one child table for the
billet grid.

### New columns on `quality_discrepancies`

**Approval dimension (Phase 1):**
- `approval_state` TEXT NOT NULL DEFAULT `'Draft'` — one of `Draft`, `Pending`, `Approved`,
  `SentBack`. Editable states: `Draft`, `SentBack`. Submit moves Draft/SentBack → Pending.
- `submitted_by` INTEGER REFERENCES users(id), `submitted_at` TIMESTAMP
- `approved_by` INTEGER REFERENCES users(id), `approved_at` TIMESTAMP
- `sent_back_reason` TEXT, `sent_back_at` TIMESTAMP
- `prepared_by` TEXT — sign-off "Prepared By" name (defaults from raiser/corrector)
- (`sent_to_purchase_date` DATE already exists — stamped when the Purchase email is sent)

**Part-A header (Phase 2) — auto-filled from die order, editable:**
- `die_received_date` TEXT, `press` TEXT, `die_type` TEXT, `die_size` TEXT,
  `no_of_cavity` TEXT, `tooling` TEXT, `no_of_trials` TEXT, `no_of_corrections` TEXT,
  `production_date` TEXT
- (`profile_number`, `die_no`, `supplier`, `corrector`, `input_at_failure`, `issue_detail`
  already exist)

**Part-A classification / action (Phase 2):**
- `manufacturing_defect` TEXT (`Yes`/`No`), `die_performance` TEXT (`Yes`/`No`),
  `recommended_action` TEXT

**Part-B — supplier section (Phase 2), staff-entered:**
- `supplier_acceptance` TEXT (`Yes`/`No`), `action_taken` TEXT, `supplier_comments` TEXT,
  `received_by_supplier` TEXT
- (`eta_date` and `closed_at` already exist → Part-B ETA / "Closed on")

### New child table `qd_billet_parameters`

0–2 rows per QD (`first`, `last`):

```
id SERIAL PRIMARY KEY
qd_id INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE
billet TEXT NOT NULL            -- 'first' | 'last'
die_soaking_hours TEXT
die_temperature TEXT
billet_temp TEXT
breakthrough_pressure TEXT
running_pressure TEXT
billet_length TEXT
alloy TEXT
ram_speed TEXT
any_delay_observed TEXT
UNIQUE (qd_id, billet)
```

Empty rows are simply not inserted. (Numeric-looking values stored as TEXT to tolerate the
free-form entries seen on the paper form, e.g. "4 hours", "460".)

### `quality_discrepancy_files`

- Add `category` TEXT DEFAULT `'general'` — `profile_image` | `approved_design` | `trial_photo`
  | `general`. Drives which slot each image fills in the PDF. Existing rows default to `general`.

### Backfill

Existing QDs (raised before this feature) are set to `approval_state='Approved'` — they predate
the workflow and are already live, so they must not be trapped in the gate. New QDs start `Draft`.

## Phase 1 — Approval workflow & Purchase email

### Approver / recipient settings

A small settings store (`qd_settings` row or `settings` keys, admin-managed) holding:
- `approver_user_ids` — users allowed to approve
- `purchase_email_to` (+ optional `purchase_email_cc`) — Purchase team recipients

Admin UI in Settings to manage both.

### Lifecycle & drawer actions

- **Raiser:** *Save Draft* and *Submit for approval*. Submit assigns the QD number (if
  unnumbered), sets `approval_state='Pending'`, stamps `submitted_by/at`, logs to timeline.
- **Approver only** (users in `approver_user_ids`): *Approve* and *Send back*. Buttons hidden for
  others; server enforces via a `requireApprover` check.
  - *Approve* → `approval_state='Approved'`, stamps `approved_by/at`, emails Purchase, stamps
    `sent_to_purchase_date`, logs approval + email to timeline.
  - *Send back* → reason required → `approval_state='SentBack'`, stamps `sent_back_reason/at`,
    logs it. QD editable again; raiser resubmits → Pending.

### Endpoints (new, on `server/routes/quality-discrepancies.cjs`)

- `POST /:id/submit` — Draft/SentBack → Pending (assigns number if unnumbered)
- `POST /:id/approve` — approver-only → Approved + Purchase email
- `POST /:id/send-back` — approver-only, reason required → SentBack

All under `authMiddleware`; approve/send-back additionally gated by approver-list membership.

### Purchase email

Built from a template (subject e.g. `QD 2026PH-04 approved — action required`; body with key
fields + link to the QD), sent via `email.sendEmail()` to configured Purchase recipients, logged
to `email_log`. **Non-blocking:** a send failure is surfaced but does not roll back the approval;
a *Resend to Purchase* drawer action covers a failed send. Phase 2 upgrades the email to carry the
generated PDF attachment.

## Phase 2 — Full-format form, PDF & Part-B

### Raise form (`src/components/qd/RaiseQDModal.jsx`)

Restructured into collapsible sections within the existing modal shell:

1. **Die selection** — searchable die/order picker. On select, auto-fills Part-A header from
   `die_orders` / frozen design (Profile No, Supplier, Press, Die Received date, No of trials, and
   Die Type/Size/Cavity/Tooling where stored). All editable; free-text still allowed; `die_order_id`
   stored. Fields not present in source data start blank for manual entry.
2. **Part-A · Die details** — header fields.
3. **Part-A · Production parameters** — 2-row grid (1st/last billet) + shared production date →
   `qd_billet_parameters`. Optional.
4. **Part-A · Discrepancy** — description, Manufacturing Defect (Y/N), Die Performance (Y/N),
   input at failure, Outcome (existing), Recommended Action.
5. **Images** — upload with category selector (`profile_image` / `approved_design` /
   `trial_photo` / `general`).

**Save behavior:** footer *Save Draft* / *Submit for approval*. Draft requires only Die No +
Supplier. Submit may enforce a fuller set (description + header).

### PDF generation (`server/services/qdPdf.cjs`, `pdf-lib`)

Draws the standard one-page(+overflow) form: Gulf Extrusion header with DATE / QD#, green Part-A
tables, production-parameter grid, discrepancy text, Manufacturing Defect / Die Performance row,
embedded images in Profile Image / Approved design slots (by file `category`), Recommended Action,
Part-B block, sign-off table (Prepared By = `prepared_by`, Authorized By = `approved_by`, Received
By = `received_by_supplier`, Closed on = `closed_at`). Long text / extra photos overflow to a
second page.

- `GET /:id/document` streams the PDF (download/print).
- Same generator supplies the Purchase-email attachment.
- **Asset:** Gulf Extrusion logo PNG/JPG under `server/assets/`; extract from the sample PDF if not
  already in the repo.

### Part-B capture

Detail-drawer editable fields (staff-entered from the returned signed form): `supplier_acceptance`,
`action_taken`, `supplier_comments`, `received_by_supplier`, plus existing `eta_date`. Extends the
current `EDITABLE_FIELDS` PATCH mechanism (each edit logged; empty clears). **Independent of** the
status flow — existing Sent to Supplier / FOC Accepted / Rejected / Closed transitions are
unchanged.

## Error handling

- Invalid approval transitions (e.g. approving a Draft, sending back an Approved QD) → 400 with a
  clear message; enforced in the service layer.
- Non-approver hitting approve/send-back → 403.
- Missing send-back reason → 400.
- Purchase email failure → logged to `email_log` as failed, surfaced to the approver, approval
  stands; *Resend to Purchase* available.
- PDF generation tolerates missing optional fields (blank slots), never throws on absent images.
- QD-number assignment stays transactional; the existing 23505 retry path is preserved.

## Testing (node:test, `*.test.cjs` beside the service)

- Approval lifecycle transitions (Draft→Pending→Approved / SentBack→Pending); illegal transitions
  rejected.
- Approver gating at the service layer (non-approver blocked).
- QD numbering deferred to submit; abandoned Drafts consume no number.
- Draft rows excluded from register/KPIs; existing-QD backfill counted normally.
- Billet-parameter round-trip; Part-B field validation via extended `EDITABLE_FIELDS`.
- PDF smoke test: non-empty valid PDF for a fully-populated QD and one with missing optionals.
- Purchase-email path: approval succeeds when `sendEmail` throws; resend works.

**Manual verification:** reproduce sample `2026PH-04` — raise with the same data, approve, confirm
the generated PDF matches the paper form and the Purchase email fires.

## Out of scope

- Supplier-facing login / self-service Part-B entry (Part-B is staff-entered).
- In-app Purchase queue/dashboard (hand-off is email only).
- Changes to the existing status vocabulary or KPI/avg-resolution math.
