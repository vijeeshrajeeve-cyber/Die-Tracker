// Pure view helpers for the Toolings page: review-queue labels, confidence pill
// tones, the merged review queue (openings + flagged profile pictures) and the
// list route's query params.

const REASON_LABELS = {
  unverified: 'Unverified number',
  'no-opening': 'No drawing opening',
  'no-pockets': 'Opening not known',
  uncertain: 'Opening uncertain',
  'no-size-class': 'Size class unknown',
};

// Tooling queue reasons get a label; a profile's free-text review_reason passes through.
export function reviewReasonLabel(reason) {
  if (reason == null || String(reason).trim() === '') return 'Needs review';
  return REASON_LABELS[reason] || String(reason);
}

// Admins, or users with the tooling review switch (the JWT's canReviewToolings).
export const isToolingReviewer = (user) => user?.role === 'admin' || !!user?.canReviewToolings;

export const statusTone = (status) => (status === 'active' ? 'ok' : status === 'unverified' ? 'warn' : 'muted');

// Pill tone for an opening or size-class confidence: ok / muted / warn / no.
export function confidenceTone(confidence) {
  if (confidence === 'confirmed') return 'ok';
  if (confidence === 'likely') return 'muted';
  if (confidence === 'uncertain') return 'warn';
  return 'no';
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const KIND_LABEL = { insert: 'Insert', bolster: 'Bolster' };

function openingRow(o) {
  const drawings = Number(o.drawing_count) || 0;
  return {
    kind: 'opening',
    key: `opening:${o.number}`,
    plant: o.plant || null,
    title: o.number,
    reason: reviewReasonLabel(o.reason),
    subtitle: [
      KIND_LABEL[o.kind] || 'Tooling',
      o.size_class || 'size unknown',
      drawings ? plural(drawings, 'drawing') : 'no drawing',
    ].join(' · '),
    updatedAt: o.updated_at || null,
    raw: o,
  };
}

function profileRow(p) {
  const holes = Number(p.hole_count) || 0;
  return {
    kind: 'profile',
    key: `profile:${p.id}`,
    plant: p.plant || null,
    title: p.die_no,
    reason: reviewReasonLabel(p.review_reason),
    subtitle: [
      p.profile_number ? `Profile ${p.profile_number}` : null,
      p.source,
      p.style || null,
      plural(holes, 'hole'),
    ].filter(Boolean).join(' · '),
    updatedAt: p.updated_at || null,
    raw: p,
  };
}

// One list: dated rows newest first, then undated rows in the order the server sent them.
export function queueRowsFromApi(openings, profiles) {
  const rows = [...(openings || []).map(openingRow), ...(profiles || []).map(profileRow)];
  const time = (r) => (r.updatedAt ? new Date(r.updatedAt).getTime() : NaN);
  const dated = rows.filter((r) => Number.isFinite(time(r))).sort((a, b) => time(b) - time(a));
  const undated = rows.filter((r) => !Number.isFinite(time(r)));
  return [...dated, ...undated].map((r) => {
    const out = { ...r };
    delete out.updatedAt;
    return out;
  });
}

// The list route takes plant, press, kind, sizeClass, status, q, limit, offset. It has no
// confidence filter, so confidence stays client-side (see matchesConfidence).
const SERVER_PARAMS = ['plant', 'press', 'kind', 'sizeClass', 'status', 'q', 'limit', 'offset'];
export function filtersToParams(filters = {}) {
  const out = {};
  for (const key of SERVER_PARAMS) {
    const v = filters[key];
    if (v == null) continue;
    const s = String(v).trim();
    if (s !== '') out[key] = s;
  }
  return out;
}

export function matchesConfidence(row, confidence) {
  if (!confidence) return true;
  return (row.opening_confidence || 'none') === confidence;
}

// A hint only: insert numbers start I- or NNIC; the person can change it.
export function inferKind(number) {
  const s = String(number || '').trim().toUpperCase();
  if (!s) return '';
  return /^(I-|\d{2}IC)/.test(s) ? 'insert' : 'bolster';
}

// The Add tooling POST body. The kind is sent only when the person picked one
// (kindTouched): the guess from inferKind is a display hint, and the server parses the
// number itself, so an untouched guess never overrides it (a typo would store the wrong kind).
export function addToolingBody(form, { kindTouched = false } = {}) {
  const trim = (v) => String(v ?? '').trim();
  const body = { number: trim(form.number) };
  for (const k of ['plant', 'sizeClass', 'location', 'notes']) if (trim(form[k])) body[k] = trim(form[k]);
  if (kindTouched && trim(form.kind)) body.kind = trim(form.kind);
  if (trim(form.cavities)) body.cavities = Number(trim(form.cavities));
  return body;
}

const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

// The pasted pocket correction: [[[x,y],...],...] in mm. Returns { pockets, error }.
export function parsePocketsJson(text) {
  let value;
  try {
    value = JSON.parse(String(text || ''));
  } catch {
    return { pockets: null, error: 'The pockets are not valid JSON.' };
  }
  if (!Array.isArray(value) || value.length === 0) {
    return { pockets: null, error: 'Give at least one pocket: [[[x,y],[x,y],[x,y]], ...].' };
  }
  for (let i = 0; i < value.length; i += 1) {
    const poly = value[i];
    if (!Array.isArray(poly) || poly.length < 3 || !poly.every(isPair)) {
      return { pockets: null, error: `Pocket ${i + 1} needs at least 3 [x, y] pairs of numbers.` };
    }
  }
  return { pockets: value, error: null };
}
