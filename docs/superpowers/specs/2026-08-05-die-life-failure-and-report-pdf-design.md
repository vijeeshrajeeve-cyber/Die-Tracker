# Die Life, Die Failure, and a Shareable Report PDF — Design

**Date:** 2026-08-05
**Status:** Approved, ready for planning
**Follows:** `2026-08-04-supplier-performance-evaluation-design.md`

## Problem

Two problems, one feature.

**The scorecard is missing its heaviest metric.** The supplier evaluation shipped
on 2026-08-04 deliberately omitted Die Life and Die Failure, because nothing in
the schema recorded tonnage extruded or dies failing before rated life. That
design said so plainly, and said what would change when the data arrived:

> When tonnage tracking exists they become two more rows in the settings table
> and two more cards, with no change to the scoring engine.

The data is not going to arrive from another system. It will be typed in, once a
month, by the people who already know the numbers. That is the provision this
design adds.

**The exported report is not fit to send to a supplier.** Export today is
`window.print()` against the live page. The resulting PDF (reviewed 2026-08-04)
shows the application's sidebar down the left of every page, the browser's own
header and footer including the word `localhost` and a `1/3` page counter, a
single unlabelled blue block where a one-month bar chart should be, and five
consecutive boxes reading "Not enough data". It is a screenshot of an internal
tool, and it is going to external suppliers every month.

## Goal

Capture die life and die failure by hand each month, score them as part of the
supplier rating, and generate a monthly PDF good enough to send to the supplier
without apology.

## Non-goals

- **Automatic die life capture.** No production or tonnage feed exists. Manual
  entry is the mechanism, not a stopgap for one.
- **Per-die tracking.** Figures are per supplier per month. Per-die life
  histories are a larger feature and are not needed to rate a supplier.
- **Cross-supplier ranking in the shared PDF.** Unchanged from the previous
  design, and now load-bearing: the document leaves the building, so it must not
  carry another supplier's performance in it.
- **Changing the scoring maths.** `scoreMetric` and `overallRating` are untouched.
- **Persisting report comments.** See Decisions.

## Decisions

Every row below was settled with the user on 2026-08-05.

| Question | Decision |
|---|---|
| What gets typed each month? | Per supplier: Avg Die Life (MT), Dies In Service, Dies Failed |
| Is failure % typed or derived? | Derived, never stored |
| Where does entry live? | A third Analytics tab, "Die Life Data" |
| Who may enter? | Any logged-in user, stamped with who and when |
| How are the weights rebalanced? | The original design split, adapted — see Metrics |
| Die Life thresholds? | 10 at 77 MT, 0 at 20 MT — the 2026 KPI target |
| Die Failure thresholds? | 10 at 19%, 0 at 40% (40% is a seed, see below) |
| Quarterly/YTD aggregation? | Weighted by dies in service |
| Do targets change by year? | Yes — for **every** metric, Die Life and Die Failure included |
| What is "the matrix"? | Month × metric, for the one supplier in the report |
| Is the matrix in the PDF? | Yes |
| How is the PDF produced? | Server-rendered with `pdf-lib` |
| Are comments saved? | No — typed at export time, sent with the request |

### Two seeds that are judgement, not measurement

**Die Failure's 0-point of 40%.** The user gave the target — under 19% — and left
the lower bound to the implementer. 40% is roughly the 2× spread the other
quality metrics already use (QD Rate runs 5% → 20%). It is a seed. It is editable
per year in Settings from the day this ships, and it should be revisited once a
few months of real failure data exist.

**Die Life's thresholds are a real KPI, not a guess.** 77 MT is Gulf Extrusion's
stated 2026 die life target; 20 MT was given as the point at which a supplier
earns nothing. These are the business's own numbers.

## Data model

```sql
CREATE TABLE IF NOT EXISTS supplier_die_life (
  id                SERIAL PRIMARY KEY,
  supplier          TEXT    NOT NULL,
  year              INTEGER NOT NULL,
  month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  avg_die_life_mt   NUMERIC,
  dies_in_service   INTEGER,
  dies_failed       INTEGER,
  updated_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (supplier, year, month)
);
CREATE INDEX IF NOT EXISTS idx_supplier_die_life_lookup
  ON supplier_die_life (upper(btrim(supplier)), year, month);
```

Added to both `server/db.cjs` and `init.sql`, matching how
`supplier_performance_settings` is maintained in both places.

