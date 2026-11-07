# Tooling master import — runbook

Loads the die shop's tooling data into three tables: the press combination chart
(`tooling_combinations`), the insert and bolster inventory (`toolings`), and the
links from existing dies to their toolings (`die_tooling_links`).

Run the three scripts in this order: **chart, inventory, backfill**. The backfill
needs the inventory loaded first, because it matches die-list values against the
toolings the master knows.

Every script has a `--dry-run`. Always do one first and read it. Production runs
are done by the user after reviewing a dry run; the local Docker stack is a test
server.

---

## Source workbooks

All under `C:\Users\vijee\Desktop\18.06.2026\New folder\14.Die Toolings\`:

| Used by | File |
|---|---|
| chart | `Tooling stack combination for all Presses-Updated_16_April_2014.xlsx` |
| inventory `--gex2` | `Tooling Inventory-2025.xlsx` |
| inventory `--gex1-inserts` | `Tooling inventory-27.12 2024.xlsx` |
| inventory `--gex1-bolsters` | `6.Press 6\Bolster\Bolster Inventory(P2-P6).xlsx` |

---

## 1. Chart

```bash
node server/scripts/import-tooling-chart.cjs <workbook.xlsx> [--sheet "14 Inch"] [--dry-run]
```

Reads the all-presses sheet (default `14 Inch`), excludes Press 9, and replaces
only rows with `source_sheet = '2014/14 Inch'`. A dry run needs no database.

On the real sheet it keeps **88 rows**: PRESS 1 = 10, 2 = 27, 3 = 6, 4 = 13,
5 = 13, 6 = 19. Press 7 (a blank row) and press 8 (die size only) are skipped;
press 9 is excluded. The output lists `Rows kept` per press and `Skipped rows`
with reasons. A live run ends with a commit message; a dry run ends with
`Dry run, no changes were written.`

## 2. Inventory

```bash
node server/scripts/import-tooling-inventory.cjs --gex2 <Tooling Inventory-2025.xlsx> --gex1-inserts <Tooling inventory-27.12 2024.xlsx> --gex1-bolsters <Bolster Inventory(P2-P6).xlsx> [--dry-run]
```

Any subset of the three file flags may be given. It upserts by canonical number
in one transaction. It never deletes, never changes `status`, fills `size_class`
only when it is NULL, and unions `held_presses`.

Sheets read: `35MN PRESS ` (trailing space) and `25MN PRESS`;
`Tooling inventoy 27.12.2024`; `BOLSTER` and `ALL BOLSTER`.

Per source it prints parsed / new / updated (new and updated only on a live run),
skipped rows (not written), and `warnings (written anyway)`. Read both lists.

Result on the test server: GEX 1 insert 1421, GEX 1 bolster 14, GEX 2 insert 421,
GEX 2 bolster 79. A second run adds nothing.

## 3. Backfill die-tooling links

```bash
node server/scripts/backfill-die-tooling-links.cjs [--plant "GEX 1"] [--dry-run]
```

Reads `existing_die_details.bolster_no` and writes `die_tooling_links` with
source `die-list`, replacing only the die-list links of each plant processed.
A dry run reads the database but writes nothing.

Per plant it prints rows read, links by kind (insert / bolster / unknown), and the
20 most frequent unknown values.

Result on the test server: GEX 1 insert 15155, bolster 2016, unknown 3355
(811 distinct). GEX 2 has none, because its export lacks the column.

---

## Running against the test server

The database port is not published, so run inside the backend container. It
already has node, `xlsx` and the DB environment. In Git Bash, `MSYS_NO_PATHCONV=1`
is required or the container paths get rewritten.

The service files come with the image after a backend rebuild; otherwise
`docker cp` them in too.

```bash
docker cp "<workbook>" die-ordering-backend:/tmp/<name>.xlsx
```

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/<script> <args> --dry-run
```

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-backend node server/scripts/<script> <args>
```

```bash
MSYS_NO_PATHCONV=1 docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -At -c "<query>"
```

Rebuilding the backend from this branch's checkout:

```bash
docker compose -p die-tracker --env-file <path to .env> build backend
```

```bash
docker compose --project-directory <checkout with .env> up -d --wait backend
```

If `/api` answers 502 afterwards, `docker compose restart frontend`.

## Verify

```sql
SELECT press, count(*) FROM tooling_combinations GROUP BY 1 ORDER BY 1;
SELECT plant, kind, count(*) FROM toolings GROUP BY 1, 2 ORDER BY 1, 2;
SELECT plant, kind, count(*) FROM die_tooling_links GROUP BY 1, 2 ORDER BY 1, 2;
```

Run each through the `psql` command above. The counts should match the figures in
sections 1 to 3. Re-running any script should change nothing.

---

## Known gaps

- **GEX-1 inserts have no size.** The 2024 inventory has no size column, so
  `size_class` is NULL until Plan 2 derives it from drawings. They fail the chart
  check until then.
- **GEX-2 has no chart rows.** The all-presses sheet has no usable rows for
  presses 7 and 8, so every GEX-2 lookup answers `no_chart` until rows are added
  by hand. Press 9 is excluded by decision.
- **GEX-1 bolsters are mostly unknown to the master.** The bolster workbook holds
  only 14 numbers. Codes like `BOL-4-6-A` seen in the die list are in no
  inventory, so they are stored as typed links to toolings the master does not
  have.
- **16% of GEX-1 die-list values are `unknown`.** Patterns: `INS-12495`,
  prefix-less codes like `2-1-H`, and bare 3-digit numbers like `302`. A parser
  follow-up can reduce this.
- **GEX-2 die-list links** appear only once the GEX-2 export carries `IDBolster`.
- **Imported order PDFs** now record their INSERT No / BOLSTER No as `order-pdf`
  links on the main die, not on the insert/bolster sub-orders. Existing dies
  updated via PATCH are not linked.
