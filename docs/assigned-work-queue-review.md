# Assigned work queue and stage deadlines — review pack

Date: 20 September 2026. Status: proposed feature; application implementation has not started.

The feature turns existing order, sample and QD stages into accountable work items. Each item shows the next action, responsible person, deadline, and relevant history. Workflow completion continues through the existing source form and its permissions.

## Deliverables

1. [Detailed feature description](superpowers/specs/2026-09-20-assigned-work-queue-design.md): users, scope, stage rules, calendar semantics, permissions, edge cases and acceptance criteria.
2. [Interactive mockup](mockups/assigned-work-queue.html): a standalone browser preview using fictional example records.
3. [Implementation plan](superpowers/plans/2026-09-20-assigned-work-queue.md): schema, APIs, integration points, phased tasks, tests and rollout.

Open the mockup in a browser. It includes its styles and scripts and makes no application API requests. The source fragment is also available as `docs/mockups/assigned-work-queue.fragment.html` for editing; regenerate the standalone preview after changing it.

## Suggested review sequence

| Step | Interaction | Behavior to assess |
|---|---|---|
| 1 | Open My work, Team, and Unassigned | Each view has its own matching counts; the Team view represents records accessible to the demonstration coordinator. |
| 2 | Select Overdue or Due today | The queue narrows to the chosen deadline category; select the same category again to clear it. |
| 3 | Search a die or choose a plant | Counts and visible rows use the same search and plant selection. |
| 4 | Open `30601-201` | See a late design approval, its owner, deadline basis and audit history. |
| 5 | Change the due date and save without a reason | Validation asks for a reason. Add a reason to see the revised due date and retained original deadline/breach. |
| 6 | Assign the item to Omar | It leaves Aisha's My work count but remains visible in Team. Reassignment does not change the deadline. |
| 7 | Open `30450-102` | QD approval ownership is read-only because the existing approval workflow determines it. |
| 8 | Open Unassigned, then `30560-202` | The manufacturing item needs a supplier ETA. Its deadline must be changed through the source workflow. |
| 9 | Open a source action | The concept shows where the existing source form will open. It does not perform an approval or complete a real work item. |
| 10 | Open Deadline rules | Explore the working week, cutoff, stage target, default owner and escalation contact. |
| 11 | Enable the example closure on 23 September | A three-working-day target after Monday 21 September moves from Thursday 24 to Friday 25 September. |
| 12 | Switch to Calendar days | Working-week exclusions and the example closure no longer affect the due date. |
| 13 | Save a stage rule, switch stages, and switch back | The saved example target is retained. Existing work-item deadlines stay unchanged. |

## Proposed defaults, not approved operating policy

- Examples use **Monday–Saturday**, **Asia/Dubai**, and **17:00 local cutoff**. The user has not selected a working week; these remain reviewable defaults.
- The demonstration clock is fixed at **Monday 21 September 2026, 10:30 GST**, so examples do not change during review.
- Targets count eligible whole days **after** the stage-entry date. Stage target values are examples, not existing supplier commitments.
- Supplier ETAs remain explicit promises. Missing ETAs appear as Needs setup instead of receiving an invented deadline.
- A waiting note does not stop time. Reminder snooze leaves both the deadline and team escalation active.
- Policy edits affect future stage occurrences. Applying changes to open work needs an impact preview and an audited reason in the implemented feature.

## Prototype boundary

This is a design review, not a production-connected screen. Names, records and the example plant closure are synthetic. Changes are local to the preview; no real assignments, emails, deadlines or permissions change.

The embedded mockup expands details underneath the queue so the fields remain readable at narrow widths. The feature specification also defines the desktop side drawer. The rules preview demonstrates one plant and four representative stages; the proposed feature covers all mapped stages. Escalation delivery, bulk impact previews, calendar administration, permission enforcement and workflow completion are specified in the documents, not implemented in this mockup.

The preview demonstrates same-day pauses with no whole-day credit. Multi-day pause arithmetic and historical backfill are implementation acceptance cases. Current example tasks retain their original Mon–Sat calendar snapshot even while proposed rules are edited.

## Verification

The mockup was checked in the browser for queue filtering, assignment, required deadline-change reasons, retained original deadline, source navigation, missing-ETA handling, and calendar/closure calculations. Desktop and narrow layouts were inspected; the narrow table scrolls within its own container. JavaScript syntax was checked independently.

The previous codebase review established a baseline of 595 passing tests and a successful production build, with 72 lint errors and two warnings. The feature is now implemented and tested against isolated PostgreSQL databases. See [implementation and rollout notes](assigned-work-queue-operations.md) for operating behavior, validation and deployment steps.

## Implementation order

Build source synchronization, calendar calculations and permission checks first. Deliver an order/sample queue in a pilot plant, validate counts and ownership, then add QD adapters and durable notifications. Turn on escalation only after the backfill and rule review; avoid generating historical reminder floods. The implementation plan contains the detailed tasks and release gates.
