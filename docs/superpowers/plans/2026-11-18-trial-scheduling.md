# Trial Scheduling Implementation Plan

**Goal:** Replace the daily "Trial plan" Excel sheet with a Trial Plan tab inside Sample Followup: build tomorrow's plan from the dies waiting for trial, publish it, let the shift supervisor record results against it, keep past plans as a locked record, and summarise by week and month.

**Mockups:** "Die Tracker – Trial Scheduling mockups" canvas (5 screens: build, record results, published plan, past plan, summary).

**Architecture:** Two new tables. `trial_plans` holds one row per calendar day. `trial_plan_entries` holds one row per die on that day and carries a snapshot of what was planned (die, press, customer, alloy, tooling, corrector), so a past plan always reads as it was published even if the die record changes later. Pure rules (vocabulary, validation, lock windows, summary maths, clash checks) live in `server/services/trialPlans.cjs` with no database in them; the same file holds the query functions. Routes are thin and live in `server/routes/trial-plans.cjs`. A recorded trial result is written through the existing `sampleTrials` service, so the die's trial log stays the single record of what happened at the press.

**Tech stack:** Node + Express (CommonJS `.cjs` under `server/`), PostgreSQL, React with the Sample Followup stylesheet (`src/styles/sample-followup.css`), `node:test`.

## Decisions

Confirmed with Vijeesh:

- The page opens on **the next day's** plan; the date can be changed.
- **A supervisor records results.** Desktop layout; no corrector phone view.
- **Past plans are view only.** Picking an earlier date shows that day's plan and results with no edit controls.
- **Weekly and monthly summary** is part of the feature.
- **Customer name** is a column on the plan, the results screen, the published plan and the past-plan view.
- A plan has two kinds of entry: **Trial** and **Supervised** (critical products that must run in the day shift). Only trials count toward trial totals and ratios.
- The day-shift tag is **permanent for some profiles and day-to-day for others**; both must be supported, with a per-day skip for tagged profiles.
- A die that is **not waiting for trial** (Sample Submitted, Approved, or not in Sample Followup at all) can still be planned through a search, with a required reason. Planning it never moves its sample status.

Assumed until told otherwise (each is one constant or one small change):

- **Result wording** stays the app's `OK` / `Not OK` plus the six existing failure reasons, with `Not run` added for the plan only. The sheet's Normal / Shape Out / Fail maps onto these.
- **Lock timing:** the plan can be edited until the end of its own day. Results can be recorded on the day and for `RESULT_GRACE_DAYS = 1` day after; later than that needs an admin.
- **Reporting week** is Monday to Saturday. The summary endpoint takes a from/to range, so the week definition lives in the UI only.
- **One plan per day per plant** (GEX 1, GEX 2). Changed on 2026-11-19 from one plan per day for every press: the plants plan differently. Plants are stored as `GEX 1` / `GEX 2`; `GEX 01` and the like read as the same plant. Plans made before the change took the plant most of their dies came from.
- **Alloy** is not stored on die orders today, so it is typed on the entry and pre-filled from that die's most recent plan entry.

## Global constraints

- Entry types, exact strings: `Trial`, `Supervised`. Outcomes, exact strings: `OK`, `Not OK`, `Not run`. These are stored values.
- Failure reasons are imported from `sampleTrials.cjs`, never copied.
- `server/` is CommonJS; `src/` is ESM.
- Schema changes go in **both** `server/db.cjs` (idempotent, applied at boot) and `init.sql` (fresh installs).
- Dates are `'YYYY-MM-DD'` strings read by local day (`services/dates.cjs`), never `toISOString()`.
- A trial is never invented: a sample trial row is created only when a supervisor records `OK` or `Not OK` on a Trial entry that is linked to a die record.
- Planning or running a trial never changes `sample_status`.
- Do not run `npm run build:check`; lint changed files with `npx eslint <files>` and build separately.

## Data model

`trial_plans`: `id`, `plan_date DATE`, `plant` (unique together with the day), `status` (`draft` | `published`), `revision` (bumped on each publish), `published_at`, `published_by`, `created_by`, timestamps.

