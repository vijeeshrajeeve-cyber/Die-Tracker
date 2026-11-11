'use strict';
// Mass import of toolings from the Toolings page: a list of rows (a spreadsheet read in the browser) and a pile of
// drawing files. Rows add toolings and fill the blanks of existing ones - a value already in the master is never
// overwritten. A drawing is filed under the tooling its file name stands for (the drawing-archive rules), or, when
// the name says nothing, under the one tooling number written in the drawing itself.
// Every function takes the database `client`; errors meant for the caller carry an HTTP `status`.
const { parseToolingNumber, normalizeSizeClass } = require('./toolingNumbers.cjs');
const { interpretStem } = require('./archiveMatcher.cjs');
const { formatOf } = require('./toolingDrawings.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');
// Called through the module objects so a test can stub them.
const review = require('./toolingReview.cjs');
const toolingFinder = require('./toolingFinder.cjs');

const httpError = (status, message) => Object.assign(new Error(message), { status });

const PLANTS = new Set(['GEX 1', 'GEX 2']);
const SIZE_CLASS = /^\d+(?:\.\d+)?X\d+(?:\.\d+)?$/;
const KIND_WORDS = { insert: 'insert', inserts: 'insert', ins: 'insert', i: 'insert', bolster: 'bolster', bolsters: 'bolster', bol: 'bolster', b: 'bolster' };
const MAX_ROWS = 500;
const MAX_FILES = 2000;
const UPLOADABLE = new Set(['dxf', 'pdf']);
const SKIP_LABEL = {
  scrap: 'marked scrap in its name',
  'press-part': 'a press part, not an insert or bolster',
  unrecognised: 'no tooling number in the file name',
};

const clean = (v) => (v == null ? '' : String(v).trim());
const blank = (v) => v == null || String(v).trim() === '';

function plantOf(raw) {
  if (blank(raw)) return null;
  const p = normalizePlant(raw);
  return PLANTS.has(p) ? p : undefined; // undefined: given but not a plant
}

// One sheet row -> { number, kind, plant, sizeClass, cavities, location, notes } or { error }.
function normaliseRow(raw, { defaultPlant = null } = {}) {
  const r = raw || {};
  if (blank(r.number)) return { error: 'no tooling number' };
  const parsed = parseToolingNumber(r.number);
  if (!parsed.canonical || (parsed.kind !== 'insert' && parsed.kind !== 'bolster')) {
    return { error: `"${clean(r.number)}" is not an insert or bolster number` };
  }
  let kind = null;
  if (!blank(r.kind)) {
    kind = KIND_WORDS[clean(r.kind).toLowerCase()] || null;
    if (!kind) return { number: parsed.canonical, error: `kind "${clean(r.kind)}" is not insert or bolster` };
    if (kind !== parsed.kind) return { number: parsed.canonical, error: `kind ${kind} contradicts the number, which is ${parsed.kind === 'insert' ? 'an insert' : 'a bolster'}` };
  }
  const given = plantOf(r.plant);
  if (given === undefined) return { number: parsed.canonical, error: `plant "${clean(r.plant)}" is not GEX 1 or GEX 2` };
  const plant = given || parsed.plant || plantOf(defaultPlant) || null;
  if (!plant) return { number: parsed.canonical, error: 'plant is needed (the number does not say which)' };

  let sizeClass = null;
  if (!blank(r.sizeClass)) {
    sizeClass = normalizeSizeClass(r.sizeClass);
    if (!sizeClass || !SIZE_CLASS.test(sizeClass)) return { number: parsed.canonical, error: `size "${clean(r.sizeClass)}" must look like 175X80 (diameter X thickness)` };
  }
  let cavities = null;
  if (!blank(r.cavities)) {
    const n = Number(clean(r.cavities));
    if (!Number.isInteger(n) || n <= 0) return { number: parsed.canonical, error: `cavities "${clean(r.cavities)}" must be a whole number above 0` };
    cavities = n;
  }
  return {
    number: parsed.canonical, kind: parsed.kind, plant, sizeClass, cavities: cavities ?? parsed.cavities ?? null,
    location: clean(r.location) || null, notes: clean(r.notes) || null,
  };
}

const MASTER_FIELDS = [['sizeClass', 'size_class', 'size class'], ['cavities', 'cavities', 'cavities'],
  ['location', 'location', 'location'], ['notes', 'notes', 'notes']];
const same = (a, b) => String(a).trim().toUpperCase() === String(b).trim().toUpperCase();

// What a normalised row would do to the master: add the tooling, fill some of its blanks, or nothing.
// `kept` lists the fields where the master already holds a different value (it stays).
function decide(row, existing) {
  if (!existing) return { action: 'create', fills: [], kept: [] };
  const fills = [];
  const kept = [];
  for (const [key, column, label] of MASTER_FIELDS) {
    if (blank(row[key])) continue;
    if (blank(existing[column])) fills.push(label);
    else if (!same(existing[column], row[key])) kept.push(`${label} ${existing[column]} (sheet: ${row[key]})`);
  }
  if (existing.plant && row.plant && existing.plant !== row.plant) kept.push(`plant ${existing.plant} (sheet: ${row.plant})`);
  return { action: fills.length ? 'fill' : 'same', fills, kept };
}

