# Backup Die Ordering Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Python model that alerts when a backup die should be ordered and recommends a ranked supplier, validated against 6 years of historical data before app integration.

**Architecture:** Rule-based analytics engine reading 5 Excel files. Engine modules accept DataFrames + explicit parameters (no config import inside engine — keeps tests isolated). A CLI main.py wires config → engine → reports.

**Tech Stack:** Python 3.10+, pandas, numpy, openpyxl, xlsxwriter, tabulate, pytest

---

## File Map

```
backup_die_model/
├── engine/
│   ├── __init__.py                   CREATE  empty
│   ├── data_loader.py                CREATE  loads 5 Excel files → DataFrames
│   ├── die_life.py                   CREATE  remaining kg + daily consumption per die
│   ├── demand_forecast.py            CREATE  confirmed + frequency + combined demand
│   ├── supplier_scorer.py            CREATE  6-criterion supplier ranking
│   └── alert_engine.py              CREATE  RED/AMBER/GREEN alerts per die
├── testing/
│   ├── __init__.py                   CREATE  empty
│   ├── metrics.py                    CREATE  TPR, FPR, alert-lead, rank-match
│   ├── backtester.py                 CREATE  weekly replay against DateScrapped ground truth
│   └── scenarios.py                 CREATE  7 named scenario functions
├── tests/
│   ├── conftest.py                   CREATE  shared synthetic DataFrame fixtures
│   ├── test_data_loader.py           CREATE
│   ├── test_die_life.py              CREATE
│   ├── test_demand_forecast.py       CREATE
│   ├── test_supplier_scorer.py       CREATE
│   ├── test_alert_engine.py          CREATE
│   ├── test_metrics.py               CREATE
│   ├── test_backtester.py            CREATE
│   └── test_scenarios.py             CREATE
├── reports/                          CREATE  (gitignored, output only)
├── config.py                         CREATE  all thresholds, weights, file paths
├── main.py                           CREATE  CLI entry point
├── requirements.txt                  CREATE
└── .gitignore                        CREATE
```

---

## Task 1: Scaffold project

**Files:** Create all directories, `config.py`, `requirements.txt`, `.gitignore`, empty `__init__.py` files. Initialize git.

- [ ] **Step 1: Create directory structure**

```powershell
cd C:\Users\vijee\Desktop\19.05.2026
mkdir backup_die_model
cd backup_die_model
mkdir engine, testing, tests, reports
New-Item engine\__init__.py, testing\__init__.py, tests\__init__.py -ItemType File
New-Item reports\.gitkeep -ItemType File
```

- [ ] **Step 2: Write `requirements.txt`**

```
pandas>=2.0
openpyxl>=3.1
numpy>=1.25
tabulate>=0.9
xlsxwriter>=3.1
pytest>=8.0
```

- [ ] **Step 3: Write `.gitignore`**

```
reports/
*.xlsx
*.xls
config_local.py
__pycache__/
*.pyc
.pytest_cache/
```

- [ ] **Step 4: Write `config.py`**

```python
import os

DATA_DIR = r"C:\Users\vijee\Desktop\19.05.2026\Data\Data"

FILE_DIE_LIST      = "die list 28.05.xlsx"
FILE_EXTRUSION     = "Extrusion data.xlsx"
FILE_ORDER_BOOKING = "order booking.xlsx"
FILE_P25_BILLET    = "p25 billet data.xlsx"
FILE_P35_BILLET    = "p35 billet data.xlsx"

SAFETY_FACTOR             = 1.5
MIN_SUPPLIER_DIES         = 2
MIN_ORDERS_FOR_FREQUENCY  = 3
RECENT_WEIGHT_MONTHS      = 6

SUPPLIER_WEIGHTS = {
    "die_life":      1/6,
    "failure_ratio": 1/6,
    "trials":        1/6,
    "productivity":  1/6,
    "recovery":      1/6,
    "lead_time":     1/6,
}
```

- [ ] **Step 5: Install dependencies**

```powershell
pip install -r requirements.txt
```

Expected: no errors.

- [ ] **Step 6: Initialize git and commit scaffold**

```powershell
git init
git add .
git commit -m "chore: scaffold backup_die_model project"
```

---

## Task 2: Shared test fixtures (`tests/conftest.py`)

All tests use synthetic DataFrames — no real Excel files required.

**Files:** Create `tests/conftest.py`

- [ ] **Step 1: Write `tests/conftest.py`**

```python
import pandas as pd
import numpy as np
import pytest
from datetime import date

TODAY = pd.Timestamp("2026-05-28")

@pytest.fixture
def die_list():
    return pd.DataFrame({
        'IDDie':              ['D001', 'D002', 'D003', 'D004'],
        'IDProfile':          ['P001', 'P001', 'P002', 'P003'],
        'DescrSupplier':      ['SUP_A', 'SUP_B', 'SUP_A', 'SUP_B'],
        'IDPressPrimary':     ['P25', 'P25', 'P35', 'P25'],
        'DieType':            ['SOLID', 'SOLID', 'SOLID', 'HOLLOW'],
        'DieDiam':            [200.0, 200.0, 200.0, 250.0],
        'NumCavities':        [1, 1, 1, 1],
        'QtyKgGross':         [50000.0, 40000.0, 30000.0, 20000.0],
        'CapacityLastNitKg':  [10000.0, 8000.0, 12000.0, 15000.0],
        'NumDieLoadings':     [100, 80, 60, 40],
        'NumDieTrials':       [2, 4, 3, 1],
        'NumDieFailure':      [1, 0, 2, 0],
        'NumCorrections':     [2, 1, 3, 0],
        'KgHourNetPrimaryPr': [500.0, 450.0, 480.0, 600.0],
        'DateOrder':   pd.to_datetime(['2024-01-01', '2024-03-01', '2023-06-01', '2024-06-01']),
        'DateArrival': pd.to_datetime(['2024-03-15', '2024-05-20', '2023-08-01', '2024-08-10']),
        'DateLastNitr':pd.to_datetime(['2026-01-01', '2026-02-01', '2026-01-15', None]),
        'DateScrapped':[None, None, None, None],
    })

@pytest.fixture
def die_list_with_scrapped(die_list):
    df = die_list.copy()
    df.loc[3, 'DateScrapped'] = pd.Timestamp('2026-04-01')
    return df

@pytest.fixture
def extrusion_data():
    return pd.DataFrame({
        'IDDie':    ['D001', 'D001', 'D001', 'D002', 'D002', 'D003'],
        'IDPress':  ['P25',  'P25',  'P25',  'P25',  'P25',  'P35'],
        'DateShift':pd.to_datetime([
            '2026-01-15', '2026-03-01', '2026-04-15',
            '2026-02-10', '2026-04-20',
            '2026-01-20',
        ]),
        'kgGross':  [3000.0, 2500.0, 2000.0, 4000.0, 3000.0, 5000.0],
        'kgNet':    [2700.0, 2250.0, 1800.0, 3600.0, 2700.0, 4500.0],
        'OperationsProduction::QtyKgGood': [2600.0, 2100.0, 1700.0, 3500.0, 2600.0, 4300.0],
        'KgNetHour':[450.0, 460.0, 440.0, 500.0, 490.0, 480.0],
        'NumBillets':[30, 25, 20, 40, 30, 50],
    })

@pytest.fixture
def order_booking():
    # P001: 5 historical orders (enough for frequency model) + 2 open
    # P002: 2 historical orders (cold start — below MIN_ORDERS_FOR_FREQUENCY=3)
    return pd.DataFrame({
        'IDProfile': ['P001','P001','P001','P001','P001','P001','P001','P002','P002'],
        'QtyKg':     [5000., 4500., 5200., 4800., 5100., 5000., 3000., 2000., 1800.],
        'DateDelivery': pd.to_datetime([
            '2026-07-01', '2026-08-15',        # open, within horizon
            '2024-03-01', '2024-06-01',        # closed historical
            '2024-09-01', '2024-12-01',        # closed historical
            '2025-03-01',                      # closed historical
            '2026-07-15',                      # P002 open
            '2024-06-01',                      # P002 closed
        ]),
        'DateRevisedDelivery': [None]*9,
        'OrderLineStatus': [
            'OPEN','OPEN',
            'CLOSED','CLOSED','CLOSED','CLOSED','CLOSED',
            'OPEN','CLOSED',
        ],
        'TimeStampCreation': pd.to_datetime([
            '2026-05-01', '2026-05-15',
            '2023-12-01', '2024-03-01', '2024-06-01', '2024-09-01', '2024-12-01',
            '2026-05-10', '2024-03-01',
        ]),
    })

@pytest.fixture
def today():
    return TODAY
```

- [ ] **Step 2: Verify fixtures load without error**

```powershell
cd C:\Users\vijee\Desktop\19.05.2026\backup_die_model
pytest tests/conftest.py --collect-only -q
```

Expected: `no tests ran` (fixtures only, not tests).

- [ ] **Step 3: Commit**

```powershell
git add tests/conftest.py
git commit -m "test: add shared synthetic DataFrame fixtures"
```

---

## Task 3: Data loader (`engine/data_loader.py`)

**Files:** Create `engine/data_loader.py`, `tests/test_data_loader.py`

- [ ] **Step 1: Write failing test**

