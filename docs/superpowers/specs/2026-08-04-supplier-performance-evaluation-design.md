# Supplier Performance Evaluation — Design

**Date:** 2026-08-04
**Status:** Approved, ready for planning

## Problem

The Analytics page is a single flat grid of eleven equal-weight cards
(`repeat(auto-fit, minmax(320px, 1fr))` with no column cap). On a wide screen
that resolves to five or six columns, which squeezes the pie charts until their
labels clip — `"Ch..."`, `"oling 9%"`, `":Turk"` are all visibly truncated. There
is no hierarchy, no grouping, and the lead-time charts are scattered among the
distribution charts.

More importantly, the page cannot answer the question it is actually opened to
answer: **how is this supplier performing, and is that good enough?** Eleven
charts show raw numbers; none of them judge.

A Supplier Performance Report was designed previously in the Claude Design
project `Die Ordering Design System` (`ui_kits/dieshop/SupplierReport.jsx`). It
is a two-page printable per-supplier scorecard with a weighted 0–10 rating. This
work brings that design into the app, against real data.

## Goal

Turn Analytics into a supplier evaluation tool: a per-supplier scorecard that
rates performance against configurable targets, alongside the existing charts
in a fixed layout.

## Non-goals

- Cross-supplier ranking or league tables. The report shows one supplier at a
  time, matching the original design.
- Server-side PDF generation. Export uses `window.print()` with print CSS, as
  the design did.
- Changing what the eleven existing charts show. They move and regroup; their
  content is untouched.
- Tracking die life or tonnage. See the data reality below.

## Decisions

| Question | Decision |
|---|---|
| What is the page for? | Judging supplier performance |
| Missing metrics? | Build with real metrics only, re-weighted. Nothing fabricated |
| Page shape? | Single-supplier report with a supplier picker, as designed |
| Existing charts? | Move to an Overview tab and fix the layout |
| Targets and weights? | Configurable in Settings, seeded from real data |

## The data reality

The original design scores six metrics. Two of them have no data source in this
application, confirmed by searching every column in every table for
life/tonnage/failure fields:

| Metric | Weight in design | Available? |
|---|---|---|
| Orders Placed | context | Yes |
| Avg Design Lead Time | 20% | Yes |
| Avg Delivery Lead Time | 20% | Yes |
| Avg Trial Ratio | 15% | Yes |
| **Avg Die Life (MT)** | **25%** | **No — not tracked anywhere** |
| **Avg Die Failure %** | **20%** | **No, not as defined** |

That is 45% of the scoring weight with nothing behind it. The design system's
figures come from `supplier-report-data.js`, which is mock data; its own header
flags the thresholds as assumptions for review.

**Die Life and Die Failure are therefore omitted, not estimated.** When tonnage
tracking exists they become two more rows in the settings table and two more
cards, with no change to the scoring engine.

`quality_discrepancies.supplier` supports a *QD Rate* — discrepancies raised per
die delivered. This is a genuine quality signal but it is **not** die failure
before rated life, and is labelled QD Rate accordingly.

## Metrics

| Metric | Source | Direction | Seed target | Seed weight |
|---|---|---|---|---|
| Orders Placed | `count(die_orders)` for the supplier and period | — | — | unscored |
| Avg Design Lead Time | `design_received_date − ordered_date` | lower better | ≤ 3 days | 20% |
| Avg Delivery Lead Time | `die_received_date − ordered_date` | lower better | ≤ 30 days | 30% |
| Avg Trial Ratio | `avg(no_of_trial)` where recorded | lower better | ≤ 1.5 | 20% |
| QD Rate | QDs raised in the period ÷ dies received in the period, × 100 | lower better | ≤ 5% | 20% |
| Design Revisions | `avg(design_revision_count)` | lower better | ≤ 1.0 | 10% |

Weights total 100%. Delivery lead time carries the heaviest weight as the
largest business impact, inheriting the role Die Life held in the original.

### Why these seed targets

Measured on the test server (**test data — confirm against production before
trusting the absolute values**):

| Supplier | Orders | Design LT | Delivery LT | Trial ratio |
|---|---|---|---|---|
| PHME | 264 | 2.5d | 25.4d | 2.08 |
| PDTMC | 258 | 3.5d | 22.2d | 1.51 |
| EKSTEK | 40 | 1.6d | 49.3d | 1.00 |
| JIANGSU | 31 | 2.5d | 40.3d | — |
| PHOENIX | 22 | 2.6d | — | — |
| COMPES | 21 | 5.2d | 46.0d | 1.00 |
| ALMAX | 16 | 4.8d | 39.3d | 2.00 |

The design's design-lead-time target of ≤7 days is far looser than actual
performance of 1.6–5.2 days, so every supplier would score 10/10 and that 20% of
the rating would carry no information. A ≤3 day target discriminates across the
observed range. Delivery (22–49d) and trial ratio (1.0–2.1) discriminate well as
they are.

These are seeds, not truths. They are editable in Settings precisely because the
right thresholds are a judgement the business makes, not one the data dictates.

## Period model

The report covers one supplier over one period, selected with three controls,
matching the original design:

- **Year** — years present in the data, defaulting to the current year
- **Month** — the month the period ends at
- **Frequency** — `Monthly` (that month alone), `Quarterly` (the quarter to date,
  ending at the selected month) or `YTD` (January to the selected month)

A die belongs to a period by its `ordered_date`, except delivery lead time and
QD rate, which key off `die_received_date` — a die ordered in March and received
in May is May's delivery, not March's.

The trend series is always monthly from January to the selected month,
regardless of frequency, so the sparklines and trend charts have something to
show even in Monthly view.

