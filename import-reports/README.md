# Sample Followup import — test-server rehearsal, 2026-08-03

**These reports are from the local test server, not production.** They record a
rehearsal of the one-time Sample Followup backfill
(`server/scripts/import-sample-followup-sheet.cjs`). No production data was
touched by this run.

| File | What it is |
|---|---|
| `test-server-dryrun.txt` | Dry run — the plan, nothing written. |
| `test-server-run.txt` | The applied run against the test database. |
| `test-server-idempotency-check.txt` | Second dry run afterwards, proving a re-run is a no-op. |

## Do not read these numbers as facts about production

Every count here describes whatever `die_orders` the test server happened to
hold on 2026-08-03. On production they will differ. In particular:

- **192 matched / 32 not found** — the match rate depends entirely on which die
  orders exist in the database being imported into.
- **The 32 "not found" dies** are missing *from the test snapshot*. Several look
  like they predate the app, but that conclusion was drawn from test data and
  does not establish that production lacks them.
- **23 orders with a die received date but a pre-receipt status** — very likely
  an artifact of the test snapshot's incomplete stage dates. Do not act on this
  list; re-derive it from a production dry run if it matters.

## What the rehearsal does establish

The script's behaviour, which is data-independent and covered by 29 unit tests
in `server/services/sampleFollowupImport.test.cjs`:

- Excel serials, typed dates, and the stray `0` cell all parse correctly.
- Cancelled orders are excluded from matching.
- Blank sheet cells are omitted from the `UPDATE` rather than clearing values.
- `sample_status` is derived from dates, upgrade-only.
- All writes happen in one transaction, and a re-run is a no-op.

## Running it for real

See `docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md`.
Dry run first, read the report, back up, then apply.
