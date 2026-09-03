'use strict';

// One definition of "this die is still ours to run", shared by the New Backup
// Request form's Die Available count and the J-file's "No. of Active Dies"
// column. They are the same question under two names, so they must not drift.
//
// SENT TO TALEX is GEX-01's wording and TRANSFERRED is GEX-2's for the same
// thing: the die has gone to another plant. GEX-01 has 1,091 of the former and
// GEX-2 has 872 of the latter, so counting them would overstate both.
const INACTIVE_DIE_STATUSES = ['SCRAPPED', 'HOLD', 'TRANSFERRED', 'SENT TO TALEX'];

// A die whose status was never recorded is unknown, not known-active. Without
// this the exclusion list passes NULL straight through, and a plant whose rows
// predate the normalised import would report every scrapped die as available.
const ACTIVE_DIE_SQL = `NULLIF(die_status, '') IS NOT NULL
       AND upper(trim(die_status)) <> ALL($%d::text[])`;

// Renders the predicate against a given bind position, so both callers share
// the wording and neither can quietly diverge from the list above.
const activeDieClause = (paramIndex) => ACTIVE_DIE_SQL.replace('$%d', `$${paramIndex}`);

module.exports = { INACTIVE_DIE_STATUSES, activeDieClause };
