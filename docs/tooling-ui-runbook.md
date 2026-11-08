# Tooling UI — runbook

The tooling finder's user-facing part (Plan 5): the **Toolings** page (list, drawer,
review queue, Add tooling), the **New die order** button and modal in the top bar,
and **Find tooling** inside Backup Die Requests → Generate Die Order PDF. The finder
itself (`POST /api/toolings/find`) is described in `docs/tooling-finder-runbook.md`.

---

## Who sees what

| What | Who |
| --- | --- |
| Toolings page in the sidebar | admins, and users whose page access includes **Toolings** (`toolings`; Users → edit user) |
| The list, the drawer, the review queue (read) | anyone who can open the page |
| Add tooling, the drawer's review and edit controls, Clear / Keep on pictures | **reviewers**: admins, or users with the **Can review toolings** switch (`users.can_review_toolings`, carried in the JWT as `canReviewToolings`). Hidden for everyone else; the server refuses them anyway (403, `reviewerMiddleware`) |
| New die order button | users with `orders` or `backup-requests` page access |
| Find tooling in the backup modal | anyone with `backup-requests` |

The read routes `/api/toolings/*` and `/api/profile-shapes/*` need a login only, **not**
the `toolings` page access: the finder panel reads them from the Orders and Backup pages
too (`server/index.cjs`). The `toolings` page id is in `VALID_PAGE_IDS`
(`server/routes/users.cjs`), so it can be granted.

## The page

- **Toolings tab.** Filters: plant (GEX 1 / GEX 2), press (any spelling the presses
  master resolves: `P7`, `7`, `PRESS 7`), kind, size class, status (active / retired /
  unverified / all — `status=all` is new on `GET /api/toolings`), opening confidence.
  The top-bar box searches by number (`q`). 50 a page, Prev / Next.
  **The confidence filter is applied to the loaded page only**: the list route has no
  confidence parameter, so "1–50 of 1421 · 20 on this page with that opening confidence"
  is what it says. Columns: number, kind, plant, size class (+ its confidence), cavities,
  held at (presses), location, opening confidence, linked dies, status.
