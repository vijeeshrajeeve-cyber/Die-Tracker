# Sample Followup backfill — production runbook

One-time import of the Sample Followup Excel sheet into `die_orders`.
Design: `docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md`

**What it does:** for each sheet row, finds the matching die order by die number
and fills in blank `submission_date`, `sample_approval_date`, `no_of_trial` and
`corrector`, and moves `sample_status` forward to match. New past submission
dates are also marked as already reported, so Daily Summary does not list them
as "Recorded late".

**What it never does:** replace a value already in the app, write the die
received date, create orders, delete anything, touch the main order `status`, or
clear a field the sheet leaves blank. Dies with no matching order are skipped and
listed.

**Sheet columns:** `Die`, `Submission Date`, `Sample Approval Date`,
`No. of Trial`, `Corrector`. The wordings `Die No`, `Sample Submission Date`,
`Sample Approval`, `Number of Trials` and `Corrector Name` also work. It reads the
sheet named `Sample Followup`, otherwise the first sheet.

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

- **Top of the report.** `COLUMNS NOT FOUND` means a header was not recognised and
  that whole column will be ignored. Fix the header and run the dry run again.
- **Section 1 — matched and changing.** Every value should move from `(empty)`
  (or a trial count of `0`) to a new value.
- **Section 3 — not found.** These dies have no order in the app and are skipped
  entirely. A short list is expected; a long one means the die numbers in the
  sheet do not match how the app records them.
- **Section 4 — ambiguous.** Should be empty. Anything here matched several live
  orders and was skipped rather than guessed at.
- **Section 5 — warnings.** Unreadable dates, and sheet-vs-app disagreements on
  plant or supplier. Disagreements are reported only, never written.
- **Section 6 — sheet differs from the app.** The app value is kept. If the sheet
  is right for any of these, correct them on screen afterwards.
- **Section 7 — no die received date.** The values are saved, but these dies will
  not appear on the Sample Followup page until a received date is entered.
- **Section 8 — corrector names.** Fix the spelling in the sheet or add the person
  in Settings, then run the dry run again. A name is saved exactly as typed.
- **Section 9 — trials already logged.** The app shows the logged trials, so the
  sheet count is not saved.
- **Section 10 — hand-added records.** These are not updated. Enter them on screen.

## 5. Back up the database

Run this in `bash`. `pipefail` makes a failed `pg_dump` stop the command instead
of leaving a small, valid-looking gzip file:

```bash
set -o pipefail; BACKUP=backup-pre-sf-import-$(date +%Y%m%d-%H%M%S).sql.gz; docker exec die-ordering-db pg_dump -h /var/run/postgresql -U postgres die_ordering | gzip > "$BACKUP" && echo "Backup OK: $BACKUP" || echo "BACKUP FAILED - do not continue"
```

Pass `-h /var/run/postgresql` explicitly — without it, `psql`/`pg_dump` inherits
`PGHOST` from `.env` and goes out over TCP into the scram rule. `gzip -t` only
proves the file is readable, so also confirm the dump reached its end. This must
print `-- PostgreSQL database dump complete`:

```bash
gunzip -c "$BACKUP" | grep -- "PostgreSQL database dump complete"
```

Then keep a copy of just the columns this import changes. It gives a rollback that
does not lose work entered after the import:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "CREATE TABLE die_orders_pre_sf_import AS SELECT id, submission_date, sample_approval_date, no_of_trial, corrector, sample_status, updated_at FROM die_orders"
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
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "SELECT count(*) AS orders_changed FROM die_orders d JOIN die_orders_pre_sf_import p USING (id) WHERE (d.submission_date, d.sample_approval_date, d.no_of_trial, d.corrector, d.sample_status) IS DISTINCT FROM (p.submission_date, p.sample_approval_date, p.no_of_trial, p.corrector, p.sample_status)"
```

`orders_changed` should equal the number of updates applied, unless someone edited
an order in the app in the meantime. Then re-run the dry run — it should report
**0 to update**, which proves a repeat run is harmless:

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

**Preferred: put the sample columns back from the step 5 snapshot.** Other columns
and new orders are left alone:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "UPDATE die_orders d SET submission_date = p.submission_date, sample_approval_date = p.sample_approval_date, no_of_trial = p.no_of_trial, corrector = p.corrector, sample_status = p.sample_status, updated_at = p.updated_at FROM die_orders_pre_sf_import p WHERE d.id = p.id AND (d.submission_date, d.sample_approval_date, d.no_of_trial, d.corrector, d.sample_status) IS DISTINCT FROM (p.submission_date, p.sample_approval_date, p.no_of_trial, p.corrector, p.sample_status)"
```

This also undoes any sample edits made in the app since the import, so check with
users first. Daily Summary ledger rows from the import stay behind; the only effect
is that a re-entered old date for those dies is not listed as "Recorded late".

**Last resort: restore the whole database** from the step 5 backup, only into an
empty database and only if nothing else has been entered since. A plain restore
into the live database does not undo the import, because the tables already exist.

Once you are happy with the import, drop the snapshot:

```bash
docker exec die-ordering-db psql -h /var/run/postgresql -U postgres -d die_ordering -c "DROP TABLE die_orders_pre_sf_import"
```

## Expected side effects

- Dies that move to `Approved` close their Work Queue task, and dies that move to
  `Sample Submitted` move to the Sample Approval task. Work Queue updates itself
  from the changed rows.
- The import never changes the main order status, and it does not change which
  dies appear on the Sample Followup page.
