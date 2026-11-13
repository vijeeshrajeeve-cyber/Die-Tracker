# Skip simulation — design

Date: 2026-11-13. Size: a small change.

## Intent

An order can be requested with "Simulation required" and then, for some
reason, the simulation is not run and the design is approved anyway. Today the
only ways to move such an order on are drawer edits that either leave it
looking like a simulated order with missing dates, or erase the fact that
simulation was requested. The Simulation page needs one deliberate action that
says "we did not simulate this one, and here is why".

## Goals

- One **Skip simulation** action on the Simulation page, with a required
  free-text reason (user decision: free text, not a fixed list).
- The order keeps "Simulation required = Yes". The skip is recorded beside it:
  date, reason, and who did it.
- The order moves to Design Approval; approving the design stays the normal,
  separate step.
- A skip never looks like a pass: "Simulation completed" stays empty.
- Every place that reads the simulation pass treats a skip correctly (list
  below).

## Non-goals

- No fixed list of skip reasons and no reporting by reason.
- No "skipped" count on Analytics → Simulation (can be added later).
- No marking of orders that already left Simulation in the past.
- No undo button for a skip (see "Taking a skip back").

## Anti-goals

- A skipped order counted as a simulated one in any lead-time figure.
- A skip that stamps a date nobody entered into "Simulation completed" or
  "3D model received".
- A drawer edit on a skipped order bouncing it back to Simulation.

## Approaches

1. **Skip recorded on the order (chosen).** Three new columns on `die_orders`:
   `simulation_skipped_date`, `simulation_skipped_reason`,
   `simulation_skipped_by`. Simulation rounds are not touched; an open round
   shows greyed as "left simulation", which the page already does. Smallest
   change, mirrors how the pass is stored (`simulation_completed_date`), and
   keeps skip out of every round-based figure by construction.
2. **Skip as a round result.** Add `Skipped` beside OK / Not OK in
   `simulation_rounds`. Rejected: a skip is not a simulation round, the two
   table CHECK constraints would need a migration, and every round count and
   pass-rate figure would have to learn to exclude it.
3. **Switch off "Simulation required" with a reason.** Works today. Rejected:
   it loses the fact that simulation was requested, which is the point.

Approach 1 was Claude's call; the user handed over the how.

## Design

### Server

- `die_orders` gains `simulation_skipped_date DATE`,
  `simulation_skipped_reason TEXT`, `simulation_skipped_by TEXT` (in
  `init.sql` and as `ADD COLUMN IF NOT EXISTS` in `server/db.cjs`).
- `POST /api/simulation/:orderId/skip` with `{ reason }`. Same access as
  recording a step (any signed-in user who can use the page). In one
  transaction with the order row locked:
  - refuse 409 unless status is `UNDER SIMULATION`;
  - refuse 400 unless the reason is non-blank; keep at most 500 characters;
  - set the three skip columns (date = today), status
    `PENDING FOR DESIGN APPROVAL`;
  - write an `order_changes` STATUS row with reason
    `Simulation skipped: <reason>`.
  Allowed at any stage of a round, including part-way through.
- `createRevision`: where it clears `simulation_completed_date` today (design
  sent back to Awaiting Design or Simulation) it also clears the three skip
  columns. The change log keeps the history.
- `presentOrder` exposes `Simulation Skipped Date`, `Simulation Skipped
  Reason`, `Simulation Skipped By`.
- Daily summary: Design Approval ages from the skip date as it does from the
  completed date. Auto-backup and the export include the new columns.

### Taking a skip back

A skip, like an OK, is not undone on the Simulation page. To put the order
back, use the existing Revision action with target Simulation; that clears the
skip and the order waits for a new round.

### Client

- **Simulation page detail:** a secondary "Skip simulation" button, away from
  the primary step button. It opens a small dialog: a required reason box and
  Skip / Cancel. On success the die leaves the list with a toast.
- **`determineStatus`:** a skip date counts like a completed date, so a
  skipped order is never pulled back to `UNDER SIMULATION` by a drawer edit.
- **Drawer timeline:** for a skipped order the "Simulation completed" step is
  replaced by "Simulation skipped", showing the date, and the reason and who
  as its note. "3D model received" stays only if it has a date.
- **Days waiting in Design Approval** (Flow page, orders table, export): start
  from the completed date, or the skip date when skipped.
- **Dashboard average and Analytics Overview lead times:** an order counts as
  "with simulation" only if simulation was required *and* not skipped. One
  shared helper decides this.

## Left to the builder

- Exact wording and placement of the button and dialog, following the existing
  Simulation page components.
- Whether the shared "was simulated" helper lives beside
  `isSimulationEnabled` or in its own file.

## Testing

`node:test` suites beside the code: the skip service (happy path, wrong
status, blank reason, mid-round), revision clearing the skip,
`determineStatus` with a skip date, the shared helper, and the route. Then a
browser walk-through on a scratch stack.