```python
# tests/test_data_loader.py
import pandas as pd
import pytest
from pathlib import Path
from engine.data_loader import load_die_list, load_extrusion_data, load_order_booking, load_all

@pytest.fixture
def tmp_excel_dir(tmp_path):
    """Creates minimal Excel files matching the real schema."""
    die_df = pd.DataFrame({
        'IDDie': ['D001'], 'IDProfile': ['P001'],
        'DescrSupplier': ['SUP_A'], 'IDPressPrimary': ['P25'],
        'DieType': ['SOLID'], 'DieDiam': [200.0],
        'NumCavities': [1], 'QtyKgGross': [50000.0],
        'CapacityLastNitKg': [10000.0], 'NumDieLoadings': [100],
        'NumDieTrials': [2], 'NumDieFailure': [1],
        'NumCorrections': [2], 'KgHourNetPrimaryPr': [500.0],
        'DateOrder': ['2024-01-01'], 'DateArrival': ['2024-03-15'],
        'DateLastNitr': ['2026-01-01'], 'DateScrapped': [None],
    })
    ext_df = pd.DataFrame({
        'IDDie': ['D001'], 'IDPress': ['P25'],
        'DateShift': ['2026-01-15'], 'kgGross': [3000.0],
        'kgNet': [2700.0], 'OperationsProduction::QtyKgGood': [2600.0],
        'KgNetHour': [450.0], 'NumBillets': [30],
    })
    order_df = pd.DataFrame({
        'IDProfile': ['P001'], 'QtyKg': [5000.0],
        'DateDelivery': ['2026-07-01'], 'DateRevisedDelivery': [None],
        'OrderLineStatus': ['OPEN'], 'TimeStampCreation': ['2026-05-01'],
    })
    billet_df = pd.DataFrame({'IDPress': ['P25'], 'Date': ['2026-01-01']})

    die_df.to_excel(tmp_path / "die list 28.05.xlsx", index=False)
    ext_df.to_excel(tmp_path / "Extrusion data.xlsx", index=False)
    order_df.to_excel(tmp_path / "order booking.xlsx", index=False)
    billet_df.to_excel(tmp_path / "p25 billet data.xlsx", index=False)
    billet_df.to_excel(tmp_path / "p35 billet data.xlsx", index=False)
    return str(tmp_path)

def test_load_die_list_returns_dataframe(tmp_excel_dir):
    df = load_die_list(tmp_excel_dir)
    assert isinstance(df, pd.DataFrame)
    assert 'IDDie' in df.columns
    assert 'CapacityLastNitKg' in df.columns

def test_load_die_list_parses_dates(tmp_excel_dir):
    df = load_die_list(tmp_excel_dir)
    assert pd.api.types.is_datetime64_any_dtype(df['DateOrder'])
    assert pd.api.types.is_datetime64_any_dtype(df['DateArrival'])

def test_load_extrusion_data_returns_dataframe(tmp_excel_dir):
    df = load_extrusion_data(tmp_excel_dir)
    assert isinstance(df, pd.DataFrame)
    assert 'IDDie' in df.columns
    assert 'kgGross' in df.columns

def test_load_order_booking_parses_timestamp(tmp_excel_dir):
    df = load_order_booking(tmp_excel_dir)
    assert pd.api.types.is_datetime64_any_dtype(df['TimeStampCreation'])

def test_load_all_returns_all_keys(tmp_excel_dir):
    data = load_all(tmp_excel_dir)
    assert set(data.keys()) == {'die_list', 'extrusion', 'order_booking', 'p25_billet', 'p35_billet'}
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_data_loader.py -v
```

Expected: `ImportError` or `ModuleNotFoundError` for `engine.data_loader`.

- [ ] **Step 3: Write `engine/data_loader.py`**

```python
import pandas as pd
from pathlib import Path

_DIE_LIST_DATES      = ['DateOrder','DateArrival','DateLastNitr','DateScrapped',
                         'DateCreation','DateFirstMounted','DateLastMounted']
_EXTRUSION_DATES     = ['DateShift','DateChangeStart','DateChangeEnd']
_ORDER_BOOKING_DATES = ['DateDelivery','DateRevisedDelivery','DatePlanningEntry','TimeStampCreation']

_FILES = {
    'die_list':      'die list 28.05.xlsx',
    'extrusion':     'Extrusion data.xlsx',
    'order_booking': 'order booking.xlsx',
    'p25_billet':    'p25 billet data.xlsx',
    'p35_billet':    'p35 billet data.xlsx',
}

def _read(data_dir: str, filename: str, date_cols: list) -> pd.DataFrame:
    path = Path(data_dir) / filename
    df = pd.read_excel(path)
    for col in date_cols:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    return df

def load_die_list(data_dir: str) -> pd.DataFrame:
    return _read(data_dir, _FILES['die_list'], _DIE_LIST_DATES)

def load_extrusion_data(data_dir: str) -> pd.DataFrame:
    return _read(data_dir, _FILES['extrusion'], _EXTRUSION_DATES)

def load_order_booking(data_dir: str) -> pd.DataFrame:
    return _read(data_dir, _FILES['order_booking'], _ORDER_BOOKING_DATES)

def load_p25_billet(data_dir: str) -> pd.DataFrame:
    return _read(data_dir, _FILES['p25_billet'], [])

def load_p35_billet(data_dir: str) -> pd.DataFrame:
    return _read(data_dir, _FILES['p35_billet'], [])

def load_all(data_dir: str) -> dict:
    return {
        'die_list':      load_die_list(data_dir),
        'extrusion':     load_extrusion_data(data_dir),
        'order_booking': load_order_booking(data_dir),
        'p25_billet':    load_p25_billet(data_dir),
        'p35_billet':    load_p35_billet(data_dir),
    }
```

- [ ] **Step 4: Run tests and confirm pass**

```powershell
pytest tests/test_data_loader.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/data_loader.py tests/test_data_loader.py
git commit -m "feat: add data loader with date parsing"
```

---

## Task 4: Die life module (`engine/die_life.py`)

**Files:** Create `engine/die_life.py`, `tests/test_die_life.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_die_life.py
import pandas as pd
import pytest
from engine.die_life import compute_die_life

def test_remaining_kg_basic(die_list, extrusion_data, today):
    # D001: CapacityLastNitKg=10000, DateLastNitr=2026-01-01
    # Extrusion runs after 2026-01-01: 3000+2500+2000 = 7500 consumed
    # remaining = 10000 - 7500 = 2500
    result = compute_die_life(die_list, extrusion_data, today=today.date(), recent_weight_months=6)
    d001 = result[result['IDDie'] == 'D001'].iloc[0]
    assert d001['remaining_kg'] == pytest.approx(2500.0)

def test_remaining_kg_never_negative(die_list, extrusion_data, today):
    # Consume more than capacity
    ext = extrusion_data.copy()
    ext.loc[ext['IDDie'] == 'D001', 'kgGross'] = 5000.0  # 3 runs × 5000 = 15000 > 10000
    result = compute_die_life(die_list, ext, today=today.date(), recent_weight_months=6)
    d001 = result[result['IDDie'] == 'D001'].iloc[0]
    assert d001['remaining_kg'] >= 0.0

def test_scrapped_die_excluded(die_list_with_scrapped, extrusion_data, today):
    result = compute_die_life(die_list_with_scrapped, extrusion_data, today=today.date(), recent_weight_months=6)
    assert 'D004' not in result['IDDie'].values

def test_zero_consumption_gives_inf_days(die_list, today):
    empty_ext = pd.DataFrame(columns=['IDDie','IDPress','DateShift','kgGross','kgNet',
                                       'OperationsProduction::QtyKgGood','KgNetHour','NumBillets'])
    result = compute_die_life(die_list, empty_ext, today=today.date(), recent_weight_months=6)
    d001 = result[result['IDDie'] == 'D001'].iloc[0]
    assert d001['days_of_stock_consumption'] == float('inf')

def test_daily_consumption_positive(die_list, extrusion_data, today):
    result = compute_die_life(die_list, extrusion_data, today=today.date(), recent_weight_months=6)
    d001 = result[result['IDDie'] == 'D001'].iloc[0]
    assert d001['avg_daily_consumption'] > 0

def test_result_has_required_columns(die_list, extrusion_data, today):
    result = compute_die_life(die_list, extrusion_data, today=today.date(), recent_weight_months=6)
    for col in ['IDDie', 'IDProfile', 'remaining_kg', 'avg_daily_consumption', 'days_of_stock_consumption']:
        assert col in result.columns
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_die_life.py -v
```

Expected: `ImportError` for `engine.die_life`.

- [ ] **Step 3: Write `engine/die_life.py`**

```python
import pandas as pd
import numpy as np
from datetime import date as date_type


def compute_die_life(die_list: pd.DataFrame, extrusion_data: pd.DataFrame,
                     today: date_type = None, recent_weight_months: int = 6) -> pd.DataFrame:
    today_ts = pd.Timestamp(today or date_type.today())
    active = die_list[die_list['DateScrapped'].isna()].copy()
    cutoff = today_ts - pd.DateOffset(months=recent_weight_months)

    rows = []
    for _, die in active.iterrows():
        die_id = die['IDDie']
        last_nitr = die['DateLastNitr']
        capacity = die['CapacityLastNitKg']

        runs = extrusion_data[extrusion_data['IDDie'] == die_id].copy()
        if pd.notna(last_nitr):
            runs = runs[runs['DateShift'] >= last_nitr]

        consumed = float(runs['kgGross'].sum())
        remaining_kg = max(0.0, float(capacity) - consumed) if pd.notna(capacity) else 0.0

        if runs.empty:
            avg_daily = 0.0
        else:
            recent_runs = runs[runs['DateShift'] >= cutoff]
            older_runs  = runs[runs['DateShift'] <  cutoff]

            recent_kg = float(recent_runs['kgGross'].sum())
            older_kg  = float(older_runs['kgGross'].sum())

            first_date = runs['DateShift'].min()
            total_days = max(1, (today_ts - first_date).days)
            if not recent_runs.empty:
                recent_start = max(recent_runs['DateShift'].min(), cutoff)
                recent_days  = max(1, (today_ts - recent_start).days)
            else:
                recent_days = 0

            older_days = max(0, total_days - recent_days)

            weighted_kg   = recent_kg * 2 + older_kg
            weighted_days = recent_days * 2 + older_days
            avg_daily = weighted_kg / weighted_days if weighted_days > 0 else 0.0

        days_stock = remaining_kg / avg_daily if avg_daily > 0 else float('inf')

        rows.append({
            'IDDie': die_id,
            'IDProfile': die['IDProfile'],
            'remaining_kg': remaining_kg,
            'avg_daily_consumption': avg_daily,
            'days_of_stock_consumption': days_stock,
        })

    return pd.DataFrame(rows)
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_die_life.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/die_life.py tests/test_die_life.py
git commit -m "feat: die life remaining calculation with recency weighting"
```