### Failure percentage is derived, never stored

The three columns are what a person can count. The percentage is arithmetic, and
arithmetic belongs to the machine. Storing it would let the stored percentage and
the stored counts disagree, and there would be no way to tell which was wrong.
Deriving it means the report can print the counts beside the percentage, and any
figure a supplier disputes can be traced to a count someone entered rather than
to a division someone did in their head.

### A blank cell is not a zero

`NULL` in any of the three columns means *not recorded*. It must never be read as
zero. A supplier with no die life figures yet scores `null` for that metric, is
excluded from the weighted mean, and the mean renormalises over the weights that
remain — the rule the existing engine already enforces, and the reason JIANGSU
and PHOENIX are not rated "At risk" for trials nobody recorded.

Scoring an unrecorded die life as 0 MT would rate a supplier "At risk" on a 25%
weight for data that was never collected. The entry grid must therefore
distinguish an empty box from a typed `0`, and save empty as `NULL`.

### Validation

Rejected with 400, naming the supplier and month:

- `dies_failed > dies_in_service` — impossible, and the derived percentage would
  exceed 100%
- any of the three values negative
- `dies_failed` present with `dies_in_service` absent or zero — the percentage
  would have no denominator, so the pair is meaningless

`avg_die_life_mt` present without counts is allowed: die life scores on its own,
and the counts only feed the failure rate.

## Metrics

Two rows join the existing six. The scoring engine is unchanged.

| Metric | Direction | 10 at | 0 at | Weight | Source |
|---|---|---|---|---|---|
| **Avg Die Life** (MT) | **higher better** | 77 | 20 | **25%** | `supplier_die_life` |
| **Die Failure Rate** (%) | lower better | 19 | 40 | **20%** | `supplier_die_life` |
| Avg Delivery Lead Time (days) | lower better | 30 | 55 | 20% | `die_orders` |
| Avg Design Lead Time (days) | lower better | 3 | 10 | 15% | `die_orders` |
| Avg Trial Ratio (trials/die) | lower better | 1.5 | 3.0 | 10% | `die_orders` |
| QD Rate (%) | lower better | 5 | 20 | 5% | `quality_discrepancies` |
| Design Revisions (per die) | lower better | 1.0 | 3.0 | 5% | `die_orders` |

Weights total 100%.

### Why the weights land here

The original design system mock scored five metrics: Design LT 20%, Delivery LT
20%, Trial Ratio 15%, Die Life 25%, Die Failure 20%. It had no QD Rate and no
Design Revisions, because the mock predated both. This design restores the mock's
intent — Die Life as the single heaviest factor — while keeping the two metrics
the app genuinely has, at 5% each.

Cutting QD Rate from 20% to 5% and Revisions from 10% to 5% costs nothing today.
The previous design recorded both as **known-flat**: only 8 QDs exist and half
carry no `qd_requested_date`, and 1 order in 659 has any revisions. Neither can
currently distinguish one supplier from another, so 30% of the old rating carried
no information. That 20 points of weight moves to a metric that will.

### Die Life is the first higher-is-better metric

`scoreMetric` has always had the branch:

```js
frac = metric.lowerBetter
  ? (metric.zero - v) / (metric.zero - metric.ten)
  : (v - metric.zero) / (metric.ten - metric.zero);
```

The `else` has never executed in production — every metric so far has been
lower-better. Die Life is `lowerBetter: false`, so `(v − 20) / (77 − 20)`, clamped.
It needs no new code, but it does need a test, because untested branches are
where the bugs are.

`validateMetrics` must also stop assuming direction. It currently rejects
`ten === zero`, which is still right. Nothing else in it is direction-dependent,
but this should be confirmed rather than assumed during implementation.

## Period aggregation

A single month reads its row directly. Quarterly and YTD combine months
**weighted by dies in service**, so a month with 40 dies counts ten times a month
with 4:

```
dieFailure = Σ(dies_failed) / Σ(dies_in_service) × 100
dieLife    = Σ(avg_die_life_mt × dies_in_service) / Σ(dies_in_service)
```

`dieFailure` returns `null` when `Σ(dies_in_service)` is zero — a period with no
dies in service is unknown, not a perfect 0% failure rate. This is the same
reasoning already applied to QD Rate, where 0 QDs out of 0 dies received returns
`null` rather than a flattering 0%.

