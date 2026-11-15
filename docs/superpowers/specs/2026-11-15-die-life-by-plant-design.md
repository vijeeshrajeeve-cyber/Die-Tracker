# Die life, failure and trial ratio by plant — design

Date: 2026-11-15

## Intent

Analytics → Die Life Data takes one row per supplier per month, with average die
life typed as a finished number and the trial ratio calculated from the orders.
The user wants the same figures split by plant as well as supplier, and wants to
type the raw counts so the app does the arithmetic. This gives more accurate
data per plant and makes quarter and year figures add up correctly.

## Goals

- Enter the monthly figures per **plant and supplier**.
- Type raw counts; calculate the ratios:
  - average die life = tonnage produced ÷ dies scrapped
  - die failure % = dies unloaded ÷ dies run
  - new die trial ratio = trials on new dies ÷ new dies received
  - backup die trial ratio = trials on backup dies ÷ backup dies received
- Keep the Supplier Report and score per supplier, built from the raw counts of
  all plants.

## Non-goals

- Reading tonnage, scrap or trials from production or order data. Every count is
  typed.
- A per-plant supplier report or per-plant targets.
- Converting figures typed before this change.

## Anti-goals

- A blank shown or scored as 0.
- A ratio for a period made by averaging monthly ratios.
- A die life shown for a month in which no die was scrapped.

## How it works today

- Table `supplier_die_life`: `supplier, year, month, avg_die_life_mt,
  dies_in_service, dies_failed, dies_scrapped`, unique on supplier + year + month.
  Rules in `server/services/supplierDieLife.cjs` (`validateEntry`,
  `aggregateDieLife`, `listDieLife`, `saveDieLife`, `getDieLifeRows`).
- Endpoints in `server/routes/supplier-performance.cjs`: `GET/PUT /die-life`,
  `GET/PUT /trial-ratio`.
- Trial ratio is the average `no_of_trial` of the supplier's orders by ordered
  month, with an admin correction log (`supplier_trial_ratio_corrections`,
  `server/services/supplierTrialRatio.cjs`).
- Screen: `src/pages/analytics/DieLifeTab.jsx` (year and month pickers, one row
  per supplier) and `src/components/analytics/DieLifeMatrix.jsx`.
- Report: `server/services/supplierPerformanceData.cjs` combines the die life
  rows and the trial ratio into the metrics, scores and trend;
  `server/services/supplierReportPdf.cjs` prints them. Labels on screen today:
  "Dies Extruded", "Dies Failed", "Dies Scrapped".
- Targets (die life 77 MT, failure under 19%) are year-scoped settings and do
  not change.

## Approaches

1. **Extend `supplier_die_life`** with a plant column and the new count columns
   (chosen). The report keeps reading one table through the same service.
2. **A new table** for plant-level counts. Cleaner names, but two code paths and
   a second place for the report to read.

Approach 1 was chosen by Claude; the user left the how open and confirmed the
outline.

## Decided by the user

- Figures stay split by supplier; plant is an additional split.
- Collect, per plant: dies scrapped and tonnage produced (average die life);
  new dies received and trials on them (new die trial ratio); the same for
  backup dies; dies run and dies unloaded (die failure %).
- There is no historical data to convert; the user is back-filling now.
- The five calls below were shown to the user and accepted ("Looks good").

## Claude's calls (accepted by the user)

1. The trial ratio becomes typed. It replaces the figure calculated from the
   orders and the admin correction. The correction log table is kept, unused.
2. "Dies unloaded" means dies taken off because they failed. It replaces the
   label "Dies failed"; "Dies run" replaces "Dies extruded".
3. Tonnage is the month's production on that supplier's dies at that plant.
4. The supplier score uses one combined trial ratio: all trials ÷ all dies
   received, new and backup together. The new and backup ratios are shown
   beside it.
5. Typed average die life goes away. Rows typed before this change have no
   plant; they stay visible as "Plant not set".

## Data

`supplier_die_life` gains:

| Column | Type | Meaning |
|---|---|---|
| `plant` | TEXT, nullable | plant name as in the plants list; NULL only on rows typed before this change |
| `tonnage_mt` | NUMERIC | tonnage produced |
| `new_dies_received` | INTEGER | |
| `new_die_trials` | INTEGER | |
| `backup_dies_received` | INTEGER | |
| `backup_die_trials` | INTEGER | |

Existing columns keep their names: `dies_in_service` is "Dies run",
`dies_failed` is "Dies unloaded", `dies_scrapped` is unchanged.
`avg_die_life_mt` stays in the table and is no longer written.

Uniqueness becomes one row per supplier, plant, year and month (supplier
compared trimmed and case-insensitively, as today). The old supplier + year +
month constraint is dropped. A row with no plant is a legacy row.

## Rules

**Validation, per row** (messages name the supplier and the plant):

- Every count is blank or a number of 0 or more; the six die counts are whole
  numbers.
- Dies unloaded needs a dies run count above zero, and cannot exceed it.
- Trials on new dies needs a new dies received count above zero; the same for
  backup dies. Trials may be fewer than dies (a die can be received with no
  trial).