---

## Task 5: Demand forecast — confirmed orders

**Files:** Create `engine/demand_forecast.py` (partial), `tests/test_demand_forecast.py` (partial)

- [ ] **Step 1: Write failing tests for confirmed demand**

```python
# tests/test_demand_forecast.py
import pandas as pd
import pytest
from engine.demand_forecast import compute_confirmed_demand, compute_frequency_demand, compute_combined_demand

def test_confirmed_demand_sums_pending_orders(die_list, order_booking, today):
    # P001 has 2 OPEN orders with delivery in 2026-07: 5000 + 4500 = 9500 kg
    horizon = 120
    result = compute_confirmed_demand(order_booking, die_list, horizon, today=today.date())
    p001_dies = result[result['IDProfile'] == 'P001']
    assert p001_dies['confirmed_demand_kg'].sum() == pytest.approx(9500.0)

def test_confirmed_demand_excludes_closed_orders(die_list, order_booking, today):
    horizon = 120
    result = compute_confirmed_demand(order_booking, die_list, horizon, today=today.date())
    # D001 and D002 both serve P001; closed orders (2024) are excluded
    total = result['confirmed_demand_kg'].sum()
    assert total == pytest.approx(9500.0 + 2000.0)  # P001 + P002 open orders

def test_confirmed_demand_uses_revised_delivery(die_list, today):
    orders = pd.DataFrame({
        'IDProfile': ['P001'],
        'QtyKg': [3000.0],
        'DateDelivery': pd.to_datetime(['2020-01-01']),       # in the past
        'DateRevisedDelivery': pd.to_datetime(['2026-07-01']),# revised to future
        'OrderLineStatus': ['OPEN'],
        'TimeStampCreation': pd.to_datetime(['2026-05-01']),
    })
    result = compute_confirmed_demand(orders, die_list, 90, today=today.date())
    assert result['confirmed_demand_kg'].sum() == pytest.approx(3000.0)

def test_confirmed_demand_empty_when_no_pending(die_list, today):
    orders = pd.DataFrame({
        'IDProfile': ['P001'], 'QtyKg': [5000.0],
        'DateDelivery': pd.to_datetime(['2020-01-01']),
        'DateRevisedDelivery': [None],
        'OrderLineStatus': ['CLOSED'],
        'TimeStampCreation': pd.to_datetime(['2019-12-01']),
    })
    result = compute_confirmed_demand(orders, die_list, 90, today=today.date())
    assert result.empty or result['confirmed_demand_kg'].sum() == 0.0
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_demand_forecast.py::test_confirmed_demand_sums_pending_orders -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `engine/demand_forecast.py` — confirmed demand only**

```python
import pandas as pd
import numpy as np
from datetime import date as date_type


def compute_confirmed_demand(order_booking: pd.DataFrame, die_list: pd.DataFrame,
                              horizon_days: int, today: date_type = None) -> pd.DataFrame:
    today_ts = pd.Timestamp(today or date_type.today())
    horizon_end = today_ts + pd.Timedelta(days=horizon_days)

    orders = order_booking.copy()
    orders['_delivery'] = orders['DateRevisedDelivery'].fillna(orders['DateDelivery'])

    pending = orders[
        (orders['OrderLineStatus'].str.upper().isin(['OPEN', 'PENDING'])) &
        (orders['_delivery'] >= today_ts) &
        (orders['_delivery'] <= horizon_end)
    ]

    active_dies = die_list[die_list['DateScrapped'].isna()][
        ['IDDie', 'IDProfile', 'IDPressPrimary', 'NumCavities']
    ].copy()

    rows = []
    for profile, group in pending.groupby('IDProfile'):
        kg = float(group['QtyKg'].sum())
        matching = active_dies[active_dies['IDProfile'] == profile]
        if matching.empty:
            continue
        total_cav = matching['NumCavities'].sum()
        for _, d in matching.iterrows():
            share = float(d['NumCavities']) / total_cav if total_cav > 0 else 1.0 / len(matching)
            rows.append({'IDDie': d['IDDie'], 'IDProfile': profile, 'confirmed_demand_kg': kg * share})

    if not rows:
        return pd.DataFrame(columns=['IDDie', 'IDProfile', 'confirmed_demand_kg'])
    return pd.DataFrame(rows)
```

- [ ] **Step 4: Run confirmed demand tests**

```powershell
pytest tests/test_demand_forecast.py -k "confirmed" -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/demand_forecast.py tests/test_demand_forecast.py
git commit -m "feat: confirmed demand from pending order bookings"
```

---

## Task 6: Demand forecast — frequency model + combined signal

**Files:** Extend `engine/demand_forecast.py`, extend `tests/test_demand_forecast.py`

- [ ] **Step 1: Add failing tests for frequency and combined**

Append to `tests/test_demand_forecast.py`:

```python
def test_frequency_avg_interval(die_list, order_booking, today):
    # P001 closed orders on: 2023-12-01, 2024-03-01, 2024-06-01, 2024-09-01, 2024-12-01
    # intervals: 91, 92, 92, 92 days → avg ≈ 91.75
    result = compute_frequency_demand(order_booking, die_list, 120, min_orders=3, today=today.date())
    p001 = result[result['IDProfile'] == 'P001'].iloc[0]
    assert p001['frequency_active'] is True
    assert p001['avg_interval_days'] == pytest.approx(91.75, rel=0.05)

def test_frequency_cold_start_below_min(die_list, order_booking, today):
    # P002 has only 2 historical orders → cold start
    result = compute_frequency_demand(order_booking, die_list, 120, min_orders=3, today=today.date())
    p002 = result[result['IDProfile'] == 'P002']
    if not p002.empty:
        assert p002.iloc[0]['frequency_active'] is False
        assert p002.iloc[0]['frequency_predicted_kg'] == pytest.approx(0.0)

def test_frequency_predicts_zero_when_next_order_beyond_horizon(die_list, today):
    # 3 orders 300 days apart, last order was yesterday
    # days_until_next = 299 days → beyond any reasonable horizon
    orders = pd.DataFrame({
        'IDProfile': ['P001','P001','P001'],
        'QtyKg': [5000.0, 5000.0, 5000.0],
        'DateDelivery': pd.to_datetime(['2024-01-01','2024-11-01','2025-09-01']),
        'DateRevisedDelivery': [None, None, None],
        'OrderLineStatus': ['CLOSED','CLOSED','CLOSED'],
        'TimeStampCreation': pd.to_datetime(['2024-01-01','2024-11-01','2025-09-01']),
    })
    result = compute_frequency_demand(orders, die_list, 60, min_orders=3, today=today.date())
    p001 = result[result['IDProfile'] == 'P001']
    if not p001.empty and p001.iloc[0]['frequency_active']:
        assert p001.iloc[0]['predicted_order_count'] == 0
        assert p001.iloc[0]['frequency_predicted_kg'] == pytest.approx(0.0)

def test_combined_uses_max_of_confirmed_and_frequency(die_list, today):
    confirmed = pd.DataFrame({'IDDie': ['D001'], 'IDProfile': ['P001'], 'confirmed_demand_kg': [3000.0]})
    frequency = pd.DataFrame({'IDDie': ['D001'], 'frequency_predicted_kg': [8000.0]})
    result = compute_combined_demand(confirmed, frequency, horizon_days=90)
    assert result.iloc[0]['combined_demand_kg'] == pytest.approx(8000.0)

def test_combined_no_double_counting(die_list, today):
    confirmed = pd.DataFrame({'IDDie': ['D001'], 'IDProfile': ['P001'], 'confirmed_demand_kg': [9000.0]})
    frequency = pd.DataFrame({'IDDie': ['D001'], 'frequency_predicted_kg': [5000.0]})
    result = compute_combined_demand(confirmed, frequency, horizon_days=90)
    assert result.iloc[0]['combined_demand_kg'] == pytest.approx(9000.0)