`dieLife` needs one more rule, or it would contradict the validation above.
Validation permits a die life figure with no counts, on the grounds that die life
scores on its own — but a weighted mean whose weights are all `NULL` divides by
zero and yields `null`, silently discarding a figure someone typed. So:

- weight by `dies_in_service` across the months that have it;
- if **no** month in the period has counts, fall back to a **simple mean** of the
  die life values present;
- return `null` only when no month has a die life value at all.

Months with die life but no counts are therefore excluded from the weighted mean
when other months carry weight, and carry the result alone when none do. A typed
number always reaches the score.

The monthly trend series keeps its existing shape — January through the selected
month, regardless of frequency — so the matrix and the trend charts always have
something to show.

## Targets that change by year

`supplier_performance_settings` currently holds a single row of targets that
applies to all of history. That is wrong now for a specific reason: **the KPI
target is set annually.** 77 MT is 2026's die life target and under 19% is 2026's
failure target. When 2027's targets are set, a 2026 report reprinted afterwards
would silently rescore against numbers that did not exist when it was sent.

That matters because these reports leave the building. A supplier who receives a
7.4/10 in March and asks for a copy in November must get 7.4/10.

### Schema

```sql
ALTER TABLE supplier_performance_settings ADD COLUMN IF NOT EXISTS year INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sps_year ON supplier_performance_settings (year);
```

Guarded by an `app_migrations` marker, following the pattern already in
`db.cjs`. The existing row — if any — is stamped with the current year, since
those targets were set against current-year performance.

### Lookup

`getSettings(pool, year)` resolves in order:

1. the row for exactly that year
2. the most recent row for an **earlier** year
3. the code defaults in `METRIC_DEFAULTS`

Rule 2 is what makes this usable: set 2026's targets once and every prior year's
report resolves without anyone backfilling rows. Rule 2 deliberately does not
look *forward* — setting 2027's targets must not retroactively rescore 2026.

`getSettings(pool)` with no year keeps working, defaulting to the current year,
so existing callers do not break.

### Saving

`saveSettings(pool, year, metrics)` writes the row for that year. The weights-sum
and `ten !== zero` validation is unchanged.

### Settings card

`SupplierTargetsCard.jsx` gains a year selector above the table and a **Copy from
previous year** button, so setting up 2027 is one click and then edits rather than
seven rows retyped. The card states which year is being edited, prominently
enough that nobody edits 2026 believing they are editing 2027.

## The entry screen

A third tab in `AnalyticsPage.jsx`: Overview · Supplier Report · **Die Life Data**.

Year and month selectors at the top. Below, a table with one row per supplier and
three numeric inputs — Avg Die Life (MT), Dies In Service, Dies Failed — plus a
read-only derived Failure % column that updates as you type, and a last-updated
column showing who saved it and when. One Save button writes every changed row.

The supplier list is the same one the report picker uses,
`supplierPerformanceData.listSuppliers` — distinct suppliers on `die_orders`. A
supplier with no orders will not appear; this is accepted, since a supplier with
no dies ordered has no dies in service to report.

The derived Failure % updating live is the point of the layout: the person
typing sees the number the supplier will be judged on, while they can still
correct the counts that produced it.

### Permissions

Any logged-in user may read and write. `updated_by` records who, `updated_at`
records when, and both are shown in the grid. The alternative — admin only — was
rejected because entry is a routine monthly task and making one person a
bottleneck guarantees months get skipped. Attribution is the control, not
restriction.

## The PDF

Replaces `window.print()` for the Export button.

### Why server-rendered

`window.print()` cannot produce an acceptable document. The browser injects its
own header and footer — the date, the URL, `1/3` — and the only way to suppress
them is for whoever exports to untick a box in the print dialog every single
month. It also prints the live DOM, which is why the sidebar and the "Not enough
data" boxes appear in the reviewed export.

`pdf-lib` is already a dependency and already renders a controlled external
document: `qdPdf.cjs` produces the Quality Discrepancy form to a coordinate-exact
template because auditors expect the same page every time. The same tool, applied
with far looser constraints, is the right answer here.

### Structure

`server/services/supplierReportPdf.cjs`, A4 portrait (595 × 842 pt).

