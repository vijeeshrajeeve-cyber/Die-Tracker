# Frozen / Final Design Feature — Design Spec

**Date:** 2026-06-18
**Status:** Approved (pending user review of this document)

## 1. Problem & Goal

Designs that have already been approved for a given profile/press are re-designed
and re-approved from scratch every time a backup die or a repeat order is raised
for the same configuration. This adds avoidable Design and Design-Approval lead
time.

This feature lets a user mark an approved design as **Frozen / Final** and upload
the final design file(s). When a future die order or backup die request is raised
for the **same Profile + Plant + Press + Cavity**, the system flags that a frozen
design exists and offers to **release** it — skipping the Awaiting Design,
Simulation, and Design Approval stages and moving the new record straight to
**PENDING FOR PR**. The user may instead choose to follow the normal flow, but
must record a reason.

A **Released ×N** metric on each frozen design quietly surfaces the lead-time
payoff (how many order cycles each finalized design has saved).

## 2. Match Key

A frozen design matches a new record when **all four** of these are equal:

- `profile_number`
- `plant`
- `press`
- `cavity`

`die_orders` and `backup_die_requests` both have a `cavity` column
(`die_orders.cavity` added via migration in `server/db.cjs`; `init.sql` is stale
but the live schema has it). `die_orders` has no explicit `profile_number`
column, so the profile is derived from the die number using the existing
`extractProfileFromDie` helper (already used in `BackupDieRequests.jsx`). If the
profile cannot be derived, no match lookup is performed.

## 3. Data Model

```sql
-- One row per frozen design; versioned per key via supersession.
CREATE TABLE frozen_designs (
    id SERIAL PRIMARY KEY,
    profile_number   TEXT NOT NULL,
    plant            TEXT NOT NULL,
    press            TEXT NOT NULL,
    cavity           INTEGER NOT NULL,
    source_order_id  INTEGER REFERENCES die_orders(id),   -- order whose approval froze it
    frozen_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    frozen_by        INTEGER REFERENCES users(id),
    is_active        BOOLEAN DEFAULT true,                 -- false once superseded or released
    superseded_by    INTEGER REFERENCES frozen_designs(id),
    released_at      TIMESTAMP,
    released_by      INTEGER REFERENCES users(id),
    release_reason   TEXT,                                 -- 'superseded' | 'manual'
    notes            TEXT,
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Only one ACTIVE frozen design per key.
CREATE UNIQUE INDEX uniq_active_frozen
  ON frozen_designs (profile_number, plant, press, cavity)
  WHERE is_active = true;

-- Multiple files per frozen design.
CREATE TABLE frozen_design_files (
    id SERIAL PRIMARY KEY,
    frozen_design_id INTEGER NOT NULL REFERENCES frozen_designs(id) ON DELETE CASCADE,
    original_name    TEXT NOT NULL,
    stored_path      TEXT NOT NULL,    -- relative to FROZEN_DESIGNS_ROOT
    mime_type        TEXT,
    size_bytes       BIGINT,
    uploaded_by      INTEGER REFERENCES users(id),
    uploaded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link consuming records to the frozen design (released or bypassed).
ALTER TABLE die_orders          ADD COLUMN frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE die_orders          ADD COLUMN frozen_design_action TEXT;          -- 'released' | 'bypassed'
ALTER TABLE die_orders          ADD COLUMN frozen_design_override_reason TEXT; -- preset category, when bypassed
ALTER TABLE die_orders          ADD COLUMN frozen_design_override_note TEXT;   -- optional free text

ALTER TABLE backup_die_requests ADD COLUMN frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE backup_die_requests ADD COLUMN frozen_design_action TEXT;
ALTER TABLE backup_die_requests ADD COLUMN frozen_design_override_reason TEXT;
ALTER TABLE backup_die_requests ADD COLUMN frozen_design_override_note TEXT;
```

Schema changes are applied via the existing idempotent migration pattern in
`server/db.cjs` (guarded `ALTER TABLE ... IF NOT EXISTS` blocks) and mirrored into
`init.sql` for fresh installs.

**Released ×N** and **Bypassed ×N** are *derived*, not stored:
- Released ×N = count of `die_orders` + `backup_die_requests` where
  `frozen_design_id = id AND frozen_design_action = 'released'`.
- Bypassed ×N = same with `frozen_design_action = 'bypassed'`.

This is self-correcting (no drift if a record is deleted or reassigned) and needs
no extra write path. The `GET` list query computes these per row via subqueries.

## 4. Supersession & Uniqueness

When a new design is frozen for a key that already has an active frozen design:
the existing active row is marked `is_active = false`, `release_reason = 'superseded'`,
`superseded_by = <new id>`, all inside one DB transaction; the new row becomes the
active one. History is retained. The partial unique index guarantees at most one
active row per key.

## 5. Permissions

- **Freeze:** anyone who can approve a design (i.e., perform the
  `PENDING FOR DESIGN APPROVAL → PENDING FOR PR` transition) can freeze it as part
  of that same action.
- **View / release-onto-order / bypass:** any user with page access to the new
  Frozen Designs page and to the order/backup flows.
- **Manual unfreeze:** admin role only.

## 6. Backend API & File Storage