async function existingByNumber(client, numbers) {
  const map = new Map();
  const list = [...new Set(numbers.filter(Boolean))];
  if (!list.length) return map;
  const res = await client.query(
    'SELECT id, number, kind, plant, size_class, cavities, location, notes, status FROM toolings WHERE number = ANY($1)', [list]);
  for (const t of res.rows) map.set(t.number, t);
  return map;
}

// The preview of a row import; writes nothing. One answer per row, in order.
async function planRows(client, rows, opts = {}) {
  if (!Array.isArray(rows)) throw httpError(400, 'rows must be a list');
  if (rows.length > MAX_ROWS) throw httpError(400, `at most ${MAX_ROWS} rows per request`);
  const norm = rows.map((r) => normaliseRow(r, opts));
  const existing = await existingByNumber(client, norm.map((n) => n.number));
  const seen = new Set();
  return norm.map((n) => {
    if (n.error) return { number: n.number || null, action: 'error', message: n.error };
    if (seen.has(n.number)) return { number: n.number, action: 'error', message: 'listed more than once; only the first row counts' };
    seen.add(n.number);
    const d = decide(n, existing.get(n.number));
    return { number: n.number, kind: n.kind, plant: n.plant, action: d.action, fills: d.fills, kept: d.kept };
  });
}

// Applies rows one by one; a row that fails does not stop the rest. One answer per row, in order.
async function applyRows(client, rows, opts = {}) {
  if (!Array.isArray(rows)) throw httpError(400, 'rows must be a list');
  if (rows.length > MAX_ROWS) throw httpError(400, `at most ${MAX_ROWS} rows per request`);
  const out = [];
  const seen = new Set();
  const plants = new Set();
  for (const raw of rows) {
    const n = normaliseRow(raw, opts);
    if (n.error) { out.push({ number: n.number || null, action: 'error', message: n.error }); continue; }
    if (seen.has(n.number)) { out.push({ number: n.number, action: 'error', message: 'listed more than once; only the first row counts' }); continue; }
    seen.add(n.number);
    try {
      const existing = (await existingByNumber(client, [n.number])).get(n.number);
      const d = decide(n, existing);
      if (d.action === 'create') {
        await review.createTooling(client, {
          number: n.number, kind: n.kind, plant: n.plant, sizeClass: n.sizeClass, cavities: n.cavities,
          location: n.location, notes: n.notes, userId: opts.userId,
        });
      } else if (d.action === 'fill') {
        // Blanks only, checked again in the statement itself: a value written meanwhile is kept.
        await client.query(
          `UPDATE toolings SET
             size_class_source = CASE WHEN size_class IS NULL AND $2::text IS NOT NULL THEN 'manual' ELSE size_class_source END,
             size_class_confidence = CASE WHEN size_class IS NULL AND $2::text IS NOT NULL THEN 'confirmed' ELSE size_class_confidence END,
             size_class = COALESCE(size_class, $2),
             cavities = COALESCE(cavities, $3),
             location = COALESCE(NULLIF(trim(location), ''), $4),
             notes = COALESCE(NULLIF(trim(notes), ''), $5),
             updated_at = CURRENT_TIMESTAMP
           WHERE number = $1`,
          [n.number, n.sizeClass, n.cavities, n.location, n.notes]);
        plants.add(existing.plant);
      }
      out.push({ number: n.number, kind: n.kind, plant: n.plant, action: d.action, fills: d.fills, kept: d.kept });
    } catch (err) {
      if (!err || !err.status) console.error('tooling import: row failed', n.number, err);
      out.push({ number: n.number, action: 'error', message: err && err.status ? err.message : 'could not be saved' });
    }
  }
  for (const p of plants) toolingFinder.invalidate(p);
  return out;
}

const KIND_HINTS = new Set(['insert', 'bolster']);

// The tooling a drawing file name stands for: { number, kind, plant, sizeClass } or { skip }.
// bareNumbers ('insert' | 'bolster' | null) says what a name that is only a number means.
function targetFromName(fileName, { defaultPlant = null, bareNumbers = null } = {}) {
  const name = clean(fileName).split(/[\\/]/).pop();
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const plant = plantOf(defaultPlant) || 'GEX 1';
  const m = interpretStem(stem, { plant, kindHint: KIND_HINTS.has(bareNumbers) ? bareNumbers : null });
  if (!m.skip) return { number: m.toolingNumber, kind: m.kind, plant: m.plant, sizeClass: m.sizeClass || null };
  if (m.skip === 'unrecognised') {
    // A file named exactly as a tooling number (I-2B, BOL-T-M450X260).
    const p = parseToolingNumber(stem.replace(/_/g, '-'));
    if (p.canonical && KIND_HINTS.has(p.kind)) return { number: p.canonical, kind: p.kind, plant: p.plant || plant, sizeClass: null };
  }
  return { skip: m.skip };
}

