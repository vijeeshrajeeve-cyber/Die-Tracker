// The New Backup Request form takes the profile and the suffix separately, but
// die_no is stored as one value ('29663-253') and read that way by
// extractProfileFromDie, the frozen-design match, dieOrderPrefill, the order
// PDF, the J-file and the duplicate check.

export const composeDieNo = (profile, suffix) => {
  const p = String(profile ?? '').trim();
  const s = String(suffix ?? '').trim();
  return p && s ? `${p}-${s}` : '';
};

// Splits at the FIRST dash so an odd stored value like '30491-601 DP' keeps its
// trailing text in the suffix rather than being silently truncated.
export const splitDieNo = (dieNo) => {
  const raw = String(dieNo ?? '').trim();
  const at = raw.indexOf('-');
  if (at < 0) return { profile: raw, suffix: '' };
  return { profile: raw.slice(0, at), suffix: raw.slice(at + 1) };
};
