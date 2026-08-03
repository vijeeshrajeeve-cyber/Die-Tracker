# Sample Followup backfill — production runbook

One-time import of the historical Sample Followup Excel sheet into `die_orders`.
Design: `docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md`

**What it does:** for each sheet row, finds the matching die order by die number
and fills in `die_received_date`, `submission_date`, `sample_approval_date`,
`no_of_trial`, `corrector`, and a derived `sample_status`.

**What it never does:** create orders, delete anything, touch the main order
`status`, or clear a field the sheet leaves blank. Dies with no matching order
are skipped and listed.

Container names below assume the compose defaults. Replace them if production
differs.

---

## 1. Get the script onto the production host

Two files are needed inside the backend container:

- `server/services/sampleFollowupImport.cjs`
- `server/scripts/import-sample-followup-sheet.cjs`

**Option A — copy them in (recommended).** No rebuild, no restart, no downtime.

```bash
docker cp server/services/sampleFollowupImport.cjs die-ordering-backend:/app/server/services/sampleFollowupImport.cjs
```

```bash
docker cp server/scripts/import-sample-followup-sheet.cjs die-ordering-backend:/app/server/scripts/import-sample-followup-sheet.cjs
```

**Option B — rebuild the image.** Only if you want the script baked in
permanently. A plain `docker compose restart` will *not* pick up new source:

```bash
docker compose build backend && docker compose up -d backend
```

## 2. Copy the sheet in

```bash
docker cp /path/to/Sample.xlsx die-ordering-backend:/app/Sample.xlsx
```

## 3. Dry run — writes nothing

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --dry-run --report /app/sf-dryrun.txt
```

```bash
docker cp die-ordering-backend:/app/sf-dryrun.txt ./sf-dryrun.txt
```

## 4. Read the report before going further

Do **not** compare against the test-server figures (192 matched / 32 not found);
those describe the rehearsal snapshot, not production. Check these instead:

- **Section 1 — matched and changing.** Values should mostly move from `(empty)`
  to a date. If you see real values being replaced by different ones, stop and
  work out why.
- **Section 3 — not found.** These dies have no order in the app and are skipped
  entirely. A short list is expected; a long one means the die numbers in the
  sheet do not match how the app records them.
- **Section 4 — ambiguous.** Should be empty. Anything here matched several live
  orders and was skipped rather than guessed at.
- **Section 5 — warnings.** Unreadable dates, and sheet-vs-app disagreements on
  plant or supplier. Disagreements are reported only, never written.

## 5. Back up the database

```bash
docker exec die-ordering-db pg_dump -h /var/run/postgresql -U postgres die_ordering | gzip > backup-pre-sf-import-$(date +%Y%m%d-%H%M%S).sql.gz
```

Pass `-h /var/run/postgresql` explicitly — without it, `psql`/`pg_dump` inherits
`PGHOST` from `.env` and goes out over TCP into the scram rule. Confirm the file
is non-empty before continuing:

```bash
gzip -t backup-pre-sf-import-*.sql.gz && ls -lh backup-pre-sf-import-*.sql.gz
```

## 6. Apply

Same command without `--dry-run`. All updates run in one transaction — any error
rolls the whole thing back.

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --report /app/sf-live.txt
```

Ends with `Applied N updates.`

## 7. Verify

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) FILTER (WHERE die_received_date IS NOT NULL) AS with_received, count(*) FILTER (WHERE sample_status = 'Approved') AS approved, count(*) FILTER (WHERE sample_status = 'Sample Submitted') AS submitted FROM die_orders"
```

`with_received` should equal the number of rows applied. Then re-run the dry run
— it should report **0 to update**, which proves the import is idempotent and a
repeat run is harmless:

```bash
docker exec die-ordering-backend node server/scripts/import-sample-followup-sheet.cjs /app/Sample.xlsx --dry-run --report /app/sf-verify.txt
```

Finally, open the Sample Followup page and confirm the rows look right.

## 8. Tidy up

```bash
docker exec die-ordering-backend rm -f /app/Sample.xlsx /app/sf-dryrun.txt /app/sf-live.txt /app/sf-verify.txt
```

---

## Rollback

The import only ever writes the six sample columns, so a bad outcome is
recoverable from the backup taken in step 5:

```bash
gunzip -c backup-pre-sf-import-<stamp>.sql.gz | docker exec -i die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering
```

Restoring replaces the whole database, so only do this if the import went wrong
and nothing else has been entered since.

## Expected side effect

Orders that gain a die received date start appearing on the Sample Followup
page — that is the point. Separately, `determineStatus()` in the UI treats a
received date plus all earlier stages as `DIE RECEIVED` rather than `DONE`, so
affected orders may show that status the next time someone edits and saves them.
The import itself never changes the order status.