// The preview for a list of drawing file names; writes nothing. `sheetNumbers` are the canonical numbers the sheet
// being imported with them will add. States: attach (tooling known), new (recognised, not in the master), lookup
// (no number in the name), skipped (scrap, press part), convert (DWG), unsupported.
async function planDrawings(client, names, opts = {}) {
  if (!Array.isArray(names)) throw httpError(400, 'files must be a list of names');
  if (names.length > MAX_FILES) throw httpError(400, `at most ${MAX_FILES} file names per request`);
  const inSheet = new Set(opts.sheetNumbers || []);
  const targets = names.map((name) => {
    const format = formatOf(clean(name));
    if (format === 'dwg') return { name, state: 'convert', message: 'DWG: convert to DXF first' };
    if (!UPLOADABLE.has(format)) return { name, state: 'unsupported', message: 'not a .dxf or .pdf drawing' };
    const t = targetFromName(name, opts);
    if (!t.skip) return { name, ...t };
    // A name with no number is still sent: the drawing may name its tooling in its own text.
    if (t.skip === 'unrecognised') return { name, state: 'lookup', message: 'no tooling number in the name — looked up in the drawing' };
    return { name, state: 'skipped', reason: t.skip, message: SKIP_LABEL[t.skip] || t.skip };
  });
  const existing = await existingByNumber(client, targets.map((t) => t.number));
  return targets.map((t) => {
    if (t.state) return t;
    const known = existing.has(t.number) || inSheet.has(t.number);
    return { ...t, state: known ? 'attach' : 'new' };
  });
}

const SIZE_IN_NUMBER = /\d{3,4}X\d{2,3}/;

// Files one drawing: finds its tooling (the given number, else the file name, else the drawing's own text), adds the
// tooling when asked to and it is missing, stores the drawing and reads its opening.
async function importDrawing(client, {
  buffer, originalName, number = null, defaultPlant = null, bareNumbers = null, createMissing = false, userId = null, root, io,
}) {
  const format = formatOf(originalName);
  if (!UPLOADABLE.has(format)) throw httpError(400, 'Only .dxf and .pdf drawings can be uploaded');

  let target = null;
  let basis = 'file-name';
  if (!blank(number)) {
    const p = parseToolingNumber(number);
    if (!p.canonical || !KIND_HINTS.has(p.kind)) throw httpError(400, `"${clean(number)}" is not an insert or bolster number`);
    target = { number: p.canonical, kind: p.kind, plant: p.plant || plantOf(defaultPlant) || null, sizeClass: null };
    basis = 'given';
  } else {
    const t = targetFromName(originalName, { defaultPlant, bareNumbers });
    if (!t.skip) target = t;
    else if (t.skip !== 'unrecognised') throw httpError(422, `Not imported: ${SKIP_LABEL[t.skip]}`);
  }
  if (!target) {
    // The name says nothing: the drawing may name its tooling itself.
    let read;
    try {
      read = await review.extractForUpload({ buffer, format, hints: {} });
    } catch (err) {
      throw httpError(422, `Could not read the drawing: ${err.message}`);
    }
    const named = (read.numbersInDrawing || []).filter((n) => !SIZE_IN_NUMBER.test(n));
    if (named.length !== 1) {
      throw httpError(422, named.length
        ? `The file name has no tooling number and the drawing names several (${named.slice(0, 4).join(', ')})`
        : 'No tooling number in the file name or in the drawing');
    }
    const p = parseToolingNumber(named[0]);
    target = { number: p.canonical, kind: p.kind, plant: p.plant || plantOf(defaultPlant) || null, sizeClass: null };
    basis = 'drawing-text';
  }

  const find = async () => (await client.query('SELECT * FROM toolings WHERE number = $1', [target.number])).rows[0] || null;
  let tooling = await find();
  let created = false;
  if (!tooling) {
    if (!createMissing) throw httpError(404, `${target.number} is not in the tooling master`);
    try {
      await review.createTooling(client, {
        number: target.number, kind: target.kind, plant: target.plant, sizeClass: target.sizeClass, userId,
        notes: `added with drawing ${clean(originalName)}`,
      });
      created = true;
    } catch (err) {
      if (!err || err.status !== 409) throw err; // 409: another upload of the same batch added it first
    }
    tooling = await find();
    if (!tooling) throw httpError(500, `Could not add ${target.number}`);
  }

  const out = await review.attachDrawing(client, tooling, { buffer, originalName, root, io, fillMaster: true });
  return {
    number: tooling.number, created, basis, openingKept: out.openingKept,
    confidence: out.opening ? out.opening.confidence : 'none',
    extracted: out.extraction.confidence, notes: out.extraction.notes, filled: out.filled || [],
  };
}

module.exports = {
  MAX_ROWS, MAX_FILES, normaliseRow, decide, planRows, applyRows, targetFromName, planDrawings, importDrawing,
};