def test_combined_effective_daily_demand(die_list, today):
    confirmed = pd.DataFrame({'IDDie': ['D001'], 'IDProfile': ['P001'], 'confirmed_demand_kg': [9000.0]})
    frequency = pd.DataFrame({'IDDie': ['D001'], 'frequency_predicted_kg': [5000.0]})
    result = compute_combined_demand(confirmed, frequency, horizon_days=90)
    assert result.iloc[0]['effective_daily_demand'] == pytest.approx(9000.0 / 90, rel=0.01)
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_demand_forecast.py -k "frequency or combined" -v
```

Expected: `ImportError` for `compute_frequency_demand` / `compute_combined_demand`.

- [ ] **Step 3: Add frequency and combined functions to `engine/demand_forecast.py`**

Append to `engine/demand_forecast.py`:

```python
def compute_frequency_demand(order_booking: pd.DataFrame, die_list: pd.DataFrame,
                              horizon_days: int, min_orders: int = 3,
                              today: date_type = None) -> pd.DataFrame:
    today_ts = pd.Timestamp(today or date_type.today())
    active_dies = die_list[die_list['DateScrapped'].isna()][
        ['IDDie', 'IDProfile', 'IDPressPrimary', 'NumCavities']
    ].copy()

    rows = []
    for profile, orders in order_booking.groupby('IDProfile'):
        hist = orders.dropna(subset=['TimeStampCreation']).sort_values('TimeStampCreation')
        matching = active_dies[active_dies['IDProfile'] == profile]
        if matching.empty:
            continue

        if len(hist) < min_orders:
            for _, d in matching.iterrows():
                rows.append({
                    'IDDie': d['IDDie'], 'IDProfile': profile,
                    'frequency_predicted_kg': 0.0,
                    'avg_interval_days': None, 'predicted_order_count': 0,
                    'frequency_active': False,
                })
            continue

        intervals = hist['TimeStampCreation'].diff().dropna().dt.days.values
        avg_interval = float(np.mean(intervals))
        avg_order_kg = float(hist['QtyKg'].mean())

        last_date = hist['TimeStampCreation'].max()
        days_since = max(0, (today_ts - last_date).days)
        days_until_next = max(0.0, avg_interval - days_since)

        if days_until_next > horizon_days or avg_interval <= 0:
            predicted_count = 0
        else:
            predicted_count = 1 + int((horizon_days - days_until_next) // avg_interval)

        freq_kg = predicted_count * avg_order_kg

        total_cav = matching['NumCavities'].sum()
        for _, d in matching.iterrows():
            share = float(d['NumCavities']) / total_cav if total_cav > 0 else 1.0 / len(matching)
            rows.append({
                'IDDie': d['IDDie'], 'IDProfile': profile,
                'frequency_predicted_kg': freq_kg * share,
                'avg_interval_days': avg_interval,
                'predicted_order_count': predicted_count,
                'frequency_active': True,
            })

    if not rows:
        return pd.DataFrame(columns=['IDDie','IDProfile','frequency_predicted_kg',
                                      'avg_interval_days','predicted_order_count','frequency_active'])
    return pd.DataFrame(rows)


def compute_combined_demand(confirmed: pd.DataFrame, frequency: pd.DataFrame,
                             horizon_days: int) -> pd.DataFrame:
    freq_slim = frequency[['IDDie', 'frequency_predicted_kg']].copy() if not frequency.empty else pd.DataFrame(columns=['IDDie','frequency_predicted_kg'])
    merged = confirmed.merge(freq_slim, on='IDDie', how='outer')
    merged['confirmed_demand_kg']   = merged['confirmed_demand_kg'].fillna(0.0)
    merged['frequency_predicted_kg'] = merged['frequency_predicted_kg'].fillna(0.0)

    merged['combined_demand_kg']    = merged[['confirmed_demand_kg','frequency_predicted_kg']].max(axis=1)
    merged['effective_daily_demand'] = merged['combined_demand_kg'] / max(horizon_days, 1)

    return merged[['IDDie','confirmed_demand_kg','frequency_predicted_kg',
                   'combined_demand_kg','effective_daily_demand']]
```

- [ ] **Step 4: Run all demand tests**

```powershell
pytest tests/test_demand_forecast.py -v
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/demand_forecast.py tests/test_demand_forecast.py
git commit -m "feat: frequency demand model and combined signal"
```

---

## Task 7: Supplier scorer (`engine/supplier_scorer.py`)

**Files:** Create `engine/supplier_scorer.py`, `tests/test_supplier_scorer.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_supplier_scorer.py
import pandas as pd
import pytest
from engine.supplier_scorer import score_suppliers

WEIGHTS = {k: 1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']}

def test_higher_die_life_scores_better(die_list, extrusion_data):
    # SUP_A (D001): QtyKgGross=50000; SUP_B (D002): 40000
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=1)
    ranked = result[result['insufficient_history'] == False].sort_values('rank')
    sup_a = ranked[ranked['DescrSupplier'] == 'SUP_A'].iloc[0]
    sup_b = ranked[ranked['DescrSupplier'] == 'SUP_B'].iloc[0]
    assert sup_a['die_life_score'] > sup_b['die_life_score']

def test_lower_failure_scores_better(die_list, extrusion_data):
    # SUP_B (D002): NumDieFailure=0; SUP_A (D001): NumDieFailure=1
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=1)
    ranked = result[result['insufficient_history'] == False]
    sup_a = ranked[ranked['DescrSupplier'] == 'SUP_A'].iloc[0]
    sup_b = ranked[ranked['DescrSupplier'] == 'SUP_B'].iloc[0]
    assert sup_b['failure_score'] > sup_a['failure_score']

def test_min_dies_filter_excludes_suppliers(die_list, extrusion_data):
    # With min_dies=2, both SUP_A and SUP_B each have 1 die for SOLID/200/P25
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=2)
    sufficient = result[result['insufficient_history'] == False]
    assert sufficient.empty

def test_insufficient_history_flag(die_list, extrusion_data):
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=2)
    insufficient = result[result['insufficient_history'] == True]
    assert len(insufficient) == 2  # SUP_A and SUP_B both insufficient

def test_rank_1_has_highest_composite(die_list, extrusion_data):
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=1)
    sufficient = result[result['insufficient_history'] == False].sort_values('rank')
    if len(sufficient) >= 2:
        assert sufficient.iloc[0]['composite_score'] >= sufficient.iloc[1]['composite_score']

def test_scores_normalized_between_0_and_1(die_list, extrusion_data):
    result = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', WEIGHTS, min_dies=1)
    sufficient = result[result['insufficient_history'] == False]
    for col in ['die_life_score','failure_score','trials_score','productivity_score','recovery_score','lead_time_score']:
        assert sufficient[col].between(0.0, 1.0).all(), f"{col} out of [0,1]"

def test_no_matching_dies_returns_empty(die_list, extrusion_data):
    result = score_suppliers(die_list, extrusion_data, 'HOLLOW', 999.0, 'P99', WEIGHTS, min_dies=1)
    assert result.empty
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_supplier_scorer.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `engine/supplier_scorer.py`**

```python
import pandas as pd
import numpy as np


def score_suppliers(die_list: pd.DataFrame, extrusion_data: pd.DataFrame,
                    die_type: str, die_diam: float, press_id: str,
                    weights: dict, min_dies: int = 2) -> pd.DataFrame:
    matching = die_list[
        (die_list['DieType'] == die_type) &
        (die_list['DieDiam'] == die_diam) &
        (die_list['IDPressPrimary'] == press_id) &
        (die_list['DescrSupplier'].notna())
    ].copy()

    if matching.empty:
        return pd.DataFrame()

    # Recovery per die from extrusion data
    ext = extrusion_data[extrusion_data['kgGross'] > 0].copy()
    ext['recovery'] = ext['OperationsProduction::QtyKgGood'] / ext['kgGross']
    recovery_by_die = ext.groupby('IDDie')['recovery'].mean().rename('avg_recovery')
    matching = matching.join(recovery_by_die, on='IDDie', how='left')
    matching['avg_recovery'] = matching['avg_recovery'].fillna(matching['avg_recovery'].mean())

    matching['lead_time_days'] = (matching['DateArrival'] - matching['DateOrder']).dt.days.clip(lower=0)

    grouped = matching.groupby('DescrSupplier').agg(
        num_dies=('IDDie', 'count'),
        die_life=('QtyKgGross', 'mean'),
        failure_ratio=('NumDieFailure', lambda x: x.sum() / max(len(x), 1)),
        avg_trials=('NumDieTrials', 'mean'),
        productivity=('KgHourNetPrimaryPr', 'mean'),
        recovery=('avg_recovery', 'mean'),
        lead_time=('lead_time_days', 'mean'),
    ).reset_index()

    sufficient   = grouped[grouped['num_dies'] >= min_dies].copy()
    insufficient = grouped[grouped['num_dies'] <  min_dies].copy()

    score_cols = ['die_life_score','failure_score','trials_score',
                  'productivity_score','recovery_score','lead_time_score']

    if sufficient.empty:
        insufficient['composite_score'] = None
        insufficient['rank'] = None
        insufficient['insufficient_history'] = True
        for c in score_cols:
            insufficient[c] = None
        return _finalize(insufficient, score_cols)

    def _norm(series, invert=False):
        mn, mx = series.min(), series.max()
        if mx == mn:
            return pd.Series(0.5, index=series.index)
        n = (series - mn) / (mx - mn)
        return 1 - n if invert else n

    sufficient['die_life_score']     = _norm(sufficient['die_life'])
    sufficient['failure_score']      = _norm(sufficient['failure_ratio'], invert=True)
    sufficient['trials_score']       = _norm(sufficient['avg_trials'],    invert=True)
    sufficient['productivity_score'] = _norm(sufficient['productivity'])
    sufficient['recovery_score']     = _norm(sufficient['recovery'])
    sufficient['lead_time_score']    = _norm(sufficient['lead_time'],     invert=True)

    w = weights
    sufficient['composite_score'] = (
        w['die_life']      * sufficient['die_life_score'] +
        w['failure_ratio'] * sufficient['failure_score']  +
        w['trials']        * sufficient['trials_score']   +
        w['productivity']  * sufficient['productivity_score'] +
        w['recovery']      * sufficient['recovery_score'] +
        w['lead_time']     * sufficient['lead_time_score']
    )
    sufficient = sufficient.sort_values('composite_score', ascending=False).reset_index(drop=True)
    sufficient['rank'] = sufficient.index + 1
    sufficient['insufficient_history'] = False

    if not insufficient.empty:
        insufficient['composite_score'] = None
        insufficient['rank'] = None
        insufficient['insufficient_history'] = True
        for c in score_cols:
            insufficient[c] = None

    return _finalize(pd.concat([sufficient, insufficient], ignore_index=True), score_cols)


def _finalize(df: pd.DataFrame, score_cols: list) -> pd.DataFrame:
    cols = ['DescrSupplier','composite_score','rank','num_dies','insufficient_history',
            'die_life','failure_ratio','avg_trials','productivity','recovery','lead_time'] + score_cols
    return df[[c for c in cols if c in df.columns]]
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_supplier_scorer.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/supplier_scorer.py tests/test_supplier_scorer.py
git commit -m "feat: supplier scorer with 6-criterion min-max ranking"
```

