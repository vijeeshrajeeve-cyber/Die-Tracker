// Pure view helpers for the tooling finder panel (POST /api/toolings/find) and
// its SVG overlays. Frames: query.profile.points are mm, centroid at (0,0), y up;
// candidate pockets are mm in the tooling frame, y up; a placement rotates the
// profile by theta (radians) about the origin, then moves it by (tx, ty).

const STANDARD_CLEARANCE_MM = 5;

export function placedProfile(points, placement) {
  if (!Array.isArray(points)) return [];
  const theta = placement?.theta || 0;
  const tx = placement?.tx || 0;
  const ty = placement?.ty || 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return points.map(([x, y]) => [x * cos - y * sin + tx, x * sin + y * cos + ty]);
}

// The bbox of every polygon, padded by `pad` of its size on each side, as an SVG
// viewBox for a group drawn with transform="scale(1,-1)": the screen y of a point
// is -y, so the box's top edge is -(maxY + padY).
export function overlayViewBox(pockets, pad = 0.1) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const poly of pockets || []) {
    for (const [x, y] of poly || []) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const px = w * pad;
  const py = h * pad;
  return { minX: minX - px, minY: 0 - (maxY + py), width: w + 2 * px, height: h + 2 * py };
}

const r2 = (v) => Math.round(v * 100) / 100;

