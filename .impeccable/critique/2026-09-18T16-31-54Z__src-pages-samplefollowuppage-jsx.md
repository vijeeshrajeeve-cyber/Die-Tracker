---
target: Sample followup page
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-09-18T16-31-54Z
slug: src-pages-samplefollowuppage-jsx
---
# Sample Followup critique

Target: src/pages/SampleFollowupPage.jsx
Method: dual-agent (A: 01a0b558-6c93-7361-bb18-99cd9e1725fa · B: parent CLI after explore B failed to exec)

## Heuristics

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | On hold has no .sf-status-hold; reads as unmarked |
| 2 | Match System / Real World | 4 | Trial → submit → approve maps the plant flow |
| 3 | User Control and Freedom | 3 | Escape/cancel/confirm exist; trials save immediately with admin-only undo |
| 4 | Consistency and Standards | 2 | TrialsSection cyan inline vs navy CSS module; unused StatusPill |
| 5 | Error Prevention | 3 | Detail date+status is safe; Edit form can diverge dates and status |
| 6 | Recognition Rather Than Recall | 3 | Next action is excellent; hidden at 780px |
| 7 | Flexibility and Efficiency | 3 | Deep-link actions, Today stamp, filtered export; no bulk/keyboard rows |
| 8 | Aesthetic and Minimalist Design | 2 | Form is a flat 11-field grid; status tabs compete with next-action IA |
| 9 | Error Recovery | 3 | Toasts name date+status; form errors are generic |
| 10 | Help and Documentation | 2 | Dual-save hinted; Rejected/On hold recovery undocumented |
| **Total** | | **28/40** | **Good** |

## Design specificity

High. Die IDs in JetBrains Mono, plant/press/corrector, Ascona, days-to-submit, fail-reason vocabulary, merged order+standalone sources, three-stage ladder with sideways Rejected/On hold.

## Detector

CLI `detect.mjs --json` on the four JSX files: `[]`, exit 0. No regex matcher hits. Browser overlay skipped: no browser automation in this session; localhost 5173/8080/4173 not reachable. CSS-only issues in sample-followup.css were out of detector markup scope.

## Cognitive load

6/8 checklist failures: 6 status tabs; flat create/edit form; dual save models; inconsistent patterns; Next action hidden on tablet; mobile hides the register while the panel is open. Overall: moderate–high.

## Priority issues

- P0 On hold unstyled
- P1 Next action hidden ≤780px
- P1 Rejected / On hold are UX dead-ends
- P2 Edit form can break date↔status integrity
- P2 TrialsSection style/system split