---

## Task 8: Alert engine (`engine/alert_engine.py`)

**Files:** Create `engine/alert_engine.py`, `tests/test_alert_engine.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_alert_engine.py
import pandas as pd
import pytest
from engine.alert_engine import compute_alerts, ALERT_RED, ALERT_AMBER, ALERT_GREEN

WEIGHTS = {k: 1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']}

def _run(die_list, extrusion_data, order_booking, today):
    return compute_alerts(
        die_list, extrusion_data, order_booking,
        weights=WEIGHTS, safety_factor=1.5, min_supplier_dies=1,
        min_orders_for_frequency=3, recent_weight_months=6,
        today=today.date()
    )

def test_red_alert_when_stock_below_lead_time(die_list, extrusion_data, today):
    # D001 remaining=2500kg, avg_daily~55kg/day → ~45 days stock
    # Lead time SUP_A: (2024-03-15 - 2024-01-01) = 74 days
    # 45 < 74 → RED
    result = _run(die_list, extrusion_data, pd.DataFrame(columns=['IDProfile','QtyKg','DateDelivery','DateRevisedDelivery','OrderLineStatus','TimeStampCreation']), today)
    d001 = result[result['IDDie'] == 'D001'].iloc[0]
    assert d001['alert_level'] == ALERT_RED

def test_alert_output_sorted_red_first(die_list, extrusion_data, order_booking, today):
    result = _run(die_list, extrusion_data, order_booking, today)
    levels = result['alert_level'].tolist()
    order = {ALERT_RED: 0, ALERT_AMBER: 1, ALERT_GREEN: 2}
    assert levels == sorted(levels, key=lambda x: order[x])

def test_result_has_required_columns(die_list, extrusion_data, order_booking, today):
    result = _run(die_list, extrusion_data, order_booking, today)
    for col in ['IDDie','IDProfile','remaining_kg','days_of_stock','lead_time_days',
                'alert_level','recommended_supplier','effective_daily_demand']:
        assert col in result.columns

def test_scrapped_die_not_in_alerts(die_list_with_scrapped, extrusion_data, order_booking, today):
    result = _run(die_list_with_scrapped, extrusion_data, order_booking, today)
    assert 'D004' not in result['IDDie'].values

def test_recommended_supplier_is_string_or_none(die_list, extrusion_data, order_booking, today):
    result = _run(die_list, extrusion_data, order_booking, today)
    for val in result['recommended_supplier']:
        assert val is None or isinstance(val, str)

def test_lead_time_fallback_to_median_when_no_scoring(today):
    # Single die, single supplier with 1 die (below min_supplier_dies=2)
    # Should fall back through chain to die's own supplier, then median
    die_list = pd.DataFrame({
        'IDDie': ['D001'], 'IDProfile': ['P001'],
        'DescrSupplier': ['SUP_A'], 'IDPressPrimary': ['P25'],
        'DieType': ['SOLID'], 'DieDiam': [200.0], 'NumCavities': [1],
        'QtyKgGross': [50000.0], 'CapacityLastNitKg': [10000.0],
        'NumDieLoadings': [1], 'NumDieTrials': [2], 'NumDieFailure': [0],
        'NumCorrections': [0], 'KgHourNetPrimaryPr': [500.0],
        'DateOrder':   pd.to_datetime(['2024-01-01']),
        'DateArrival': pd.to_datetime(['2024-03-15']),  # lead = 74 days
        'DateLastNitr': pd.to_datetime(['2026-01-01']),
        'DateScrapped': [None],
    })
    ext = pd.DataFrame(columns=['IDDie','IDPress','DateShift','kgGross','kgNet',
                                  'OperationsProduction::QtyKgGood','KgNetHour','NumBillets'])
    orders = pd.DataFrame(columns=['IDProfile','QtyKg','DateDelivery','DateRevisedDelivery',
                                    'OrderLineStatus','TimeStampCreation'])
    result = compute_alerts(die_list, ext, orders, weights={k:1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']},
                             safety_factor=1.5, min_supplier_dies=2, today=today.date())
    assert result.iloc[0]['lead_time_days'] == pytest.approx(74.0, rel=0.05)
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_alert_engine.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `engine/alert_engine.py`**

```python
import pandas as pd
import numpy as np
from datetime import date as date_type
from engine import die_life as dl
from engine import demand_forecast as df_mod
from engine import supplier_scorer as ss

ALERT_RED   = 'RED'
ALERT_AMBER = 'AMBER'
ALERT_GREEN = 'GREEN'


def _lead_time_for_die(die_row: pd.Series, supplier_scores: pd.DataFrame,
                        supplier_avg_lead: pd.Series) -> float:
    # 1. Top-ranked supplier lead time
    if not supplier_scores.empty:
        top = supplier_scores[supplier_scores['rank'] == 1]
        if not top.empty and pd.notna(top.iloc[0].get('lead_time')):
            return float(top.iloc[0]['lead_time'])

    # 2. Die's recorded supplier
    supplier = die_row.get('DescrSupplier')
    if supplier and supplier in supplier_avg_lead.index:
        val = supplier_avg_lead[supplier]
        if pd.notna(val):
            return float(val)

    # 3. Median across all
    median = supplier_avg_lead.median()
    return float(median) if pd.notna(median) else 60.0


def compute_alerts(die_list: pd.DataFrame, extrusion_data: pd.DataFrame,
                   order_booking: pd.DataFrame, weights: dict,
                   safety_factor: float = 1.5, min_supplier_dies: int = 2,
                   min_orders_for_frequency: int = 3, recent_weight_months: int = 6,
                   today: date_type = None) -> pd.DataFrame:

    today_ts = pd.Timestamp(today or date_type.today())

    # Die life
    life_df = dl.compute_die_life(die_list, extrusion_data, today, recent_weight_months)

    # Supplier lead times (all, for fallback)
    lead_df = die_list.copy()
    lead_df['_lead'] = (lead_df['DateArrival'] - lead_df['DateOrder']).dt.days.clip(lower=0)
    supplier_avg_lead = lead_df.groupby('DescrSupplier')['_lead'].mean()
    median_lead = float(supplier_avg_lead.median()) if not supplier_avg_lead.empty else 60.0
    horizon_days = int(median_lead * safety_factor)

    # Demand
    confirmed = df_mod.compute_confirmed_demand(order_booking, die_list, horizon_days, today)
    frequency = df_mod.compute_frequency_demand(order_booking, die_list, horizon_days,
                                                 min_orders_for_frequency, today)
    combined  = df_mod.compute_combined_demand(confirmed, frequency, horizon_days)

    rows = []
    for _, life_row in life_df.iterrows():
        die_id  = life_row['IDDie']
        profile = life_row['IDProfile']

        dem_row = combined[combined['IDDie'] == die_id]
        eff_daily_demand = float(dem_row['effective_daily_demand'].iloc[0]) if not dem_row.empty else 0.0
        combined_kg      = float(dem_row['combined_demand_kg'].iloc[0])      if not dem_row.empty else 0.0

        # Effective rate = max(consumption, demand)
        eff_daily = max(life_row['avg_daily_consumption'], eff_daily_demand)

        die_info = die_list[die_list['IDDie'] == die_id].iloc[0]
        scores   = ss.score_suppliers(
            die_list, extrusion_data,
            die_info.get('DieType'), die_info.get('DieDiam'), die_info.get('IDPressPrimary'),
            weights, min_supplier_dies
        )

        lead_time = _lead_time_for_die(die_info, scores, supplier_avg_lead)

        days_stock = life_row['remaining_kg'] / eff_daily if eff_daily > 0 else float('inf')

        if days_stock < lead_time:
            level = ALERT_RED
        elif days_stock < lead_time * safety_factor:
            level = ALERT_AMBER
        else:
            level = ALERT_GREEN

        top_supplier = None
        if not scores.empty:
            top = scores[scores['rank'] == 1]
            if not top.empty:
                top_supplier = str(top.iloc[0]['DescrSupplier'])

        rows.append({
            'IDDie': die_id, 'IDProfile': profile,
            'remaining_kg': life_row['remaining_kg'],
            'avg_daily_consumption': life_row['avg_daily_consumption'],
            'combined_demand_kg': combined_kg,
            'effective_daily_demand': eff_daily,
            'days_of_stock': days_stock,
            'lead_time_days': lead_time,
            'alert_level': level,
            'recommended_supplier': top_supplier,
        })

    if not rows:
        return pd.DataFrame(columns=['IDDie','IDProfile','remaining_kg','avg_daily_consumption',
                                      'combined_demand_kg','effective_daily_demand','days_of_stock',
                                      'lead_time_days','alert_level','recommended_supplier'])

    result = pd.DataFrame(rows)
    _order = {ALERT_RED: 0, ALERT_AMBER: 1, ALERT_GREEN: 2}
    result['_sort'] = result['alert_level'].map(_order)
    result = result.sort_values(['_sort','days_of_stock']).drop(columns='_sort').reset_index(drop=True)
    return result
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_alert_engine.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```powershell
git add engine/alert_engine.py tests/test_alert_engine.py
git commit -m "feat: alert engine with RED/AMBER/GREEN thresholds and lead-time fallback"
```

