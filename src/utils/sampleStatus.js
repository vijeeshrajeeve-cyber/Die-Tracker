// How far along a sample has got. Only these three are stages; the ladder is
// what lets the Today buttons advance a record without ever walking it
// backwards, so a late date correction cannot un-approve a die.
const STAGE_RANK = {
  'Pending': 0,
  'Sample Submitted': 1,
  'Approved': 2,
};

// Returns the status to store, or null for "leave it alone".
//
// Null covers two different situations deliberately, because the caller treats
// them identically: the target would move the record backwards (or nowhere),
// and the record sits in a status that is not a stage at all.
//
// `Rejected` and `On hold` are the second kind — they describe a decision
// somebody made, not progress through the flow. The system cannot tell whether
// a rejection still stands, so it does not guess: the date is stamped and the
// status is left for a person to change deliberately.
export const advanceStatus = (currentStatus, targetStatus) => {
  const target = STAGE_RANK[targetStatus];
  if (target === undefined) return null;

  // An empty status is a record that has not started moving yet, which is what
  // Pending means.
  const current = STAGE_RANK[currentStatus || 'Pending'];
  if (current === undefined) return null;

  return target > current ? targetStatus : null;
};
