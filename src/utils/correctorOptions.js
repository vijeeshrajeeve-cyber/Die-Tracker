// One rule, one place. Every Corrector field in the app resolves its options
// through correctorOptions so the behaviour cannot drift between pages.
//
// Three rules matter here:
//
// 1. Plant names are compared loosely. The app has no canonical plant
//    vocabulary: die_orders says "GEX 1", the plants master says "GEX 01" and
//    presses say "GEX 02". An exact string match therefore never fired for the
//    436 orders stored as "GEX 1", and a corrector an admin assigned to
//    "GEX 01" in Settings could never match one. See normalizePlant.
//
// 2. Empty-plant fallback. A plant with nobody assigned must not produce an
//    empty required dropdown — that would hard-block die receiving.
//
// 3. Pin the current value. A stored name that is not in the list (a legacy
//    typo, or a deactivated corrector) is kept as an option so that opening a
//    record never silently blanks or rewrites what is stored.
//
// Lives in utils rather than beside the component so that call sites which
// already render their own <select> (the order form's renderField, the detail
// panel's InfoRow) can share the rule without importing a component.

export const NOT_IN_LIST_SUFFIX = ' — not in list';

// "GEX 01", "gex  1" and "GEX 1" are the same plant. Upper-cases, collapses
// whitespace, and strips leading zeros from numeric segments so the three
// spellings in the database compare equal. Deliberately conservative: it does
// not touch anything but case, spacing and leading zeros, so two genuinely
// different plants can never collapse into one.
export function normalizePlant(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\b0+(\d)/g, '$1');
}

export function correctorOptions({ correctors = [], plant, value }) {
  const active = correctors.filter((c) => c.is_active);
  const wanted = normalizePlant(plant);
  const forPlant = wanted
    ? active.filter((c) => normalizePlant(c.plant) === wanted)
    : active;
  const pool = forPlant.length ? forPlant : active;

  const names = [...new Set(pool.map((c) => c.name))]
    .sort((a, b) => a.localeCompare(b));

  const current = String(value || '').trim();
  if (current && !names.includes(current)) {
    return [{ value: current, label: `${current}${NOT_IN_LIST_SUFFIX}` }, ...names];
  }
  return names;
}