- **Drawer** (click a row): header pills (size class + confidence, status, opening
  confidence); drawings (*View* opens a PDF in the viewer; DXF/DWG/TIF are *Download*
  only); the opening drawn from its stored geometry (outer thin, pockets stroked) with
  source, confidence, pocket count/gap, extractor note and the last review; linked dies
  (die, plant, source, seen, and the die list's size / press / cavity when found).
- **Review queue tab.** One list of two kinds of item:
  - *Opening* rows from `GET /api/toolings/review-queue` — a tooling lands there for the
    first of: unverified number, no drawing opening, opening not known (no pockets),
    opening uncertain, size class unknown. *Open* opens the drawer.
  - *Picture* rows from `GET /api/profile-shapes/review-queue?plant&limit&offset` (new):
    profile shapes with `needs_review = true`, newest first, with the stored picture as
    a thumbnail (fetched as a blob, the image route needs the Bearer header) and the
    reason the import flagged it.
  Pictures are dated and come first; openings have no date and follow. Use the
  *Openings only / Pictures only* select to see one kind. The first 50 of each are shown.

## Review vocabulary — what each action changes

| Action (reviewers) | Route | Writes |
| --- | --- | --- |
| Confirm opening | `POST /api/toolings/:n/opening/review {action:'confirm', note?}` | `tooling_openings.confidence='confirmed'`, `reviewed_by/at`, `review_note` |
| Correct pockets | `… {action:'correct', pockets, note?}` | replaces `pockets` (mm, tooling frame, y up, `[[[x,y],…],…]`, ≥3 pairs each — checked in the browser first), `extraction_source='manual'`, `confidence='confirmed'`, recomputes `pocket_gap_mm`; keeps the outer |
| Mark opening not known | `… {action:'none'}` | `pockets=NULL`, `pocket_gap_mm=NULL`, `confidence='none'`; keeps outer, drawing, note |
| Retire / Reactivate / Mark verified | `PATCH /api/toolings/:n {status}` | `toolings.status` (`retired` leaves the finder; `active`) |
| Save changes (location, size class, cavities, notes) | `PATCH /api/toolings/:n` | only the changed fields; a size class is normalised and stored as `manual`/`confirmed` |
| Upload drawing (.dxf/.pdf) | `POST /api/toolings/:n/drawing` | stores the file, adds `tooling_drawings`, reads the opening — **never replaces a confirmed or reviewed opening** (the toast says "the reviewed opening was kept") |
| Add tooling | `POST /api/toolings` then the upload above if a drawing was picked | new `toolings` row, `source='manual'`; kind is guessed from the number (`I-…`, `NNIC…` = insert) and editable; plant/kind/cavities left blank come from the number |
| Clear (picture) | `POST /api/profile-shapes/:id/review {action:'clear', note?}` | `needs_review=false`, reviewer — the shape joins the similarity index |
| Keep (picture) | `… {action:'keep', note?}` | stays `needs_review=true`, reviewer recorded; a note is appended to `review_reason` |

Every write invalidates the plant's finder / similarity cache.

## The new die order form record

*New die order* (top bar) → pick the drawing PDF → fields prefill from the drawing with
"from drawing" hints → Find tooling (needs a true-size profile traced from the drawing,
plant, press, die size, cavities) → *Use this* fills one INSERT or BOLSTER pair →
*Generate & Save* stamps the order template onto the PDF and records it:

- `new_die_order_forms`: plant, die, profile, customer, press, die size, cavities, all
  form values, `chosen_tooling` / `chosen_kind` / `chosen_from_finder`, the candidates
  shown, `profile_shape_id`, the stored drawing and form PDF paths, who and when.
- `die_tooling_links` gets the typed INSERT / BOLSTER numbers with source `new-order-form`
  (a number the master does not know is added as an `unverified` tooling, source
  `order-form`, so it shows in the review queue);
  `profile_shapes` gets the traced shape as `profile-drawing`.
- Files: under the tooling root, `new-die-orders/<plant>/<die>-<stamp>/` (the
  `tooling_files_data` volume, `TOOLING_FILES_ROOT=/app/storage/tooling-files`).
- No order is created.

The backup modal's Find tooling has no drawing until Generate, so it runs on the **die's
stored true-size profile** (`dieNo`) and shows the die's current tooling above the
candidates. Die numbers are matched with `_` and `-` as the same separator: the GEX 1
die list stores `13794_525` where backup requests and orders write `13794-525` (found in
this smoke; `for-die`, the finder's profile lookup and the similar list's self-exclusion
all compare that way now).

## Deploy notes

- Rebuild **both** images (the page is frontend, the routes backend); a restart does not
  pick up source:
  `docker compose -p die-tracker --env-file <.env> build backend frontend`, then
  `docker compose -p die-tracker -f docker-compose.yml --project-directory <checkout with .env> up -d --wait backend frontend`.
- nginx (`nginx.conf`): `location /api/toolings/` 60m (drawing upload, multer 50 MB);
  `location /api/new-die-order-forms/` 31m (drawing PDF, multer 30 MB). Without them
  uploads fail at nginx's 10m default with a 413.
- Volume `tooling_files_data` must be mounted at `/app/storage/tooling-files` on the
  backend; it holds tooling drawings, profile pictures and the new-order PDFs.
- Grant access: Users → edit → page access **Toolings**, and the **Can review toolings**
  switch for reviewers.

## Smoke, test server, 2026-11-08

Both images rebuilt from `feat/tooling-finder-5-ui`; scratch user `tf5smoke` (role
user, page access orders / backup-requests / toolings, `can_review_toolings = true`)
created by SQL, logged in through the built-in browser at `http://localhost`.
Screenshots (scratchpad `task6-smoke/`, not committed) named below.

| Step | Result | Screenshot |
| --- | --- | --- |
| Sidebar shows Orders, Backup Die Requests, Toolings only | ok | `00-login-orders-sidebar.jpg` |
| (a) Toolings list loads (active, all plants) | ok | `01-toolings-list.jpg` |
| (a) Filters GEX 1 + Inserts + Likely; "1–50 of 1421 · 20 on this page…" | ok | `02-filters-gex1-insert-likely.jpg` |
| (a) Search `12999` → I-12999 only; drawer: 4 DXF (Download), 3 PDF (View), opening overlay with outer + 2 pockets, gap 98.1 mm | ok | `03-drawer-I-12999.jpg` |
| (a) View PDF → viewer shows the drawing matching the overlay; Escape closes the viewer only | ok | `04-pdf-view-12999.jpg` |
| (a) Confirm opening with a note → "Reviewed Nov 08, 2026 — tf5 smoke" (I-12999 was already `confirmed`, unreviewed) | ok | `05-I-12999-confirmed-reviewed.jpg` |
| (a) Correct pockets with `[[[0,0],[1,1]]]` → "Pocket 1 needs at least 3 [x, y] pairs", nothing posted | ok (message moved next to the textarea after this run) | `06-pockets-validation.jpg` |
| (a) I-03035 `likely` → Confirm → pill `confirmed`, list row refreshed | ok | `07-I-03035-likely-to-confirmed.jpg` |
| (b) Review queue: 1117 toolings · 243 pictures, thumbnails load | ok | `08-review-queue-pictures.jpg` |
| (b) Clear picture 53230 (026004-802) → row gone, 242 left | ok | `09-picture-cleared.jpg` |
| (b) Opening row → drawer "opening not known" | ok | `10-queue-opening-drawer.jpg` |
| (b) Openings only filter (added after this run) | ok | `15-queue-openings-only.jpg` |
| Add tooling: `I-99901` → kind guessed Insert; cancelled, nothing created | ok | `16-add-tooling-modal.jpg` |
| (c) New die order: modal opens at the picker step | ok | `11-new-die-order-picker.jpg` |
| (c) Pick a drawing, prefill, Find tooling, Generate, `new_die_order_forms` row | **not automated** — the picker is the native `showOpenFilePicker` dialog, which the browser tool cannot drive; the fields appear only after a pick. **Verify manually.** | — |
| (d) Backup 13794-525 → Generate Die Order PDF → Find tooling, first run | **failed**: "Current tooling: none recorded" and "no true-size profile" — the die list stores `13794_525` | `12-backup-find-before-fix.jpg` |
| (d) Same after the separator fix | ok: "Current tooling: I-13794 (insert)", candidates PRESS 5 / 250X160 / 1 cav with overlays, similar strip (13794_623, 13794_413, …, not the die itself) | `13-backup-find-after-fix.jpg` |
| (d) Use this on I-13111 → INSERT No I-13111, INSERT SIZE 300X100 (form state only; Generate not pressed) | ok | `14-use-this-filled.png` |

Console: no errors from the Toolings page, the drawer, the queue or the finder panel.
Seen and not from this work: 403s for sample followups / sample trials / email templates
(the shell loads them for a user without those pages), a 401 from a mistyped login, and
the finder's expected 404 before the fix.

Data changed and restored (one transaction, values recorded before the smoke):
- I-12999 opening: `reviewed_by/at/note` set → back to NULL, `confidence` `confirmed`,
  `updated_at` 2026-11-08 08:28:33.280723.
- I-03035 opening: `likely` → `confirmed` → back to `likely`, reviewed_* NULL, same
  `updated_at`.
- profile_shapes 53230: `needs_review` false → back to true, reviewed_* NULL,
  `updated_at` 2026-11-08 13:57:16.410252 (243 flagged again).
- User `tf5smoke` deleted. No tooling, drawing, form or link rows were created.

## Known gaps

- DXF / DWG / TIF drawings are download-only; only PDFs are viewed in the browser.
- Pocket correction is a JSON paste (mm, tooling frame), validated for shape only; there
  is no graphical editor.
- The backup panel runs on the die's stored profile, not the drawing (the drawing is
  only picked at Generate). A die with no true-size profile gets the finder's 404 text.
- The confidence filter covers the loaded page only (no server parameter).
- The New die order picker step needs a manual check (above).
- Openings in the queue carry no date, so the merged list puts pictures first; use the
  kind select.