---

## Task 9: Accuracy metrics (`testing/metrics.py`)

**Files:** Create `testing/metrics.py`, `tests/test_metrics.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_metrics.py
import pytest
from testing.metrics import true_positive_rate, false_positive_rate, median_alert_lead, supplier_rank_match

def test_tpr_all_correct():
    # 3 crises, all had alert before lead time
    events = [
        {'alert_lead_days': 20, 'lead_time_days': 15},
        {'alert_lead_days': 10, 'lead_time_days': 8},
        {'alert_lead_days': 30, 'lead_time_days': 25},
    ]
    assert true_positive_rate(events) == pytest.approx(1.0)

def test_tpr_partial():
    events = [
        {'alert_lead_days': 20, 'lead_time_days': 15},  # TP: 20 >= 15
        {'alert_lead_days': 5,  'lead_time_days': 15},  # FN: 5 < 15
        {'alert_lead_days': None, 'lead_time_days': 15}, # FN: no alert
    ]
    assert true_positive_rate(events) == pytest.approx(1/3)

def test_fpr_calculation():
    # 5 RED alerts; 2 had >2× lead time remaining (false alarms)
    alerts = [
        {'days_of_stock_at_alert': 200, 'lead_time_days': 60},  # FP: 200 > 120
        {'days_of_stock_at_alert': 50,  'lead_time_days': 60},  # TP
        {'days_of_stock_at_alert': 150, 'lead_time_days': 60},  # FP: 150 > 120
        {'days_of_stock_at_alert': 30,  'lead_time_days': 60},  # TP
        {'days_of_stock_at_alert': 10,  'lead_time_days': 60},  # TP
    ]
    assert false_positive_rate(alerts) == pytest.approx(2/5)

def test_median_alert_lead():
    leads = [10, 20, 30]
    assert median_alert_lead(leads) == pytest.approx(20.0)

def test_median_alert_lead_empty():
    assert median_alert_lead([]) == 0.0

def test_supplier_rank_match_all_match():
    comparisons = [
        {'top_ranked': 'A', 'chosen': 'A'},
        {'top_ranked': 'B', 'chosen': 'B'},
    ]
    assert supplier_rank_match(comparisons) == pytest.approx(1.0)

def test_supplier_rank_match_partial():
    comparisons = [
        {'top_ranked': 'A', 'chosen': 'A'},
        {'top_ranked': 'A', 'chosen': 'B'},
        {'top_ranked': 'C', 'chosen': 'C'},
        {'top_ranked': 'A', 'chosen': 'B'},
    ]
    assert supplier_rank_match(comparisons) == pytest.approx(0.5)
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_metrics.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `testing/metrics.py`**

```python
import numpy as np
from typing import Optional


def true_positive_rate(events: list[dict]) -> float:
    """
    events: list of {'alert_lead_days': int|None, 'lead_time_days': int}
    TP = alert fired and alert_lead_days >= lead_time_days
    """
    if not events:
        return 0.0
    tp = sum(
        1 for e in events
        if e.get('alert_lead_days') is not None and e['alert_lead_days'] >= e['lead_time_days']
    )
    return tp / len(events)


def false_positive_rate(alerts: list[dict]) -> float:
    """
    alerts: list of {'days_of_stock_at_alert': float, 'lead_time_days': float}
    FP = RED alert but die had >2× lead time remaining
    """
    if not alerts:
        return 0.0
    fp = sum(
        1 for a in alerts
        if a['days_of_stock_at_alert'] > 2 * a['lead_time_days']
    )
    return fp / len(alerts)


def median_alert_lead(lead_days: list[float]) -> float:
    """Median days between RED alert and actual crisis across true positives."""
    if not lead_days:
        return 0.0
    return float(np.median(lead_days))


def supplier_rank_match(comparisons: list[dict]) -> float:
    """
    comparisons: list of {'top_ranked': str, 'chosen': str}
    Returns fraction where model's top-ranked supplier matches the historically chosen one.
    """
    if not comparisons:
        return 0.0
    matches = sum(1 for c in comparisons if c['top_ranked'] == c['chosen'])
    return matches / len(comparisons)
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_metrics.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add testing/metrics.py tests/test_metrics.py
git commit -m "feat: accuracy metrics (TPR, FPR, median lead, rank match)"
```

---

## Task 10: Back-tester (`testing/backtester.py`)

**Files:** Create `testing/backtester.py`, `tests/test_backtester.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_backtester.py
import pandas as pd
import pytest
from testing.backtester import run_backtest

