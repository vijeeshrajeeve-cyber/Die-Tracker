/**
 * Brand palette — the single source of truth for brand colour in the app.
 *
 * Taken from the "Areas of growth" ratio chart. The percentages are how much of
 * the interface each colour should account for, which is why NAVY is the
 * primary action colour and MAGENTA/PINK are reserved for accents.
 *
 * ┌──────────┬─────┬──────────────────────────────────────────────────────────┐
 * │ NAVY     │ 48% │ primary actions, active nav, links, focus                │
 * │ SLATE    │ 30% │ headers, secondary surfaces, chart baselines             │
 * │ MAGENTA  │ 10% │ emphasis, selected state, the one thing on screen        │
 * │ TEAL     │ 10% │ informational highlights, secondary series               │
 * │ PINK     │  2% │ rare accent — dividers, subtle fills. Use sparingly      │
 * └──────────┴─────┴──────────────────────────────────────────────────────────┘
 *
 * ⚠ PROVISIONAL VALUES — these hexes were sampled by eye from a rasterised
 * chart, not from a brand spec, and the chart's own legend contradicts its
 * swatches on three of five entries ("Green" is magenta, "Gray" is pink,
 * "Black" is slate). Replace the six values below with the official hexes when
 * they are available; nothing else in the app needs to change.
 *
 * Keys are named for the colour each value actually is, so that a future reader
 * editing MAGENTA sees magenta. The chart's own labels are recorded in
 * `CHART_LABEL` for traceability back to the source document.
 */

export const BRAND = {
  navy: '#1F6FB0',
  slate: '#3D4F5C',
  magenta: '#A81A5F',
  teal: '#2E9FBF',
  pink: '#E5A3BC',
};

// What the source chart called each swatch, kept only so the mapping back to
// the brand document is not lost. Deliberately not used for styling.
export const CHART_LABEL = {
  navy: 'Navy (48%)',
  slate: 'Black (30%)',
  magenta: 'Green (10%)',
  teal: 'Others (10%)',
  pink: 'Gray (2%)',
};

// Tints of the primary, for hovers, rings and quiet fills. Derived rather than
// hand-picked so they stay in step if `navy` changes.
export const BRAND_ALPHA = {
  navySoft: 'rgba(31,111,176,0.14)',
  navyRing: 'rgba(31,111,176,0.38)',
  navyGlow: 'rgba(31,111,176,0.30)',
  magentaSoft: 'rgba(168,26,95,0.14)',
  tealSoft: 'rgba(46,159,191,0.14)',
};

/**
 * Status colours are deliberately NOT brand colours.
 *
 * The palette has no green and no red, and "this succeeded" / "this destroys
 * data" have to read the same way to everyone on the shop floor regardless of
 * branding. Keeping them separate also means a rebrand cannot accidentally
 * make a delete button look safe.
 */
export const STATUS = {
  success: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  info: BRAND.teal,
};