export function svgPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  return `${points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r2(x)} ${r2(y)}`).join(' ')} Z`;
}

function clearanceTag(candidate) {
  if (candidate.clearanceCapped) return { text: 'Clears by > 50 mm', tone: 'muted' };
  if (typeof candidate.clearance !== 'number') return { text: 'clearance unknown', tone: 'muted' };
  const mm = candidate.clearance.toFixed(1);
  if (candidate.clearance < STANDARD_CLEARANCE_MM) return { text: `Clears by ${mm} mm (under 5)`, tone: 'warn' };
  return { text: `Clears by ${mm} mm`, tone: 'ok' };
}

function chartTag(candidate, { press, dieSize, chartBasis }) {
  const verdict = candidate.chart?.verdict ?? (chartBasis === 'no_chart' ? 'no_chart' : null);
  if (verdict === 'allowed') return { text: `Chart: allowed ${press} / ${dieSize}`, tone: 'ok' };
  if (verdict === 'not_allowed') return { text: 'Chart: not allowed', tone: 'no' };
  if (verdict === 'no_chart') return { text: 'Chart: no chart for this press', tone: 'warn' };
  return null;
}

const CONFIDENCE_TONES = { confirmed: 'ok', likely: 'muted', uncertain: 'warn' };

const SOURCE_LABELS = { dxf: 'DXF', 'pdf-vector': 'PDF', 'pdf-raster': 'PDF trace', manual: 'manual entry' };

// Where an opening's geometry came from (tooling_openings.extraction_source), for people.
export function sourceLabel(source) {
  if (source == null || source === '') return 'unknown source';
  return SOURCE_LABELS[source] || String(source);
}

// "opening from DXF (confirmed)": every suggestion says where its geometry came from and
// how sure the extraction was. An uncertain one also says it needs review.
function confidenceTag(candidate) {
  const tone = CONFIDENCE_TONES[candidate.confidence];
  if (!tone) return null;
  const text = `opening from ${sourceLabel(candidate.extractionSource)} (${candidate.confidence})`;
  return { text: candidate.confidence === 'uncertain' ? `${text} — needs review` : text, tone };
}

// Ordered tags for one candidate card: clearance, chart, location, transfer, confidence.
// `skipChart` leaves the chart tag out for a card that states the chart check on its own line.
export function candidateTags(candidate, { press, dieSize, chartBasis, skipChart = false } = {}) {
  const tags = [clearanceTag(candidate)];
  const chart = skipChart ? null : chartTag(candidate, { press, dieSize, chartBasis });
  if (chart) tags.push(chart);
  tags.push(candidate.location ? { text: String(candidate.location), tone: 'muted' } : { text: 'location unknown', tone: 'muted' });
  if (candidate.needsTransfer === true) {
    tags.push({ text: `held at ${(candidate.heldPresses || []).join(', ')}, needs transfer`, tone: 'warn' });
  } else if (candidate.needsTransfer == null) {
    tags.push({ text: 'held press unknown', tone: 'muted' });
  }
  const conf = confidenceTag(candidate);
  if (conf) tags.push(conf);
  return tags;
}

const KIND_LABEL = { insert: 'Insert', bolster: 'Bolster' };

export function candidateMeta(candidate) {
  const kind = KIND_LABEL[candidate.kind] || 'Tooling';
  const size = candidate.sizeClass || 'size unknown';
  const cav = candidate.cavities == null ? 'cav unknown' : `${candidate.cavities} cav`;
  return `${kind} · ${size} · ${cav}`;
}

export function linkedDiesText(candidate, cap = 3) {
  const dies = (candidate.linkedDies || []).map((d) => d.dieNo).filter(Boolean);
  if (dies.length === 0) return 'Not linked to a die';
  const more = dies.length > cap ? ` (+${dies.length - cap} more)` : '';
  return `Currently used by ${dies.slice(0, cap).join(', ')}${more}`;
}

const REASON_TAGS = {
  'not-in-scope': { tag: 'not in scope', tone: 'muted' },
  'no-geometry': { tag: 'no geometry', tone: 'muted' },
  cavities: { tag: 'cavities differ', tone: 'warn' },
  chart: { tag: 'chart: not allowed', tone: 'no' },
};

function similarToolingTag(t) {
  if (REASON_TAGS[t.reason]) return REASON_TAGS[t.reason];
  if (t.inScope === false) return REASON_TAGS['not-in-scope'];
  if (!t.sizeClass) return { tag: 'size unknown', tone: 'muted' };
  return { tag: 'in scope', tone: 'ok' };
}

// "PRESS 6 · 450X250 · 3 cav" from the die-list facts the server attaches to each
// similar item (press, dieSize, cavity); unknown parts are left out, none known → null.
export function similarMeta(item) {
  const text = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  const cav = item?.cavity == null || item.cavity === '' ? null : `${item.cavity} cav`;
  const parts = [text(item?.press), text(item?.dieSize), cav].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// The nearest dies for the strip. `meta` comes from the item's die-list facts; a
// caller's dieMeta(dieNo), when given and it answers, overrides them.
//
// One profile is listed once per press, die size, cavity count and set of toolings: dies of
// the same profile that agree on all four are one card (the nearest die leads, the rest are
// its `otherDies`). A die that differs in any of them keeps its own card.
function sameProfileKey(s) {
  const profile = String(s.profileNumber ?? '').trim().toUpperCase() || `die:${s.dieNo}`;
  const toolings = (s.toolings || []).map((t) => String(t.number)).sort().join(',');
  return JSON.stringify([profile, String(s.press ?? '').trim().toUpperCase(), sizeKey(s.dieSize), s.cavity ?? null, toolings]);
}

function mergeSameProfiles(similar) {
  const byKey = new Map();
  const out = [];
  for (const s of similar || []) {
    const key = sameProfileKey(s);
    const lead = byKey.get(key);
    if (lead) { lead.otherDies.push(s.dieNo); continue; }
    const first = { ...s, otherDies: [] };
    byKey.set(key, first);
    out.push(first);
  }
  return out;
}

export function similarCards(similar, limit = 8, dieMeta = null) {
  return mergeSameProfiles(similar).slice(0, limit).map((s) => ({
    dieNo: s.dieNo,
    otherDies: s.otherDies,
    distance: s.distance,
    cavityMatch: s.cavityMatch ?? null,
    toolings: (s.toolings || []).map((t) => ({
      number: t.number, kind: t.kind, sizeClass: t.sizeClass ?? null, ...similarToolingTag(t),
    })),
    meta: (dieMeta && dieMeta(s.dieNo)) || similarMeta(s),
    ccd: typeof s.ccd === 'number' ? s.ccd : null,
    dieSize: s.dieSize ?? null,
    press: s.press ?? null,
    cavity: s.cavity ?? null,
    outline: s.outline ?? null,
  }));
}

// POST /api/profile-shapes/similar items (die_no, profile_number, …) in the finder's
// `similar` shape, so the similarity-only panel draws the same strip.
export function similarFromItems(items) {
  return (items || []).map((i) => ({
    dieNo: i.die_no,
    profileNumber: i.profile_number ?? null,
    distance: i.distance,
    cavityMatch: i.cavityMatch ?? null,
    trueSize: !!i.trueSize,
    shapeId: i.shapeId ?? null,
    toolings: i.toolings || [],
    dieSize: i.dieSize ?? null,
    press: i.press ?? null,
    cavity: i.cavity ?? null,
    ccd: i.ccd ?? null,
    outline: i.outline ?? null,
  }));
}

const SIMILAR_ONLY_TEXT = {
  'not-in-scope': 'Not in scope (retired, unknown or other plant)',
  'no-geometry': 'Opening not known',
  cavities: 'Cavity count differs',
  chart: 'Chart: not allowed',
};

// Toolings of similar dies that are not candidates, first sighting wins. A null
// reason passed the gates the list reports: it may have failed the fit, ranked below
// the limit, been cut by the 400 cap or failed the pocket count.
export function similarOnlyCards(similar, candidates) {
  const seen = new Set((candidates || []).map((c) => c.number));
  const out = [];
  for (const s of similar || []) {
    for (const t of s.toolings || []) {
      if (seen.has(t.number)) continue;
      seen.add(t.number);
      const why = SIMILAR_ONLY_TEXT[t.reason] || 'Not among the ranked fits';
      out.push({
        number: t.number, kind: t.kind, sizeClass: t.sizeClass ?? null, reason: t.reason ?? null,
        dieNo: s.dieNo, reasonText: `${why} — shown because the shape is similar`,
      });
    }
  }
  return out;
}

const PAIRS = { insert: ['INSERT_NO', 'INSERT_SIZE'], bolster: ['BOLSTER_NO', 'BOLSTER_SIZE'] };

// "Use this": fills exactly the pair for the candidate's kind; the other pair is untouched.
export function applyChoice(values, candidate) {
  const pair = PAIRS[candidate?.kind];
  if (!pair) return { values, chosen: null };
  const [noKey, sizeKey] = pair;
  return {
    values: { ...values, [noKey]: candidate.number, [sizeKey]: candidate.sizeClass || '' },
    chosen: { tooling: candidate.number, kind: candidate.kind, fromFinder: true },
  };
}

const blank = (v) => v == null || String(v).trim() === '';

const UNSCALED = 'profile size unknown — fit needs a scale or CCD';

// Whether Find tooling can run, and the first reason it cannot. An unscaled profile
// (true_size false) cannot be fitted, but its unit-frame outline can still find similar
// dies by shape: with outer_unit present and every other input fine the answer carries
// similarityOnly: true (the button then runs the similarity route only).
export function finderReadiness({ profile, press, dieSize, cavities, plant } = {}) {
  const no = (reason) => ({ ready: false, reason });
  if (!profile) return no('no profile yet');
  let other = null;
  if (blank(press)) other = 'press missing';
  else if (blank(dieSize)) other = 'die size missing';
  else if (!/^\s*[1-9]\d*\s*$/.test(String(cavities ?? ''))) other = 'cavities missing';
  else if (blank(plant)) other = 'plant missing';
  if (profile.true_size === false) {
    const hasUnit = Array.isArray(profile.outer_unit) && profile.outer_unit.length >= 3;
    return hasUnit && !other ? { ready: false, reason: UNSCALED, similarityOnly: true } : no(UNSCALED);
  }
  if (other) return no(other);
  return { ready: true, reason: null };
}

// Gate order; equal counts keep it.
const REJECT_LABELS = [
  ['cavities', 'cavities'], ['cavities-unknown', 'cavities unknown'], ['pocket-count', 'pocket count'],
  ['no-size-class', 'no size class'], ['chart', 'chart'], ['size-prefilter', 'too small'], ['no-fit', 'no fit'],
];

export function rejectedSummary(rejected, truncated) {
  const parts = REJECT_LABELS
    .map(([key, label]) => ({ n: Number(rejected?.[key]) || 0, label }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n);
  const total = parts.reduce((s, p) => s + p.n, 0);
  const line = total ? `${total} rejected: ${parts.map((p) => `${p.n} ${p.label}`).join(', ')}` : '';
  const cap = truncated ? '(capped at 400 candidates)' : '';
  return [line, cap].filter(Boolean).join(' ');
}

const CAVITIES_OK = /^\s*[1-9]\d*\s*$/;

// What Find tooling waits on, one line each, for the order form's tooling pane.
// state: 'ok' | 'todo' (still needed) | 'warn' (usable for similar dies only) | 'busy'.
// `profileNote` is the form's own word on the profile while there is none ("reading the profile…").
export function finderChecklist({ profile, profileNote = '', profileBusy = false, press, dieSize, cavities, plant } = {}) {
  const field = (key, label, value, ok) => ({
    key, label, state: ok ? 'ok' : 'todo', note: ok ? String(value).trim() : 'missing',
  });
  let shape;
  if (!profile) {
    shape = { state: profileBusy ? 'busy' : 'todo', note: profileNote || 'not read yet' };
  } else if (profile.true_size === false) {
    shape = { state: 'warn', note: 'size unknown — similar dies by shape only' };
  } else {
    const ccd = typeof profile.ccd_mm === 'number' ? ` · CCD ${Math.round(profile.ccd_mm)} mm` : '';
    shape = { state: 'ok', note: `true size${ccd}` };
  }
  return [
    field('plant', 'Plant', plant, !blank(plant)),
    field('press', 'Press', press, !blank(press)),
    field('dieSize', 'Die size', dieSize, !blank(dieSize)),
    field('cavities', 'Cavities', cavities, CAVITIES_OK.test(String(cavities ?? ''))),
    { key: 'profile', label: 'Profile shape', ...shape },
  ];
}

// A die size as the tooling chart writes it: "Ø302.5 x 160" and "302.5×160" → "302.5X160".
// Anything that is not diameter × thickness is only trimmed and upper-cased.
const DIE_SIZE_TOKEN = /^(?:∅|Ø|DIA)?\s*(\d+(?:\.\d+)?)\s*[X×]\s*(\d+(?:\.\d+)?)$/;
function sizeKey(raw) { return dieSizeKey(raw); }
export function dieSizeKey(raw) {
  const t = String(raw ?? '').trim().toUpperCase();
  const m = DIE_SIZE_TOKEN.exec(t);
  return m ? `${Number(m[1])}X${Number(m[2])}` : t;
}

// Which of the press's chart sizes a die size value is, however it was typed; null when it
// is blank or not one of them (a custom size).
export function matchDieSize(value, options = []) {
  const key = dieSizeKey(value);
  if (!key) return null;
  return options.find((o) => dieSizeKey(o) === key) ?? null;
}

// ---- what a suggested tooling is: its size, its opening, the chart's word on it ----

// "Ø460 × 150 mm" from the size class "460X150" (diameter × thickness); other text as it is.
export function sizeClassText(sizeClass) {
  const t = String(sizeClass ?? '').trim();
  if (!t) return null;
  const m = DIE_SIZE_TOKEN.exec(t.toUpperCase());
  return m ? `Ø${Number(m[1])} × ${Number(m[2])} mm` : t;
}

// Width × height (mm, whole numbers) of each pocket's bounding box, in the tooling frame.
export function openingSizes(pockets) {
  const out = [];
  for (const poly of pockets || []) {
    if (!Array.isArray(poly) || poly.length < 3) continue;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const [x, y] of poly) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    out.push({ w: Math.round(maxX - minX), h: Math.round(maxY - minY) });
  }
  return out;
}

// "182 × 64 mm", "2 openings, 182 × 64 mm each", or each one listed when they differ.
export function openingText(pockets) {
  const sizes = openingSizes(pockets);
  if (sizes.length === 0) return null;
  const one = (s) => `${s.w} × ${s.h}`;
  if (sizes.length === 1) return `${one(sizes[0])} mm`;
  const same = sizes.every((s) => s.w === sizes[0].w && s.h === sizes[0].h);
  return same ? `${sizes.length} openings, ${one(sizes[0])} mm each` : `${sizes.length} openings: ${sizes.map(one).join(', ')} mm`;
}

// Largest width × height of the profile as it lies (mm): what has to go through the opening.
export function profileSizeText(points) {
  const [s] = openingSizes([points]);
  return s ? `${s.w} × ${s.h} mm` : null;
}

const isHold = (row) => /^hold$/i.test(String(row?.remark || '').trim());
const distinct = (rows, field) => [...new Set(rows.map((r) => r[field]).filter((v) => v != null && v !== ''))]
  .sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }));

// The tooling combination chart's word on one suggestion, in a sentence: whether its size is
// listed for the press with this die size, and what the chart pairs it with.
export function chartCheck(candidate, { press, dieSize, chartBasis } = {}) {
  const verdict = candidate?.chart?.verdict ?? (chartBasis === 'no_chart' ? 'no_chart' : null);
  const kind = candidate?.kind === 'bolster' ? 'Bolster' : 'Insert';
  const size = candidate?.sizeClass || 'of unknown size';
  if (verdict === 'allowed') {
    const other = candidate.kind === 'bolster' ? 'insert_size' : 'bolster_size';
    const pairs = distinct(candidate.chart.rows || [], other);
    const pairWord = candidate.kind === 'bolster' ? 'insert' : 'bolster';
    return {
      tone: 'ok',
      text: `${kind} ${size} is allowed on ${press} for die ${dieSize}`,
      detail: pairs.length ? `The chart pairs it with ${pairWord} ${pairs.join(' or ')}` : null,
    };
  }
  if (verdict === 'not_allowed') {
    return { tone: 'no', text: `${kind} ${size} is not on the chart for ${press} with die ${dieSize}`, detail: null };
  }
  if (verdict === 'no_chart') {
    return { tone: 'warn', text: `Not checked: the chart has no rows for ${press}`, detail: null };
  }
  return null;
}

// What the chart allows for the asked press and die size, for the top of the answer.
// `chart` is the finder's { basis, rowsForDieSize }; rows on HOLD do not count.
export function chartSummary(chart, { press, dieSize } = {}) {
  if (!chart) return null;
  if (chart.basis === 'no_chart') {
    return { tone: 'warn', text: `The tooling combination chart has no rows for ${press}, so tooling sizes were not checked against it.` };
  }
  const rows = (chart.rowsForDieSize || []).filter((r) => !isHold(r));
  if (rows.length === 0) {
    return {
      tone: 'no',
      text: `Die size ${dieSize} is not on the tooling combination chart for ${press}, so the chart allows no insert or bolster for it.`,
    };
  }
  const inserts = distinct(rows, 'insert_size');
  const bolsters = distinct(rows, 'bolster_size');
  const parts = [
    inserts.length ? `insert ${inserts.join(', ')}` : null,
    bolsters.length ? `bolster ${bolsters.join(', ')}` : null,
  ].filter(Boolean);
  return { tone: 'ok', text: `Chart for ${press} with die ${dieSize} allows ${parts.join(' · ')}.`, inserts, bolsters };
}