**Page 1 — Scorecard.** Gulf Extrusion logo from `public/company-logo.png`
(a PNG, so `doc.embedPng` handles it directly — none of the mask-clipping
gymnastics `qdPdf.cjs` needs for the QD template). Supplier name, period, date
generated. Rating: score out of 10, band label, and the narrative sentence naming
the strongest area and the priority for improvement. Then the metric table:

| Metric | Actual | Target | Weight | Score /10 |

with a drawn score bar per row. Metrics with no data print "Not recorded" in the
Actual column and are visibly excluded from the score, with a footnote giving the
count of contributing metrics.

**Page 2 — Die Life & Failure.** The matrix: rows January through the selected
month, columns Avg Die Life (MT), Dies In Service, Dies Failed, Failure %. A
totals row using the same weighted aggregation as the score, so the figure at the
bottom of the table is the figure that was scored — not a simple average that
disagrees with page 1.

**Page 3 — Trends.** Vector line charts per metric with the target drawn as a
reference line. **Metrics with no data are omitted entirely.** The reviewed export
devoted an entire page to five boxes reading "Not enough data"; an absent chart
says the same thing and does not waste a page of a document going to a supplier.

**Closing section — Comments & Action Points.** The free text typed before
export, printed under the name of whoever generated it and the date.

**Every page** — a footer carrying supplier, period, `Page N of M`, and a
confidentiality line. The Target column on page 1 means the document records the
thresholds it was judged against, so a supplier reading it next year can see the
2026 targets rather than having to trust that they were applied.

### Route

```
POST /api/supplier-performance/pdf
Body: { supplier, year, month, frequency, comments }
→ application/pdf
```

`POST` rather than `GET` because comments are free text of unbounded length and
have no business in a query string. Response headers follow the QD precedent in
`quality-discrepancies.cjs`: `Content-Type: application/pdf` and a
`Content-Disposition` filename of the form
`Supplier-Performance-<Supplier>-<Month>-<Year>.pdf`.

The route rebuilds the report server-side from the same services the on-screen
report uses. It does not accept a client-supplied snapshot: the numbers in the
document a supplier receives must come from the database, not from whatever the
browser happened to be holding.

### Comments are not persisted

Typed on the tab, sent with the request, printed, forgotten. Regenerating the
same month means retyping them. This is deliberate YAGNI — persisting them needs
a table keyed by supplier, year, month and frequency, and no one has asked to
reread last month's comments in the app. If that need appears, the table is a
small addition and the route already carries the text.

### The on-screen tab keeps the matrix

`components/analytics/DieLifeMatrix.jsx` renders the same month × metric table
inside the Supplier Report tab, so what is on screen matches what is in the file.

The existing print CSS stays as-is for anyone who hits Ctrl+P out of habit. It is
no longer the export path, and it is no longer the thing that has to be good.

## Architecture

### Backend

| File | Change |
|---|---|
| `server/db.cjs`, `init.sql` | `supplier_die_life` table; `year` column migration on settings |
| `services/supplierDieLife.cjs` | **new** — CRUD, validation, weighted period aggregation |
| `services/supplierPerformanceSettings.cjs` | two metric defaults; year-scoped get/save; rewrite the header comment that says die life is deliberately absent |
| `services/supplierPerformanceData.cjs` | merge die life into `getSnapshot` and `getMonthlyTrend` |
| `services/supplierReportPdf.cjs` | **new** — the document |
| `routes/supplier-performance.cjs` | die life GET/PUT; `POST /pdf`; pass the period year to `getSettings` |

Splitting `supplierDieLife.cjs` out from `supplierPerformanceData.cjs` keeps the
manual-entry concern — validation, attribution, upsert — away from the read-only
aggregation queries. They are different jobs with different failure modes.

`supplierReportPdf.cjs` will be the largest new file. Its layout constants and
table-drawing helper should be separated from the section-by-section composition
so the page structure can be read without wading through coordinate arithmetic —
the discipline `qdPdf.cjs` follows.

### Frontend

| File | Change |
|---|---|
| `pages/AnalyticsPage.jsx` | third tab |
| `pages/analytics/DieLifeTab.jsx` | **new** — the entry grid |
| `pages/analytics/SupplierReportTab.jsx` | comments box; Export posts for the PDF and downloads it; **delete the line claiming die life and failure are not tracked** |
| `components/analytics/DieLifeMatrix.jsx` | **new** — on-screen matrix |
| `components/settings/SupplierTargetsCard.jsx` | year selector; copy-from-previous-year |
| `src/api.js` | die life get/save; `exportPdf` returning a blob |