WEIGHTS = {k: 1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']}

@pytest.fixture
def die_list_for_backtest():
    # D001: DateScrapped set — valid backtest target
    # D002: no DateScrapped — excluded
    return pd.DataFrame({
        'IDDie': ['D001', 'D002'],
        'IDProfile': ['P001', 'P002'],
        'DescrSupplier': ['SUP_A', 'SUP_B'],
        'IDPressPrimary': ['P25', 'P25'],
        'DieType': ['SOLID', 'SOLID'],
        'DieDiam': [200.0, 200.0],
        'NumCavities': [1, 1],
        'QtyKgGross': [50000.0, 40000.0],
        'CapacityLastNitKg': [3000.0, 8000.0],  # low capacity → RED alert expected
        'NumDieLoadings': [100, 80],
        'NumDieTrials': [2, 3],
        'NumDieFailure': [0, 0],
        'NumCorrections': [1, 1],
        'KgHourNetPrimaryPr': [500.0, 450.0],
        'DateOrder':   pd.to_datetime(['2023-01-01', '2023-03-01']),
        'DateArrival': pd.to_datetime(['2023-03-01', '2023-05-01']),  # 59, 61 day lead
        'DateLastNitr':pd.to_datetime(['2025-10-01', '2026-01-01']),
        'DateScrapped':pd.to_datetime(['2026-04-01', None]),
    })

@pytest.fixture
def extrusion_for_backtest():
    # D001: consumed steadily so capacity runs out before DateScrapped
    dates = pd.date_range('2025-10-01', periods=12, freq='2W')
    return pd.DataFrame({
        'IDDie': ['D001'] * 12,
        'IDPress': ['P25'] * 12,
        'DateShift': dates,
        'kgGross': [250.0] * 12,  # 3000 total = exactly CapacityLastNitKg
        'kgNet': [225.0] * 12,
        'OperationsProduction::QtyKgGood': [215.0] * 12,
        'KgNetHour': [450.0] * 12,
        'NumBillets': [25] * 12,
    })

def test_backtest_only_uses_scrapped_dies(die_list_for_backtest, extrusion_for_backtest):
    empty_orders = pd.DataFrame(columns=['IDProfile','QtyKg','DateDelivery',
                                          'DateRevisedDelivery','OrderLineStatus','TimeStampCreation'])
    result = run_backtest(die_list_for_backtest, extrusion_for_backtest, empty_orders,
                          weights=WEIGHTS, safety_factor=1.5, min_supplier_dies=1)
    # Only D001 has DateScrapped
    assert all(result['IDDie'] == 'D001')

def test_backtest_returns_required_columns(die_list_for_backtest, extrusion_for_backtest):
    empty_orders = pd.DataFrame(columns=['IDProfile','QtyKg','DateDelivery',
                                          'DateRevisedDelivery','OrderLineStatus','TimeStampCreation'])
    result = run_backtest(die_list_for_backtest, extrusion_for_backtest, empty_orders,
                          weights=WEIGHTS, safety_factor=1.5, min_supplier_dies=1)
    for col in ['IDDie','crisis_date','first_red_alert_date','alert_lead_days','lead_time_days']:
        assert col in result.columns

def test_backtest_detects_red_alert_before_crisis(die_list_for_backtest, extrusion_for_backtest):
    empty_orders = pd.DataFrame(columns=['IDProfile','QtyKg','DateDelivery',
                                          'DateRevisedDelivery','OrderLineStatus','TimeStampCreation'])
    result = run_backtest(die_list_for_backtest, extrusion_for_backtest, empty_orders,
                          weights=WEIGHTS, safety_factor=1.5, min_supplier_dies=1)
    d001 = result[result['IDDie'] == 'D001']
    if not d001.empty and d001.iloc[0]['first_red_alert_date'] is not None:
        assert d001.iloc[0]['first_red_alert_date'] < d001.iloc[0]['crisis_date']
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_backtester.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `testing/backtester.py`**

```python
import pandas as pd
import numpy as np
from datetime import timedelta
from engine.alert_engine import compute_alerts, ALERT_RED


def run_backtest(die_list: pd.DataFrame, extrusion_data: pd.DataFrame,
                 order_booking: pd.DataFrame, weights: dict,
                 safety_factor: float = 1.5, min_supplier_dies: int = 2,
                 replay_weeks: int = 26) -> pd.DataFrame:
    """
    For each die with DateScrapped, simulate the model weekly for the
    preceding `replay_weeks` weeks and record when RED first fired.
    """
    candidates = die_list[die_list['DateScrapped'].notna()].copy()
    rows = []

    for _, die in candidates.iterrows():
        die_id = die['IDDie']
        crisis_date = pd.Timestamp(die['DateScrapped'])

        first_red_date = None
        for week in range(replay_weeks, 0, -1):
            sim_date = crisis_date - timedelta(weeks=week)

            # Mask: treat die as not yet scrapped at sim_date
            sim_die_list = die_list.copy()
            sim_die_list.loc[sim_die_list['IDDie'] == die_id, 'DateScrapped'] = None
            # Exclude extrusion runs after sim_date
            sim_ext = extrusion_data[extrusion_data['DateShift'] <= sim_date].copy()
            sim_orders = order_booking[order_booking['TimeStampCreation'] <= sim_date].copy()

            try:
                alerts = compute_alerts(
                    sim_die_list, sim_ext, sim_orders, weights,
                    safety_factor=safety_factor, min_supplier_dies=min_supplier_dies,
                    today=sim_date.date()
                )
                die_alert = alerts[alerts['IDDie'] == die_id]
                if not die_alert.empty and die_alert.iloc[0]['alert_level'] == ALERT_RED:
                    first_red_date = sim_date
            except Exception:
                pass  # insufficient data at early sim dates — skip

        lead_row = die_list[die_list['IDDie'] == die_id]
        lead_time = None
        if not lead_row.empty:
            lt = (lead_row.iloc[0]['DateArrival'] - lead_row.iloc[0]['DateOrder'])
            if pd.notna(lt):
                lead_time = int(lt.days)

        alert_lead = int((crisis_date - first_red_date).days) if first_red_date else None

        rows.append({
            'IDDie': die_id,
            'crisis_date': crisis_date,
            'first_red_alert_date': first_red_date,
            'alert_lead_days': alert_lead,
            'lead_time_days': lead_time,
        })

    return pd.DataFrame(rows)
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_backtester.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```powershell
git add testing/backtester.py tests/test_backtester.py
git commit -m "feat: historical back-tester with weekly replay"
```

---

## Task 11: Named scenarios (`testing/scenarios.py`)

**Files:** Create `testing/scenarios.py`, `tests/test_scenarios.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_scenarios.py
import pandas as pd
import pytest
from testing.scenarios import (
    scenario_high_demand, scenario_low_demand, scenario_frequency_overrides_confirmed,
    scenario_slow_supplier, scenario_high_failure_die, scenario_cold_start,
    scenario_multi_die_same_profile,
)
from engine.alert_engine import ALERT_RED, ALERT_AMBER, ALERT_GREEN

WEIGHTS = {k: 1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']}
TODAY = pd.Timestamp("2026-05-28")

def test_high_demand_alerts_earlier(die_list, extrusion_data, order_booking):
    base, spiked = scenario_high_demand(die_list, extrusion_data, order_booking, WEIGHTS, TODAY.date())
    base_stock  = base[base['IDDie'] == 'D001']['days_of_stock'].iloc[0]
    spike_stock = spiked[spiked['IDDie'] == 'D001']['days_of_stock'].iloc[0]
    assert spike_stock <= base_stock

def test_low_demand_has_higher_stock_days(die_list, extrusion_data, order_booking):
    base, relaxed = scenario_low_demand(die_list, extrusion_data, order_booking, WEIGHTS, TODAY.date())
    base_stock    = base[base['IDDie'] == 'D001']['days_of_stock'].iloc[0]
    relaxed_stock = relaxed[relaxed['IDDie'] == 'D001']['days_of_stock'].iloc[0]
    assert relaxed_stock >= base_stock

def test_frequency_overrides_fires_alert(die_list, extrusion_data):
    result = scenario_frequency_overrides_confirmed(die_list, extrusion_data, WEIGHTS, TODAY.date())
    target = result[result['IDDie'] == 'D001']
    assert not target.empty
    assert target.iloc[0]['alert_level'] in [ALERT_RED, ALERT_AMBER]

def test_slow_supplier_has_larger_lead_time(die_list, extrusion_data, order_booking):
    base, slow = scenario_slow_supplier(die_list, extrusion_data, order_booking, WEIGHTS, TODAY.date())
    base_lead = base[base['IDDie'] == 'D001']['lead_time_days'].iloc[0]
    slow_lead = slow[slow['IDDie'] == 'D001']['lead_time_days'].iloc[0]
    assert slow_lead > base_lead

def test_high_failure_supplier_ranks_lower(die_list, extrusion_data):
    normal_score, penalized_score = scenario_high_failure_die(die_list, extrusion_data)
    assert penalized_score <= normal_score

def test_cold_start_uses_confirmed_only(die_list, extrusion_data):
    result = scenario_cold_start(die_list, extrusion_data, WEIGHTS, TODAY.date())
    assert not result.empty

def test_multi_die_alerts_on_lower_stock(die_list, extrusion_data, order_booking):
    result = scenario_multi_die_same_profile(die_list, extrusion_data, order_booking, WEIGHTS, TODAY.date())
    profile_alerts = result[result['IDProfile'] == 'P001']
    if len(profile_alerts) >= 2:
        levels = profile_alerts['alert_level'].tolist()
        assert levels[0] in [ALERT_RED, ALERT_AMBER]
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_scenarios.py -v
```

Expected: `ImportError`.

- [ ] **Step 3: Write `testing/scenarios.py`**

```python
import pandas as pd
import numpy as np
from datetime import date as date_type
from engine.alert_engine import compute_alerts
from engine.supplier_scorer import score_suppliers


def _run(die_list, ext, orders, weights, today):
    return compute_alerts(die_list, ext, orders, weights,
                           safety_factor=1.5, min_supplier_dies=1,
                           min_orders_for_frequency=3, today=today)


def scenario_high_demand(die_list, extrusion_data, order_booking, weights, today):
    """Inject 3× order quantity for P001. Alert should be stricter (lower days_of_stock)."""
    base   = _run(die_list, extrusion_data, order_booking, weights, today)
    spiked = order_booking.copy()
    spiked.loc[spiked['IDProfile'] == 'P001', 'QtyKg'] *= 3
    result = _run(die_list, extrusion_data, spiked, weights, today)
    return base, result


def scenario_low_demand(die_list, extrusion_data, order_booking, weights, today):
    """Remove all orders and set last order far in the past → frequency predicts nothing soon."""
    base    = _run(die_list, extrusion_data, order_booking, weights, today)
    empty   = order_booking.copy()
    empty['OrderLineStatus'] = 'CLOSED'
    empty['TimeStampCreation'] = pd.Timestamp('2020-01-01')
    result  = _run(die_list, extrusion_data, empty, weights, today)
    return base, result


def scenario_frequency_overrides_confirmed(die_list, extrusion_data, weights, today):
    """No confirmed open orders; inject 5 regular historical orders so frequency model is active."""
    today_ts = pd.Timestamp(today)
    orders = pd.DataFrame({
        'IDProfile': ['P001'] * 5,
        'QtyKg': [5000.0] * 5,
        'DateDelivery': pd.date_range(end=today_ts - pd.Timedelta(days=10), periods=5, freq='45D'),
        'DateRevisedDelivery': [None] * 5,
        'OrderLineStatus': ['CLOSED'] * 5,
        'TimeStampCreation': pd.date_range(end=today_ts - pd.Timedelta(days=10), periods=5, freq='45D'),
    })
    return _run(die_list, extrusion_data, orders, weights, today)


def scenario_slow_supplier(die_list, extrusion_data, order_booking, weights, today):
    """Extend DateArrival for D001's supplier to 120-day lead time."""
    base   = _run(die_list, extrusion_data, order_booking, weights, today)
    slow   = die_list.copy()
    slow.loc[slow['IDDie'] == 'D001', 'DateArrival'] = (
        slow.loc[slow['IDDie'] == 'D001', 'DateOrder'] + pd.Timedelta(days=120)
    )
    result = _run(slow, extrusion_data, order_booking, weights, today)
    return base, result


def scenario_high_failure_die(die_list, extrusion_data):
    """Compare supplier scores before/after inflating NumDieFailure."""
    weights = {k: 1/6 for k in ['die_life','failure_ratio','trials','productivity','recovery','lead_time']}
    normal   = score_suppliers(die_list, extrusion_data, 'SOLID', 200.0, 'P25', weights, min_dies=1)
    penalized = die_list.copy()
    penalized.loc[penalized['DescrSupplier'] == 'SUP_A', 'NumDieFailure'] = 50
    pen_scores = score_suppliers(penalized, extrusion_data, 'SOLID', 200.0, 'P25', weights, min_dies=1)

    def _top_score(df):
        s = df[df['insufficient_history'] == False]
        return float(s[s['DescrSupplier'] == 'SUP_A']['composite_score'].iloc[0]) if not s.empty else 0.0

    return _top_score(normal), _top_score(pen_scores)


def scenario_cold_start(die_list, extrusion_data, weights, today):
    """Profile with only 1 historical order — frequency model stays inactive."""
    orders = pd.DataFrame({
        'IDProfile': ['P001'],
        'QtyKg': [5000.0],
        'DateDelivery': pd.to_datetime(['2026-07-01']),
        'DateRevisedDelivery': [None],
        'OrderLineStatus': ['OPEN'],
        'TimeStampCreation': pd.to_datetime(['2026-05-01']),
    })
    return _run(die_list, extrusion_data, orders, weights, today)


def scenario_multi_die_same_profile(die_list, extrusion_data, order_booking, weights, today):
    """Two active dies on P001; one has much lower remaining life."""
    modified = die_list.copy()
    # Give D001 very low capacity (will alert), D002 high capacity (safe)
    modified.loc[modified['IDDie'] == 'D001', 'CapacityLastNitKg'] = 500.0
    modified.loc[modified['IDDie'] == 'D002', 'CapacityLastNitKg'] = 50000.0
    return _run(modified, extrusion_data, order_booking, weights, today)
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_scenarios.py -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```powershell
git add testing/scenarios.py tests/test_scenarios.py
git commit -m "feat: 7 named scenario functions for model validation"
```

---

## Task 12: CLI and report output (`main.py`)

**Files:** Create `main.py`, `tests/test_main.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_main.py
import subprocess
import sys
import pytest

PYTHON = sys.executable

def test_main_help_exits_cleanly():
    result = subprocess.run([PYTHON, 'main.py', '--help'], capture_output=True, text=True,
                             cwd=r'C:\Users\vijee\Desktop\19.05.2026\backup_die_model')
    assert result.returncode == 0
    assert 'alerts' in result.stdout

def test_main_unknown_command_exits_nonzero():
    result = subprocess.run([PYTHON, 'main.py', 'notacommand'], capture_output=True, text=True,
                             cwd=r'C:\Users\vijee\Desktop\19.05.2026\backup_die_model')
    assert result.returncode != 0
```

- [ ] **Step 2: Run to confirm failure**

```powershell
pytest tests/test_main.py -v
```

Expected: assertion error (main.py does not exist).

- [ ] **Step 3: Write `main.py`**

```python
import argparse
import sys
import pandas as pd
from pathlib import Path
from tabulate import tabulate
from datetime import date

import config
from engine.data_loader import load_all
from engine.alert_engine import compute_alerts
from engine.supplier_scorer import score_suppliers
from testing.backtester import run_backtest
from testing.metrics import true_positive_rate, false_positive_rate, median_alert_lead, supplier_rank_match
from testing import scenarios as sc


def _load():
    return load_all(config.DATA_DIR)


def cmd_alerts(args):
    data = _load()
    result = compute_alerts(
        data['die_list'], data['extrusion'], data['order_booking'],
        weights=config.SUPPLIER_WEIGHTS,
        safety_factor=config.SAFETY_FACTOR,
        min_supplier_dies=config.MIN_SUPPLIER_DIES,
        min_orders_for_frequency=config.MIN_ORDERS_FOR_FREQUENCY,
        recent_weight_months=config.RECENT_WEIGHT_MONTHS,
    )
    if args.press:
        die_list = data['die_list']
        press_dies = die_list[die_list['IDPressPrimary'] == args.press]['IDDie']
        result = result[result['IDDie'].isin(press_dies)]

    display = result[['IDDie','IDProfile','remaining_kg','days_of_stock','lead_time_days',
                       'alert_level','recommended_supplier']].copy()
    display['days_of_stock'] = display['days_of_stock'].apply(lambda x: f"{x:.0f}" if x != float('inf') else "∞")
    print(tabulate(display, headers='keys', tablefmt='rounded_outline', showindex=False))

    out = Path('reports') / f"alerts_{date.today()}.xlsx"
    result.to_excel(out, index=False, engine='xlsxwriter')
    print(f"\nReport saved to {out}")


def cmd_score(args):
    data = _load()
    die_row = data['die_list'][data['die_list']['IDDie'] == args.die]
    if die_row.empty:
        print(f"Die {args.die} not found.")
        sys.exit(1)
    d = die_row.iloc[0]
    scores = score_suppliers(
        data['die_list'], data['extrusion'],
        d['DieType'], d['DieDiam'], d['IDPressPrimary'],
        config.SUPPLIER_WEIGHTS, config.MIN_SUPPLIER_DIES
    )
    if scores.empty:
        print("No matching suppliers found.")
        return
    display = scores[['DescrSupplier','rank','composite_score','die_life_score',
                       'failure_score','trials_score','productivity_score',
                       'recovery_score','lead_time_score','insufficient_history']]
    print(tabulate(display, headers='keys', tablefmt='rounded_outline', showindex=False))


def cmd_backtest(_args):
    data = _load()
    print("Running back-test (this may take a few minutes)...")
    bt = run_backtest(
        data['die_list'], data['extrusion'], data['order_booking'],
        weights=config.SUPPLIER_WEIGHTS,
        safety_factor=config.SAFETY_FACTOR,
        min_supplier_dies=config.MIN_SUPPLIER_DIES,
    )
    events = bt[['alert_lead_days','lead_time_days']].to_dict('records')
    alerts = bt.apply(lambda r: {'days_of_stock_at_alert': r['alert_lead_days'] or 0,
                                   'lead_time_days': r['lead_time_days'] or 60}, axis=1).tolist()
    leads  = [r['alert_lead_days'] for r in events if r['alert_lead_days'] is not None]

    print(f"\nTPR:               {true_positive_rate(events):.1%}")
    print(f"FPR:               {false_positive_rate(alerts):.1%}")
    print(f"Median alert lead: {median_alert_lead(leads):.0f} days")

    out = Path('reports') / f"backtest_{date.today()}.xlsx"
    bt.to_excel(out, index=False, engine='xlsxwriter')
    print(f"Report saved to {out}")


def cmd_scenario(args):
    data = _load()
    w = config.SUPPLIER_WEIGHTS
    today = date.today()
    name = args.name

    scenario_map = {
        'high_demand':                 lambda: sc.scenario_high_demand(data['die_list'], data['extrusion'], data['order_booking'], w, today),
        'low_demand':                  lambda: sc.scenario_low_demand(data['die_list'], data['extrusion'], data['order_booking'], w, today),
        'frequency_overrides_confirmed': lambda: sc.scenario_frequency_overrides_confirmed(data['die_list'], data['extrusion'], w, today),
        'slow_supplier':               lambda: sc.scenario_slow_supplier(data['die_list'], data['extrusion'], data['order_booking'], w, today),
        'high_failure_die':            lambda: sc.scenario_high_failure_die(data['die_list'], data['extrusion']),
        'cold_start':                  lambda: sc.scenario_cold_start(data['die_list'], data['extrusion'], w, today),
        'multi_die_same_profile':      lambda: sc.scenario_multi_die_same_profile(data['die_list'], data['extrusion'], data['order_booking'], w, today),
    }

    names_to_run = list(scenario_map.keys()) if name == 'all' else [name]
    for n in names_to_run:
        if n not in scenario_map:
            print(f"Unknown scenario: {n}")
            continue
        print(f"\n=== Scenario: {n} ===")
        result = scenario_map[n]()
        if isinstance(result, tuple):
            base, modified = result
            print("BASE:")
            _print_alerts(base)
            print("MODIFIED:")
            _print_alerts(modified)
        elif isinstance(result, pd.DataFrame):
            _print_alerts(result)
        else:
            print(f"Result: {result}")


def _print_alerts(df):
    if df.empty:
        print("  (no results)")
        return
    cols = [c for c in ['IDDie','IDProfile','days_of_stock','alert_level','recommended_supplier'] if c in df.columns]
    print(tabulate(df[cols], headers='keys', tablefmt='simple', showindex=False))


def main():
    parser = argparse.ArgumentParser(description='Backup Die Ordering Model')
    sub = parser.add_subparsers(dest='command')
    sub.required = True

    p_alerts = sub.add_parser('alerts', help='Show current alert table')
    p_alerts.add_argument('--press', help='Filter by press ID (e.g. P25)')
    p_alerts.set_defaults(func=cmd_alerts)

    p_score = sub.add_parser('score', help='Show supplier scorecard for a die')
    p_score.add_argument('--die', required=True, help='Die ID')
    p_score.set_defaults(func=cmd_score)

    p_bt = sub.add_parser('backtest', help='Run historical back-test')
    p_bt.set_defaults(func=cmd_backtest)

    p_sc = sub.add_parser('scenario', help='Run named scenario')
    p_sc.add_argument('name', help='Scenario name or "all"')
    p_sc.set_defaults(func=cmd_scenario)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
```

- [ ] **Step 4: Run tests**

```powershell
pytest tests/test_main.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Run full test suite**

```powershell
pytest tests/ -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```powershell
git add main.py tests/test_main.py
git commit -m "feat: CLI with alerts, score, backtest, scenario commands"
```

---

## Task 13: End-to-end smoke test with real data

Run the model against the actual Excel files and verify it produces sensible output without errors.

- [ ] **Step 1: Verify `config.py` DATA_DIR is correct**

```python
# config.py — confirm this line points to your Excel files:
DATA_DIR = r"C:\Users\vijee\Desktop\19.05.2026\Data\Data"
```

- [ ] **Step 2: Run alerts command**

```powershell
cd C:\Users\vijee\Desktop\19.05.2026\backup_die_model
python main.py alerts
```

Expected: a formatted table with columns IDDie, IDProfile, remaining_kg, days_of_stock, lead_time_days, alert_level, recommended_supplier. Report saved to `reports/alerts_<date>.xlsx`.

- [ ] **Step 3: Run score for a known die ID**

Replace `<REAL_DIE_ID>` with an IDDie value from your die list.

```powershell
python main.py score --die <REAL_DIE_ID>
```

Expected: supplier scorecard table.

- [ ] **Step 4: Run a single scenario**

```powershell
python main.py scenario high_demand
```

Expected: two tables (BASE and MODIFIED) showing days_of_stock is lower under high demand.

- [ ] **Step 5: Run all scenarios**

```powershell
python main.py scenario all
```

Expected: all 7 scenarios print without Python exceptions.

- [ ] **Step 6: Final commit**

```powershell
git add -A
git commit -m "chore: verified end-to-end with real data"
```

---

## Success Criteria Checklist

Before calling Phase 1 complete, run the back-test against real data and verify:

```powershell
python main.py backtest
```

| Criterion | Target | Pass? |
|---|---|---|
| True Positive Rate | ≥ 80% | |
| False Positive Rate | ≤ 20% | |
| Median alert lead | ≥ 7 days ahead of lead time | |
| All 7 scenarios run without error | — | |

If TPR or FPR miss the target, adjust `SAFETY_FACTOR`, `RECENT_WEIGHT_MONTHS`, or `SUPPLIER_WEIGHTS` in `config.py` and re-run — no engine code changes needed.