## Scoring model

Carried over unchanged from the design:

```
score(metric) = clamp01( (zero − value) / (zero − ten) ) × 10     // lower better
score(metric) = clamp01( (value − zero) / (ten − zero) ) × 10     // higher better
```

Each metric defines `ten` (the value scoring 10) and `zero` (the value scoring
0). Overall rating is the weighted mean of the scored metrics.

Bands, unchanged:

| Score | Band |
|---|---|
| ≥ 8.5 | Exceptional |
| ≥ 7.5 | Strong · Preferred |
| ≥ 6.5 | Good · Reliable |
| ≥ 5.5 | Fair · Watch |
| ≥ 4.0 | Marginal · Action needed |
| < 4.0 | At risk |

### Missing data must not score zero

If a supplier has no data for a metric, that metric scores `null`, is excluded
from the weighted mean, and the mean is renormalised over the weights actually
present. The card shows "Not tracked yet" rather than a value.

This is not a detail. JIANGSU and PHOENIX have no trials recorded; scoring that
absence as 0 would rate them "At risk" for data that was never collected. The
original design already renormalises by `wsum` — the same approach is kept, and
the report states how many metrics contributed to the rating.

## Architecture

### Backend — scoring lives on the server

`server/services/supplierPerformance.cjs`
: Metric metadata, `scoreMetric`, `overallRating`, `ratingBand`, and the
  per-supplier aggregation. Pure functions plus pool-taking async functions,
  matching `qdSettings.cjs`.

`server/services/supplierPerformanceSettings.cjs`
: Targets and weights, persisted in a single-row `supplier_performance_settings`
  table with JSON columns — the pattern `qdSettings.cjs` already uses for the QD
  option lists. Falls back to code defaults when unset.

`server/routes/supplier-performance.cjs`
: `GET /` — report for one supplier and period (snapshot, trend, scores, rating).
  `GET /settings`, `PUT /settings` — targets and weights, admin-only on write.

Scoring is server-side for two reasons: the aggregation is SQL work regardless,
and the backend is the only part of this repo with a test framework, so the model
gets real tests instead of none.

### Frontend — split the page rather than grow it

`AnalyticsPage.jsx` (currently 387 lines) becomes a thin tab shell:

| File | Responsibility |
|---|---|
| `pages/AnalyticsPage.jsx` | Tab shell: Overview / Supplier Report |
| `pages/analytics/OverviewTab.jsx` | The existing eleven charts, content unchanged, layout fixed |
| `pages/analytics/SupplierReportTab.jsx` | Supplier picker, period controls, scorecard |
| `components/analytics/RatingHero.jsx` | Gauge, band pill, narrative sentence |
| `components/analytics/MetricCard.jsx` | One metric: value, target, score bar, sparkline, delta |
| `components/analytics/TrendCard.jsx` | One metric over time with target line |
| `components/analytics/charts.jsx` | `RatingGauge`, `ScoreBar`, `Sparkline`, `LineChart`, `BarChart` |
| `components/settings/SupplierTargetsCard.jsx` | Target and weight editing |

The five chart primitives port directly from
`ui_kits/dieshop/SupplierReportCharts.jsx`. They are dependency-free SVG with
`viewBox` scaling; the only changes needed are ES module exports instead of
`window.*` globals, and the app's `theme` object instead of `var(--fg)` CSS
variables.

### The Overview tab layout fix

The clipping is caused by an uncapped `auto-fit`. The fix caps the grid at three
columns and groups the charts into labelled bands:

- **Volume & Distribution** — Supplier Performance table, Orders by Supplier,
  Distribution by Region, Orders by Die Type
- **Lead Times** — Design, Delivery, Manufacturing by supplier
- **Design Approval** — by Supplier, by Month, by Plant

## Error handling

- Supplier with no orders in the period: the report renders with every metric
  "Not tracked yet" and no overall rating, rather than a 0.0 rating.
- Weights not summing to 100% in Settings: rejected with 400 naming the total.
- A target where `ten` equals `zero`: rejected with 400, since it would divide by
  zero in the score.
- Settings fetch failure: the report falls back to code defaults and shows a
  notice saying so, so a score is never silently computed against the wrong
  thresholds.

## Testing

**Backend** — `node:test` with a mocked pool, matching the existing service
tests:

- `scoreMetric` clamps at both ends and handles both directions
- a `null` metric is excluded and the mean renormalised over remaining weights
- all metrics null produces no rating, not 0.0
- band boundaries at exactly 8.5, 7.5, 6.5, 5.5, 4.0
- aggregation groups by supplier and respects the period filter
- settings round-trip; invalid weight totals and `ten == zero` rejected

**Frontend** — no component test framework exists, so `npm run lint` and
`npm run build`, then a browser check: both tabs, the pie labels no longer
clipping, a supplier with missing trials showing "Not tracked yet", and the print
layout.

## Phasing

The Overview tab layout fix is independent of the scorecard and touches no
backend. It ships first as a self-contained phase, so the immediate readability
problem is fixed without waiting for the scoring work.

1. Overview tab: extract, regroup, cap the columns
2. Backend: scoring model, settings, route, tests
3. Supplier Report tab: primitives, cards, report
4. Settings card for targets and weights

## Assumptions to confirm

- Seed targets are derived from test-server data and should be reviewed against
  production before anyone acts on a rating.
- QD Rate uses `quality_discrepancies.supplier` matched to `die_orders.supplier`
  by name. If those vocabularies diverge, the rate under-reports.
- Weights are a business judgement; the seeds are a starting point only.