`SupplierReportTab.jsx` currently ends with the sentence *"Die life and die
failure are not tracked in this system and are not part of the rating."* That
sentence is printed in the PDF under review. It must go, or the first report sent
after this ships will contradict itself on its own final page.

## Error handling

- **Supplier with no die life rows for the period** — both metrics score `null`,
  print "Not recorded", and the rating renormalises over the remaining 55%. The
  PDF footnote states how many metrics contributed, so a rating built on five
  metrics is not mistaken for one built on seven.
- **`dies_failed > dies_in_service`** — 400 naming the supplier and month. Rejected
  at the service, not just in the browser.
- **No settings row for the report's year and none earlier** — code defaults, with
  the same on-screen notice the existing design specifies, so a score is never
  silently computed against thresholds nobody set.
- **Logo asset missing** — the PDF renders with the header text and no logo,
  rather than failing. A report without a logo is still a usable report; the QD
  renderer takes the same view.
- **PDF generation failure** — 500 with a message, and the tab keeps the typed
  comments so they are not lost to a failed export.

## Testing

**Backend**, `node:test` with a mocked pool, matching the existing service tests:

- weighted aggregation across months — a 40-die month outweighs a 4-die month
- a month with `NULL` counts is excluded, not treated as zero
- `Σ(dies_in_service) = 0` returns `null` for failure rate, not 0%
- die life with counts on no month falls back to a simple mean rather than
  `null` — the typed figure still scores
- die life with counts on some months weights those and ignores the rest
- Die Life scores through the **higher-better** branch: 77 → 10, 20 → 0, 48.5 →
  5, and clamping at both ends beyond 77 and below 20
- Die Failure: 19 → 10, 40 → 0, clamped
- `dies_failed > dies_in_service` rejected; negatives rejected
- year-scoped settings: exact year hit, fallback to an earlier year, fallback to
  defaults, and **no forward fallback** — 2027's targets must not resolve for a
  2026 report
- weights still validate to 100% with seven metrics

**PDF** — `qdPdf.test.cjs` already extracts text from generated PDFs with
`pdfjs-dist`, and the same helper applies here:

- supplier name, period and rating appear on page 1
- the matrix figures appear on page 2 with the right months
- a metric with no data prints "Not recorded" rather than 0
- a trend chart with no data produces no section
- comments appear when supplied and the section is absent when not
- page count is stable and every page carries a footer

**Frontend** — no component test framework exists: `npm run lint`,
`npm run build`, then a browser check of the entry grid saving and reloading, an
empty box staying empty rather than becoming 0, the matrix matching the entered
figures, and a generated PDF opened and read.

## Phasing

Each phase leaves the application working.

1. **Table, service, entry tab.** Data can be captured. Nothing scores it yet, so
   no rating changes and no report changes.
2. **Year-scoped targets.** Settings gains the year dimension. Independent of die
   life, and needed before the new metrics are scored so that 2026's targets are
   pinned to 2026 from the first rated report.
3. **Scoring.** The two metrics join the rating, weights rebalance, the matrix
   appears on screen. **This is the phase where every supplier's rating changes** —
   worth flagging to whoever reads the numbers.
4. **The PDF.** Export switches from `window.print()` to the generated document.

Phase 4 delivers the second half of the request and depends on phases 1–3 for its
content, so it lands last despite being the most visible.

## Assumptions

- **40% as Die Failure's 0-point is a seed**, chosen as roughly the 2× spread the
  other quality metrics use. It is not a business figure and should be reviewed
  once real failure data accumulates.
- **Die life is measured in metric tonnes extruded per die**, averaged across the
  supplier's dies in service that month. If the business measures it in extrusions
  or in kilograms, the unit label and both thresholds change — the model does not.
- **Suppliers are matched by name**, `upper(btrim(supplier))`, consistent with the
  existing aggregation. If `supplier_die_life.supplier` and `die_orders.supplier`
  vocabularies diverge, entered figures will not reach the report.
- **Ratings from before this ships are not comparable to ratings after it.** The
  weights change, so a supplier rated 9.1/10 on the old six metrics is not rated
  on the same basis as one rated after. This is intended — the old rating was
  missing 45% of the picture — but it should not be presented to a supplier as a
  trend line crossing the boundary.
