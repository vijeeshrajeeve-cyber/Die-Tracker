// The number shown in the No. of Trial column.
//
// Followup records carry a hand-typed count from before trials were logged
// individually — a number with no date, result or reason behind it. Those are
// shown as legacy rather than discarded, and are never turned into fabricated
// trial rows: a row claiming a trial happened on an unknown date is worse than
// no row. The moment a real trial is logged for a die, its legacy number stops
// being shown.
export const trialCountFor = (trials, legacyCount) => {
  const logged = (trials || []).length;
  if (logged > 0) return { count: logged, isLegacy: false };
  const legacy = Number(legacyCount) || 0;
  return { count: legacy, isLegacy: legacy > 0 };
};