New router `server/routes/frozen-designs.cjs`, mounted at `/api/frozen-designs`
with `authMiddleware` + `pageAccessMiddleware('frozen-designs')`. The manual
release endpoint is additionally gated by `adminMiddleware`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/frozen-designs` | List with filters (profile/plant/press/cavity, active-only); includes files, Released ×N, Bypassed ×N. |
| `GET`  | `/api/frozen-designs/match?profile=&plant=&press=&cavity=` | Active frozen design for a key, or null. Used by order/backup forms. |
| `POST` | `/api/frozen-designs` | Create/freeze (supersedes existing active for key, transactional). |
| `POST` | `/api/frozen-designs/:id/files` | Upload file(s) via **multer**; ≤100 MB each; extension allow-list. |
| `GET`  | `/api/frozen-designs/files/:fileId` | Stream/download a file (auth-checked; `res.download` from stored path). |
| `POST` | `/api/frozen-designs/:id/release` | Manual unfreeze (admin); sets inactive, `release_reason='manual'`. |

**Freeze-on-approval:** the existing order-update path in `orders.cjs` (design
approval transition) creates the `frozen_designs` row in the same transaction when
the request carries `freeze_design: true`. The client then uploads files in a
follow-up call to `/files` once the row id is known.

**Storage:**
- New env var `FROZEN_DESIGNS_ROOT` (default `/app/storage/frozen-designs`),
  backed by a **named Docker volume** added to `docker-compose.yml` and
  `Dockerfile.backend`.
- Layout: `FROZEN_DESIGNS_ROOT/<profile>/<press>/<cavity>/<frozen_design_id>/<sanitized_original_name>`.
- `multer` writes to a temp dir, the handler moves the file into the mapped folder
  and records the relative `stored_path`.
- Allowed extensions: `pdf, png, jpg, jpeg, dwg, dxf, step, stp`. Size cap 100 MB
  per file. `express.json` stays at 10 mb; multipart is handled by multer
  independently.
- New dependency: **multer** (added to `package.json`).

## 7. Frontend

- **New top-level page** `src/pages/FrozenDesignsPage.jsx`:
  - Add `{ id: 'frozen-designs', label: 'Frozen Designs' }` to `CONTROLLABLE_PAGES`
    (`src/utils/constants.js`), a sidebar/nav entry, and an
    `activeTab === 'frozen-designs'` branch in `DieOrderingSystem.jsx` (mirrors
    the `backup-requests` wiring).
  - Columns include status (Active / Superseded / Released), files (view/download
    links), **Released ×N**, and **Bypassed ×N** (reasons available on
    expand/hover). Admin-only **Release / Unfreeze** button per active row.
- **Freeze at approval:** extend the design-approval completion UI
  (`WORKFLOW_STEPS['PENDING FOR DESIGN APPROVAL']` action) with a
  "Mark design as Frozen / Final" checkbox; on success, open a file-upload modal.
- **Frozen-design banner:** reusable `FrozenDesignBanner` component shown in the
  add-order form and in `BackupDieRequests.jsx` add form. When profile + plant +
  press + cavity are all set, it calls `/match`; a match renders a ⚠️ banner with
  freeze date, who froze it, file links, and two actions:
  1. **Release Frozen Design** — sets `frozen_design_id`, `frozen_design_action='released'`,
     stamps `design_received_date` and `design_approved_date` to **today**, sets
     status to `PENDING FOR PR`, writes a change-log entry, then submits.
  2. **Proceed with normal flow** — opens a **mandatory reason** control: a preset
     dropdown (`Profile revised`, `Customer change`, `Quality issue`, `Other`) plus
     an optional note (note required when `Other`). Sets `frozen_design_id`,
     `frozen_design_action='bypassed'`, `frozen_design_override_reason`,
     `frozen_design_override_note`; the record then follows the **normal flow**
     (usual starting status, no auto-stamped dates); a change-log entry records the
     bypass + reason.
- **API client:** add `frozenDesignsAPI` to `src/api.js`
  (list, match, create, uploadFiles, fileUrl, release).

## 8. Behavior Summary (release vs. bypass)

| | Release | Bypass |
|---|---|---|
| `frozen_design_id` | set | set |
| `frozen_design_action` | `'released'` | `'bypassed'` |
| Reason required | no | **yes** (preset + optional note) |
| Design dates | stamped today | not auto-stamped |
| Starting status | `PENDING FOR PR` | normal flow |
| Counts toward Released ×N | yes | no (counts toward Bypassed ×N) |
| Frozen design stays active | yes | yes |

Releasing a frozen design onto an order does **not** consume/deactivate it — it
remains active and reusable for future orders.

## 9. Edge Cases

- Incomplete key (missing cavity/press/plant, or profile not derivable) → no
  match lookup; no banner.
- Match exists while **editing** an existing record (not creating) → banner shown
  as info only; no auto-release/bypass (avoid clobbering in-flight records).
  Release/bypass are create-time actions.
- Supersession is transactional; partial unique index enforces one active row
  per key.
- File upload failure after the frozen_designs row is created → row persists
  without files; user retries upload from the Frozen Designs page.
- Released/superseded designs never match in `/match` (active-only filter).

## 10. Testing

- **Backend:** unit tests for match logic, supersession transaction, manual
  release, Released/Bypassed count derivation, and file upload validation
  (extension + size). Follow existing repo test patterns where present.
- **Integration/manual:** freeze a design with files → create a new order for the
  same key → verify banner appears → release jumps to `PENDING FOR PR` with
  today's dates and `frozen_design_id` linked → verify Released ×N increments →
  verify bypass path requires a reason and follows normal flow, incrementing
  Bypassed ×N → verify admin unfreeze removes the banner for future records.

## 11. Out of Scope (YAGNI)

- Object storage / network shares (server-local Docker volume only for now).
- Per-order file duplication (linkage is by reference).
- Versioned diffing of design files.
- Non-admin manual unfreeze.
