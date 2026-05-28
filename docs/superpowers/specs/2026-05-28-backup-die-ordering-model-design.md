# Backup Die Ordering Model — Design Spec

**Date:** 2026-05-28
**Status:** Approved for implementation planning
**Phase:** 1 — Standalone model (validation before app integration)

---

## 1. Purpose

Replace the current manual backup die ordering process with a data-driven model that:

1. **Alerts** when a backup die should be ordered for a given profile, based on remaining die life and upcoming demand.
2. **Recommends a supplier** from the known supplier list, ranked by six performance criteria derived from 6 years of historical production data.

Phase 1 delivers the model as a standalone Python project. Phase 2 (separate spec) integrates the validated model into the Die Tracker web app.

---

## 2. Data Sources

All inputs are Excel exports from the existing ERP/FileMaker system. File paths are configured in `config.py` — never hardcoded in engine modules.

| File | Key fields used |
|---|---|
| `die list` | `IDDie`, `IDProfile`, `DescrSupplier`, `DescrStatus`, `IDPressPrimary`, `DieType`, `DieDiam`, `NumCavities`, `QtyKgGross`, `CapacityLastNitKg`, `NumDieLoadings`, `NumDieTrials`, `NumDieFailure`, `NumCorrections`, `KgHourNetPrimaryPr`, `DateOrder`, `DateArrival`, `DateLastNitr`, `DateScrapped` |
| `Extrusion data` | `IDDie`, `IDPress`, `DateShift`, `kgGross`, `kgNet`, `OperationsProduction::QtyKgGood`, `NumBillets`, `KgNetHour` |
| `p25 billet data` | Press-level production detail for press P25 |
| `p35 billet data` | Press-level production detail for press P35 |
| `Order booking` | `IDProfile`, `QtyKg`, `DateDelivery`, `DateRevisedDelivery`, `OrderLineStatus`, `TimeStampCreation` |

**Data sensitivity:** These files contain commercially sensitive production and supplier data. They are never committed to version control. The model reads them at runtime from a local path specified in `config.py`.

---

## 3. Project Structure

```
backup_die_model/
├── engine/
│   ├── __init__.py
│   ├── data_loader.py        # loads all 5 Excel files into dataframes
│   ├── die_life.py           # remaining life calculation per die
│   ├── demand_forecast.py    # projected demand from order booking
│   ├── supplier_scorer.py    # supplier ranking per die type
│   └── alert_engine.py       # combines modules → alert status per die
├── testing/
│   ├── backtester.py         # historical back-test runner
│   ├── scenarios.py          # named scenario definitions
│   └── metrics.py            # accuracy metric calculations
├── reports/                  # output files (gitignored)
├── config.py                 # thresholds, weights, file paths
├── main.py                   # CLI entry point
└── requirements.txt
```

`reports/` and any files containing actual data are gitignored.

---

## 4. Analytics Engine

### 4.1 Die Life Remaining

For each active die:

1. Sum `kgGross` from extrusion data for all production runs since `DateLastNitr` → `consumed_since_last_nitriding`
2. `remaining_kg = CapacityLastNitKg − consumed_since_last_nitriding`
3. Average daily consumption rate = `consumed_since_last_nitriding ÷ active_days`, weighted so the most recent 6 months count double relative to older periods.
4. `days_of_stock = remaining_kg ÷ avg_daily_consumption_rate`

Dies with `DescrStatus` indicating scrapped or inactive are excluded.

### 4.2 Demand Forecast

For each active die:

1. Filter order booking for rows where `OrderLineStatus` is pending/open and `DateDelivery` (or `DateRevisedDelivery` if set) falls within the next **90 days** (configurable: `FORECAST_WINDOW_DAYS` in `config.py`).
2. Map `IDProfile` → `IDDie` via die list. When multiple active dies share the same `IDProfile`, demand is assigned to the die whose `IDPressPrimary` matches the press most recently used for that profile in extrusion data. If still tied, demand is split proportionally by `NumCavities`.
3. Sum `QtyKg` per die → `projected_demand_kg`.
4. `forecast_daily_demand = projected_demand_kg ÷ FORECAST_WINDOW_DAYS`.

When both historical consumption and forecast demand are available, the alert uses `max(avg_daily_consumption, forecast_daily_demand)` as the effective demand rate, ensuring the stricter of the two signals drives the alert.

### 4.3 Alert Logic

Supplier lead time per supplier is computed as `avg(DateArrival − DateOrder)` from the die list history.

For each active die, the relevant lead time is determined in this order:
1. Lead time of the top-ranked supplier from the scoring model (§4.4)
2. If scoring cannot run (insufficient data): lead time of `DescrSupplier` recorded on the die list entry
3. If that supplier has no lead time history: median lead time across all suppliers in the die list

| Alert Level | Condition |
|---|---|
| 🔴 RED — Order Now | `days_of_stock < lead_time_days` |
| 🟡 AMBER — Order Soon | `days_of_stock < lead_time_days × SAFETY_FACTOR` |
| 🟢 GREEN — OK | Otherwise |

`SAFETY_FACTOR` defaults to **1.5** and is configurable in `config.py`.

### 4.4 Supplier Scoring

