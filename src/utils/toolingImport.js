// Pure helpers for the Toolings page's mass import: reading a spreadsheet's rows, batching the requests, summarising
// the preview and writing the result report.

const FIELD_ALIASES = {
  number: ['number', 'tooling number', 'tooling no', 'tooling', 'tooling code', 'insert number', 'insert no', 'insert',
    'bolster number', 'bolster no', 'bolster', 'insert bolster no', 'code', 'no'],
  plant: ['plant'],
  kind: ['kind', 'type', 'tooling type'],
  sizeClass: ['size class', 'size', 'tooling size', 'insert size', 'bolster size', 'dia x thk', 'dia x thickness'],
  cavities: ['cavities', 'cavity', 'cav', 'no of cavities', 'no of cavity', 'cavity no'],
  location: ['location', 'rack', 'store', 'storage', 'storage location'],
  notes: ['notes', 'note', 'remarks', 'remark', 'comments', 'comment'],
};
export const IMPORT_FIELDS = Object.keys(FIELD_ALIASES);
export const FIELD_LABELS = { number: 'Number', plant: 'Plant', kind: 'Kind', sizeClass: 'Size class', cavities: 'Cavities', location: 'Location', notes: 'Notes' };

// "Insert No." / "INSERT_NO" / " insert  no " all compare as "insert no".
const headerKey = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cellText = (v) => (v == null ? '' : String(v).trim());

function fieldOfHeader(header) {
  const key = headerKey(header);
  if (!key) return null;
  return IMPORT_FIELDS.find((f) => FIELD_ALIASES[f].includes(key)) || null;
}

// Rows of a sheet given as an array of arrays (what XLSX.utils.sheet_to_json(ws, { header: 1 }) returns).
// The header row is the first of the top 15 rows that has a number column; the first column that matches a field
// wins. Returns { rows, columns: { field: header }, ignored: [headers], headerRow, error }.
export function sheetToRows(aoa) {
  const grid = Array.isArray(aoa) ? aoa : [];
  let headerRow = -1;
  let map = null;
  for (let r = 0; r < Math.min(grid.length, 15); r += 1) {
    const candidate = {};
    (grid[r] || []).forEach((cell, c) => {
      const field = fieldOfHeader(cell);
      if (field && candidate[field] === undefined) candidate[field] = c;
    });
    if (candidate.number !== undefined) { headerRow = r; map = candidate; break; }
  }
  if (!map) {
    return { rows: [], columns: {}, ignored: [], headerRow: -1, error: 'No column for the tooling number was found. Name it "Number", "Tooling No", "Insert No" or "Bolster No".' };
  }
  const header = grid[headerRow] || [];
  const used = new Set(Object.values(map));
  const columns = Object.fromEntries(Object.entries(map).map(([field, c]) => [field, cellText(header[c])]));
  const ignored = header.map((h, c) => (used.has(c) ? '' : cellText(h))).filter(Boolean);

  const rows = [];
  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const line = grid[r] || [];
    const row = { line: r + 1 };
    for (const [field, c] of Object.entries(map)) row[field] = cellText(line[c]);
    if (!row.number) continue; // blank and sub-total lines
    rows.push(row);
  }
  return { rows, columns, ignored, headerRow, error: rows.length ? null : 'The sheet has a number column but no rows under it.' };
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const DRAWING_EXT = /\.(dxf|pdf|dwg)$/i;
// The files of a picked folder that can be drawings; everything else (Thumbs.db, xlsx) is left out silently.
export const drawingFilesOf = (files) => Array.from(files || []).filter((f) => DRAWING_EXT.test(f.name) && !f.name.startsWith('~$'));

