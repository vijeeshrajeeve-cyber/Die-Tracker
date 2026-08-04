// One rule, one place. Every Corrector field in the app resolves its options
// through correctorOptions so the behaviour cannot drift between pages.
//
// Two rules matter here:
//
// 1. Empty-plant fallback. A plant with nobody assigned must not produce an
//    empty required dropdown — that would hard-block die receiving. GEX 01 has
//    no correctors recorded today, so this is a live case, not a hypothetical.
//
// 2. Pin the current value. A stored name that is not in the list (a legacy
//    typo, or a deactivated corrector) is kept as an option so that opening a
//    record never silently blanks or rewrites what is stored.
//
// Lives in utils rather than beside the component so that call sites which
// already render their own <select> (the order form's renderField, the detail
// panel's InfoRow) can share the rule without importing a component.

export const NOT_IN_LIST_SUFFIX = ' — not in list';

export function correctorOptions({ correctors = [], plant, value }) {
  const active = correctors.filter((c) => c.is_active);
  const forPlant = plant ? active.filter((c) => (c.plant || '') === plant) : active;
  const pool = forPlant.length ? forPlant : active;

  const names = [...new Set(pool.map((c) => c.name))]
    .sort((a, b) => a.localeCompare(b));

  const current = String(value || '').trim();
  if (current && !names.includes(current)) {
    return [{ value: current, label: `${current}${NOT_IN_LIST_SUFFIX}` }, ...names];
  }
  return names;
}