For a given die (identified by `DieType`, `DieDiam`, `IDPressPrimary`), find all historical dies with matching attributes. Group by `DescrSupplier` and compute the following six criteria:

| Criterion | Formula | Direction |
|---|---|---|
| Die life | `avg(QtyKgGross)` per die by supplier | Higher → better |
| Die failure ratio | `sum(NumDieFailure) / count(dies)` by supplier | Lower → better |
| No. of trials | `avg(NumDieTrials)` by supplier | Lower → better |
| Productivity | `avg(KgHourNetPrimaryPr)` by supplier | Higher → better |
| Recovery (metal yield) | `avg(QtyKgGood / kgGross)` from extrusion data, joined via `IDDie` → supplier | Higher → better |
| Lead time | `avg(DateArrival − DateOrder)` in days by supplier | Lower → better |

Each criterion is min-max normalised to [0, 1] across all eligible suppliers. A lower-is-better criterion is inverted (1 − normalised value) before weighting. The composite score is:

```
score = w1·die_life + w2·(1−failure_ratio) + w3·(1−trials) + w4·productivity + w5·recovery + w6·(1−lead_time)
```

Default weights (all equal: `1/6` each) are set in `config.py` and adjustable for tuning during validation.

The supplier with the highest composite score is the primary recommendation. The full ranked list is included in output for transparency.

**Minimum data requirement:** A supplier must have made at least **2 dies** of matching type to be included in scoring (configurable: `MIN_SUPPLIER_DIES`). Suppliers with fewer dies are listed separately as "insufficient history."

---

## 5. Back-Testing

### 5.1 Approach

For every die in the die list with a known end-of-life event (`DateScrapped` not null):

1. Ground-truth crisis date = `DateScrapped`. Dies with `NumDieFailure > 0` but no `DateScrapped` are excluded from back-testing (a single failure does not constitute end-of-life).
2. Simulate running the alert engine weekly, stepping backward from the crisis date across the preceding 180 days.
3. Record the first date the model would have issued a RED alert.
4. Compare alert date vs. `lead_time_days` before crisis date.

### 5.2 Accuracy Metrics

| Metric | Definition |
|---|---|
| True Positive Rate | Fraction of crisis events where RED alert fired ≥ `lead_time_days` before crisis |
| False Positive Rate | Fraction of RED alerts where die still had >2× lead time of life remaining |
| Median alert lead (days) | Median days between RED alert and actual crisis across all true positives |
| Supplier rank match | For historical backup orders: fraction where top-ranked supplier matches the supplier actually chosen, or a supplier with a measurably better historical score |

Results are written to `reports/backtest_YYYY-MM-DD.xlsx`.

### 5.3 Named Scenarios

| Scenario | Description |
|---|---|
| `high_demand` | Large order spike for a profile — alert should trigger earlier |
| `low_demand` | No pending orders — alert should relax relative to consumption-only baseline |
| `slow_supplier` | Supplier with >90-day lead time — RED threshold widens |
| `high_failure_die` | Die from supplier with poor failure history — scored lower |
| `cold_start` | New profile with no extrusion history — model falls back to consumption = 0, demand-only |
| `multi_die_same_profile` | Two active dies for one profile — model alerts on the one closer to exhaustion |

Each scenario is a self-contained function in `testing/scenarios.py` that injects synthetic overrides on top of real data, so results are reproducible without modifying source files.

---

## 6. CLI Interface

```
python main.py alerts                  # print current alert table for all active dies
python main.py alerts --press P25      # filter by press
python main.py backtest                # run full historical back-test, write report
python main.py scenario high_demand    # run named scenario
python main.py scenario all            # run all scenarios
python main.py score --die <IDDie>     # show supplier scorecard for a specific die
```

Output to console is a formatted table. All runs also write to `reports/`.

---

## 7. Configuration (`config.py`)

```python
DATA_DIR = r"C:\path\to\excel\files"   # absolute path to Excel data folder

FORECAST_WINDOW_DAYS = 90
SAFETY_FACTOR = 1.5
MIN_SUPPLIER_DIES = 2

SUPPLIER_WEIGHTS = {
    "die_life":      1/6,
    "failure_ratio": 1/6,
    "trials":        1/6,
    "productivity":  1/6,
    "recovery":      1/6,
    "lead_time":     1/6,
}

RECENT_WEIGHT_MONTHS = 6   # period given double weight in consumption rate
```

All thresholds and weights are adjusted here during validation — no changes to engine code required.

---

## 8. Dependencies

```
pandas
openpyxl
numpy
tabulate       # console table formatting
xlsxwriter     # report output
```

Python 3.10+. No ML libraries required — the model is fully rule-based and interpretable.

---

## 9. Out of Scope (Phase 1)

- Web app integration (Phase 2)
- Email alerts (Phase 2)
- Real-time data connection to ERP (Phase 2)
- Automated scheduling (Phase 2)
- User interface (Phase 2)

---

## 10. Success Criteria for Phase 1

The model is considered ready for Phase 2 integration when:

1. True Positive Rate ≥ 80% on historical back-test
2. False Positive Rate ≤ 20%
3. Median alert lead ≥ 7 days ahead of supplier lead time
4. Supplier rank match ≥ 70% on historical orders
5. All 6 named scenarios produce expected directional results