`trial_plan_entries`: `id`, `plan_id` (cascade), `position`, `entry_type`, `urgent`, optional parent `die_order_id` or `sample_followup_id` (never both), snapshot columns `die_no`, `plant`, `press`, `customer`, `alloy`, `tooling`, `corrector`, `out_of_queue_reason`, then the result: `outcome`, `fail_reason`, `comments`, `sample_trial_id` (link to the trial log row, set null if that row is deleted), `result_by`, `result_at`, plus `created_by` and timestamps. A die appears once per plan (`UNIQUE (plan_id, die_no)`).

Later phase: `day_shift_profiles` (`profile_no UNIQUE`, `reason`, `created_by`) for the permanent tag.

## API (`/api/trial-plans`, page access `flow-sample-followup`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/meta` | vocabulary, plants, default plan date, grace days |
| GET | `/summary?from=&to=&plant=` | totals, by press, by day and plant, failure reasons for a range; no plant is both plants |
| GET | `/:date?plant=` | one plant's plan for a day, its entries, summary, checks and lock state |
| GET | `/:date/pdf?plant=` | the printable schedule of a published plan |
| POST | `/:date/entries?plant=` | add a die (creates the draft plan on first add) |
| PUT | `/entries/:id` | change a planned entry |
| DELETE | `/entries/:id` | remove an entry that has no result |
| POST | `/:date/publish?plant=` | publish or re-publish, then email the PDF to the plant's list |
| PUT | `/entries/:id/outcome` | record or correct a result |

## Phases

### Phase 1: database and server API (this change)

- [x] Rules service: vocabulary, `validateEntry`, `validateOutcome`, `planState`, `defaultPlanDate`, `summarise`, `findChecks`
- [x] Tables in `server/db.cjs` and `init.sql`
- [x] Query functions: read a plan, add / update / remove entry, publish, record outcome, range summary
- [x] Recording `OK` / `Not OK` on a linked Trial entry writes the die's trial log in the same transaction
- [x] Routes mounted at `/api/trial-plans`
- [x] Unit tests for the rules, route tests against a fake database

### Phase 2: plan builder (mockup screen 1)

- [x] `trialPlansAPI` in `src/api.js`
- [x] "Worklist | Trial Plan | Summary" switch on `SampleFollowupPage`
- [x] `TrialPlanTab` (plan mode): date control defaulting to the next day, "Available to plan" list from Sample Followup dies at Pending, plan grouped by press with Customer / Type / Alloy / Tooling / Corrector
- [x] Pre-fill press, customer and corrector from the die record; tooling from the die-tooling links; alloy from the last entry (`GET /last-alloy/:dieNo`)
- [x] "Add another die" search with required reason and a Re-trial tag
- [x] Checks card (tooling on two presses, corrector load) and the Publish action

### Phase 3: results and past plans (screens 2 and 4)

- [x] Results view with OK / Not OK / Not run and the entry panel, including productivity and recovery for enhancement dies
- [x] When an Approved die comes back Not OK, the result panel tells the supervisor to decide between reopening the sample and raising a QD; neither happens automatically (no buttons yet)
- [x] Read-only past-plan view driven by the lock state the API returns
- [x] Excel export of a plan (PDF moves to phase 4 with the published-plan PDF)

### Phase 4: publishing (screen 3)

- [x] PDF schedule of the plan (pdf-lib, `trialPlanPdf.cjs`), light layout, supervised runs in their own section; downloads on publish and from any published plan
- [x] Email on publish to the plant's list: recipients on the `Trial Plan - GEX 1` / `Trial Plan - GEX 2` email templates in Settings; a missing list or a mail failure is reported, never undoes the publish
- [x] Plant picker on the plan and the summary (summary adds All plants)
- [ ] Next-morning planned-against-done summary email
- [ ] Teams or WhatsApp delivery as an optional channel, decided separately

### Phase 5: summary (screen 5)

- [x] Summary tab with Week / Month switch, previous-period comparison, by day, by press, failure reasons
- [ ] Switch the table to by customer / corrector / supplier
- [ ] Dies on their third trial or more; re-trials counted on their own line

### Phase 6: supervised runs

- [ ] `day_shift_profiles` table and a settings card to tag and untag profiles
- [ ] Suggest tagged dies for the plan when they are due to run (needs the production plan import)
- [ ] Per-day skip with a remark; count of manual additions per profile

## Open questions

1. Lock timing: is one grace day for results right?
2. Which days make up the reporting week?
3. Keep `OK` / `Not OK`, or switch the plan's wording to Normal / Shape Out / Fail?
4. Who may publish: anyone with Sample Followup access, or named users only?
