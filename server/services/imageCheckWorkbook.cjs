'use strict';
// Reads the image-check workbook (.xlsx) without a spreadsheet library: sheet index, shared
// strings, rows and picture anchors straight from the zip's XML parts. The sheets are large
// (tens of MB), so rows are walked with a global regex rather than a DOM.
const path = require('node:path').posix;

const decodeXml = (s) => s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (m, hex, dec, name) => {
  if (hex) return String.fromCodePoint(parseInt(hex, 16));
  if (dec) return String.fromCodePoint(Number(dec));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
});

const attrsOf = (s) => {
  const out = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodeXml(m[2]);
  return out;
};

const text = (zip, name) => zip.read(name).toString('utf8');

// Relationship target -> zip entry name, relative to the part that owns the rels.
const resolveTarget = (ownerPath, target) => (target.startsWith('/')
  ? target.slice(1)
  : path.normalize(path.join(path.dirname(ownerPath), target)));

const relsPathOf = (partPath) => path.join(path.dirname(partPath), '_rels', `${path.basename(partPath)}.rels`);

// Map<Id, { type, target: zip entry name }> for a part; empty when the part has no rels.
function readRels(zip, partPath) {
  const relsPath = relsPathOf(partPath);
  const rels = new Map();
  if (!zip.entries.has(relsPath)) return rels;
  for (const m of text(zip, relsPath).matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrsOf(m[1]);
    if (a.TargetMode === 'External') continue;
    rels.set(a.Id, { type: a.Type || '', target: resolveTarget(partPath, a.Target) });
  }
  return rels;
}

function readSheetIndex(zip) {
  const wbPath = 'xl/workbook.xml';
  const wbRels = readRels(zip, wbPath);
  const index = new Map();
  for (const m of text(zip, wbPath).matchAll(/<sheet\b([^>]*?)\/?>/g)) {
    const a = attrsOf(m[1]);
    const rel = wbRels.get(a['r:id']);
    if (!rel) continue;
    const drawing = [...readRels(zip, rel.target).values()].find((r) => /\/drawing$/.test(r.type));
    index.set(a.name, { sheetPath: rel.target, drawingPath: drawing ? drawing.target : null });
  }
  return index;
}

// Concatenated <t> runs of a string item, phonetic (<rPh>) runs excluded.
const stringItem = (xml) => {
  let s = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?(?:\/>|>([^<]*)<\/t>)/g)) s += m[1] || '';
  return decodeXml(s);
};

function readSharedStrings(zip) {
  const name = 'xl/sharedStrings.xml';
  if (!zip.entries.has(name)) return [];
  return [...text(zip, name).matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => stringItem(m[1] || ''));
}

function cellValue(attrs, body, sharedStrings) {
  if (attrs.t === 'inlineStr') {
    const is = /<is>([\s\S]*?)<\/is>/.exec(body);
    return is ? stringItem(is[1]) : '';
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(body);
  if (!v) return '';
  if (attrs.t === 's') return sharedStrings[Number(v[1])] ?? '';
  return decodeXml(v[1]);
}

// Yields { row, cells: { A: '…', … } } per <row>; empty cells are left out.
function* readRows(zip, sheetPath, sharedStrings) {
  const xml = text(zip, sheetPath);
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let prev = 0;
  for (let m = rowRe.exec(xml); m; m = rowRe.exec(xml)) {
    const ra = attrsOf(m[1]);
    const row = ra.r ? Number(ra.r) : prev + 1;
    prev = row;
    const cells = {};
    if (m[2]) {
      let prevCol = 0;
      for (const c of m[2].matchAll(cellRe)) {
        const a = attrsOf(c[1]);
        const col = a.r ? a.r.replace(/\d+$/, '') : colName(prevCol + 1);
        prevCol = colNumber(col);
        const value = cellValue(a, c[2] || '', sharedStrings);
        if (value !== '') cells[col] = value;
      }
    }
    yield { row, cells };
  }
}

const colNumber = (col) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// Pictures in document order: the anchor's from-row (zero-based in the XML) as a 1-based sheet
// row, the media part its blip embeds, and the picture's name. Anchors without a picture
// (shapes, charts) are skipped.
function readPictureAnchors(zip, drawingPath) {
  const rels = readRels(zip, drawingPath);
  const anchors = [];
  const anchorRe = /<(?:\w+:)?(twoCellAnchor|oneCellAnchor)\b[^>]*>([\s\S]*?)<\/(?:\w+:)?\1>/g;
  for (const m of text(zip, drawingPath).matchAll(anchorRe)) {
    const from = /<(?:\w+:)?from>[\s\S]*?<(?:\w+:)?row>(\d+)<\/(?:\w+:)?row>/.exec(m[2]);
    const blip = /<(?:\w+:)?blip\b[^>]*?\br:embed="([^"]+)"/.exec(m[2]);
    if (!from || !blip || !rels.has(blip[1])) continue;
    const cNvPr = /<(?:\w+:)?cNvPr\b([^>]*?)\/?>/.exec(m[2]);
    anchors.push({
      row: Number(from[1]) + 1,
      mediaPath: rels.get(blip[1]).target,
      name: cNvPr ? attrsOf(cNvPr[1]).name || null : null,
    });
  }
  return anchors;
}

const val = (s) => {
  const t = s == null ? '' : String(s).trim();
  return t === '' ? null : t;
};

// GEX1: A IDProfile, B IDDie, C IDDieType, E picture, F verdict, G image-check note, H inspector.
const parseGex1Row = (c) => ({
  profileNumber: val(c.A), dieNo: val(c.B), dieType: val(c.C), verdict: val(c.F), note: val(c.G),
});

// GEX2: A IDProfile, B IDDie, C IDDieType, D IDStatus, E picture (or 'Image not found'), F inspector.
const parseGex2Row = (c) => ({
  profileNumber: val(c.A), dieNo: val(c.B), dieType: val(c.C), status: val(c.D),
});

// The image-check note (GEX1 column G): mismatch, missing, blank and unclear notes need review.
function reviewFromNote(note) {
  const n = val(note);
  if (!n) return { needsReview: false, reason: null };
  if (/^mismatch/i.test(n) || /^no image/i.test(n) || /\b(blank|unclear)\b/i.test(n)) return { needsReview: true, reason: n };
  return { needsReview: false, reason: null };
}

module.exports = {
  readSheetIndex, readSharedStrings, readRows, readPictureAnchors, parseGex1Row, parseGex2Row, reviewFromNote,
};