// Counts for the preview. `createMissing` decides whether a drawing of an unknown tooling is imported or left.
export function summarisePlan(plan, { createMissing = false } = {}) {
  const rows = (plan && plan.rows) || [];
  const files = (plan && plan.files) || [];
  const count = (list, pred) => list.filter(pred).length;
  const s = {
    rowsCreate: count(rows, (r) => r.action === 'create'),
    rowsFill: count(rows, (r) => r.action === 'fill'),
    rowsSame: count(rows, (r) => r.action === 'same'),
    rowsError: count(rows, (r) => r.action === 'error'),
    rowsKept: count(rows, (r) => (r.kept || []).length > 0),
    filesAttach: count(files, (f) => f.state === 'attach'),
    filesNew: count(files, (f) => f.state === 'new'),
    filesLookup: count(files, (f) => f.state === 'lookup'),
    filesLeft: count(files, (f) => !['attach', 'new', 'lookup'].includes(f.state)),
  };
  s.filesToSend = s.filesAttach + s.filesLookup + (createMissing ? s.filesNew : 0);
  s.rowsToSend = s.rowsCreate + s.rowsFill;
  s.nothingToDo = s.rowsToSend + s.filesToSend === 0;
  return s;
}

export const ROW_ACTION_LABEL = { create: 'Add', fill: 'Fill blanks', same: 'No change', error: 'Problem' };
export const FILE_STATE_LABEL = { attach: 'Attach', new: 'New tooling', lookup: 'Look inside', skipped: 'Left out', convert: 'Convert first', unsupported: 'Not a drawing' };

// Whether a planned drawing is sent to the server: known toolings and no-number names always, a recognised drawing
// of an unknown tooling only when the person asked for those toolings to be added.
export const isSent = (f, { createMissing = false } = {}) => f.state === 'attach' || f.state === 'lookup' || (f.state === 'new' && createMissing);

// What a preview row says in its detail cell.
export function rowDetail(r) {
  if (r.action === 'error') return r.message || 'cannot be imported';
  const parts = [];
  if (r.action === 'create') parts.push(`${r.kind || 'tooling'} · ${r.plant || ''}`.trim());
  if ((r.fills || []).length) parts.push(`fills ${r.fills.join(', ')}`);
  if ((r.kept || []).length) parts.push(`keeps ${r.kept.join('; ')}`);
  return parts.join(' — ') || 'already in the master with these values';
}

export function fileDetail(f, { createMissing = false } = {}) {
  if (f.state === 'attach') return `to ${f.number}`;
  if (f.state === 'new') return createMissing ? `adds ${f.number} (${f.kind}, ${f.plant}) and attaches` : `${f.number} is not in the master — left out`;
  return f.message || '';
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// The run report: one line per sheet row and per drawing, as CSV text.
export function reportCsv({ rows = [], files = [] } = {}) {
  const lines = [['Item', 'Tooling', 'Result', 'Details']];
  for (const r of rows) lines.push(['Sheet row', r.number || '', r.action === 'error' ? 'Problem' : ROW_ACTION_LABEL[r.action] || r.action, rowDetail(r)]);
  for (const f of files) lines.push([f.name, f.number || '', f.result || '', f.detail || '']);
  return lines.map((l) => l.map(csvCell).join(',')).join('\r\n');
}

// One drawing's line in the results, from the server's answer.
export function drawingOutcome(name, answer) {
  const parts = [`opening ${answer.extracted === 'none' ? 'not found' : answer.extracted}`];
  if (answer.openingKept) parts.push('reviewed opening kept');
  if (answer.basis === 'drawing-text') parts.push('number read from the drawing');
  if ((answer.filled || []).length) parts.push(`filled ${answer.filled.join(', ')}`);
  return { name, number: answer.number, ok: true, result: answer.created ? 'Added with drawing' : 'Attached', detail: parts.join(' · '), extracted: answer.extracted };
}

export const TEMPLATE_CSV = [
  'Number,Plant,Kind,Size class,Cavities,Location,Notes',
  'I-21599,GEX 1,insert,175X80,1,Rack 4,',
  '25IC2-090454,GEX 2,insert,300X100,2,,',
  'BOL-4-6-B,GEX 1,bolster,475X220,,,',
].join('\r\n');