- Tonnage and dies scrapped are independent: either may be typed without the
  other.
- A plant is required and must be one of the plants in the plants list.

**Calculation, for one row or any set of rows** (a month, a quarter, a year, one
plant or all plants):

| Figure | Formula | When it has no value |
|---|---|---|
| Avg die life (MT) | Σ tonnage ÷ Σ dies scrapped, over rows where both are recorded | no such row, or Σ dies scrapped is 0 |
| Die failure % | Σ dies unloaded ÷ Σ dies run × 100, over rows where dies run is recorded | Σ dies run is 0 |
| New die trial ratio | Σ new die trials ÷ Σ new dies received | Σ new dies received is 0 |
| Backup die trial ratio | Σ backup die trials ÷ Σ backup dies received | Σ backup dies received is 0 |
| Trial ratio (scored) | (Σ new + Σ backup trials) ÷ (Σ new + Σ backup dies received) | the denominator is 0 |

A row with dies run recorded and dies unloaded blank counts its dies run with 0
unloaded, as it does today. For the trial ratios a row counts only when both its
dies and its trials are recorded. A figure with no value is "not recorded"; the
one exception is die life when tonnage is recorded and Σ dies scrapped is 0,
which reads "no dies scrapped".

**Legacy rows** (no plant) are left out of every calculation. They are listed
on the tab under "Plant not set" with their old figures, read-only, and an admin
can delete them.

## Screen

Analytics → Die Life Data keeps its year and month pickers and gains a plant
selector: each plant from the plants list, then "All plants". The supplier rows
are the same list as today.

```
Plant [ GEX 01 v ]   Year [ 2026 v ]   Month [ November v ]

            Die life                  Failure               New dies            Backup dies
Supplier    Tonnage  Scrapped  Life   Run  Unloaded  %      Recd  Trials Ratio  Recd  Trials Ratio
WEFA        [ 420 ]  [ 6 ]     70.0   [40] [ 5 ]     12.5%  [ 3 ] [ 5 ]  1.67   [ 2 ] [ 2 ]  1.00
ALMAX       [ 150 ]  [ 0 ]     no dies scrapped  ...
```

- The calculated cells update as the user types and are not editable.
- "All plants" shows the summed counts and the figures calculated from them,
  read-only, with no Save.
- The admin trial-ratio correction control is removed from the tab.
- If legacy rows exist for the month, a "Plant not set" block lists them below
  the table.
- `DieLifeMatrix` (the year view) shows the calculated die life and failure %
  per supplier per month for the selected plant or all plants.

## Report and score

- The Supplier Report reads the die life rows of every plant for the supplier
  and period and applies the calculations above. Die life, die failure and the
  scored trial ratio keep their place, weight and order in the scorecard.
- The report's die life table and the PDF use the new labels and add the new
  and backup trial ratios (and their counts) beside the scored ratio.
- The trend lines for die life, failure and trial ratio are calculated per month
  from the same rows.
- The orders-based trial ratio and the correction log are no longer read by the
  report. `GET/PUT /trial-ratio` are removed.

## Settled after a builder's read of the code (Claude's calls)

- **The year matrix stays where it is.** `DieLifeMatrix` is rendered only in
  the Supplier Report for one supplier. It stays there, for all plants combined,
  showing the calculated die life and failure % per month. The Die Life Data tab
  does not gain a year view, and the sentence about the matrix under "Screen"
  is read this way.
- **Combined trial ratio pools each pair on its own.** A row's new-die pair
  counts when both new dies received and new die trials are recorded; its
  backup pair likewise. A row with only one pair recorded still contributes
  that pair to the scored ratio.
- **Plant rename and delete.** The plant is stored by name. Renaming a plant in
  Settings renames it on the die life rows in the same transaction. Deleting a
  plant that has die life rows is refused with a message saying so.
- **Uniqueness.** A unique index on `(upper(btrim(supplier)), plant, year,
  month)` for rows with a plant. The old inline `UNIQUE (supplier, year, month)`
  constraint is dropped by looking its name up, not by assuming it. Legacy rows
  are not constrained. The migration must never fail boot: if rows that differ
  only in supplier case collide, the most recently updated one is kept.
- **Saving.** `PUT /die-life` takes the plant with the year and month; the
  server refuses a missing plant, "All plants", or a plant not in the list.
- **Legacy data.** The user confirmed there is no historical data, so legacy
  rows dropping out of the report is accepted.

## Permissions

Unchanged: whoever can save die life today can save it per plant. Deleting a
legacy row is admin-only.

## Left to the builder

- Exact SQL for the constraint change, kept idempotent in `server/db.cjs` and
  mirrored in `init.sql`.
- Component layout details, number formatting (follow the existing tab), and
  the wording of validation messages beyond what is fixed above.
- Whether `supplierTrialRatio.cjs` is deleted or left unused; the table stays.
- Tests, following the existing `node:test` suites for these services.
