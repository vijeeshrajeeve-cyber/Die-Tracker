'use strict';
// Parsers for the die shop's tooling inventory workbooks, and the upsert for the toolings table.
// Pure: no database, no file access. Blocks are located by their header text, never by a fixed stride.
const { parseToolingNumber, normalizeSizeClass, pressFromGex2Location } = require('./toolingNumbers.cjs');

const text = (v) => (v == null ? '' : String(v).trim());

function mergeToolingRows(rows) {
  const byNumber = new Map();
  for (const r of rows) {
    const prev = byNumber.get(r.number);
    if (!prev) { byNumber.set(r.number, { ...r, held_presses: [...r.held_presses] }); continue; }
    for (const p of r.held_presses) if (!prev.held_presses.includes(p)) prev.held_presses.push(p);
    prev.held_presses.sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10));
    if (prev.size_class == null && r.size_class != null) {
      prev.size_class = r.size_class;
      prev.size_class_source = r.size_class_source;
      prev.size_class_confidence = r.size_class_confidence;
    }
    for (const k of ['cavities', 'category', 'location', 'made_for_die', 'inventory_dims']) {
      if (prev[k] == null && r[k] != null) prev[k] = r[k];
    }
  }
  return [...byNumber.values()];
}

function blockTitle(raw) {
  return text(raw)
    .replace(/^\d+\s*MN\s+PRESS\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

function pressFromSheetName(sheetName) {
  const s = text(sheetName).toUpperCase();
  if (s.startsWith('25MN')) return 'PRESS 7';
  if (s.startsWith('35MN')) return 'PRESS 8';
  return null;
}

function parseGex2InventorySheet(rows, { sheetName = '', onSkip = () => {} } = {}) {
  const titleRow = rows[0] || [];
  const headerRow = rows[1] || [];
  const out = [];
  for (let c = 0; c < headerRow.length; c++) {
    const header = text(headerRow[c]).toLowerCase();
    if (header !== 'insert no' && header !== 'bolster no') continue; // Ring No and others are not read
    let t = c;
    while (t >= 0 && !text(titleRow[t])) t--;
    const category = t >= 0 ? blockTitle(titleRow[t]) : '';
    if (/INSERT HOLDER/i.test(category)) continue;
    const isBolsterBlock = header === 'bolster no';
    for (let r = 2; r < rows.length; r++) {
      const raw = text(rows[r] && rows[r][c]);
      if (!raw) continue;
      const parsed = parseToolingNumber(raw);
      let number;
      let kind;
      if (isBolsterBlock) {
        kind = 'bolster';
        number = parsed.kind === 'bolster' ? parsed.canonical : `BOL-${raw.toUpperCase()}`;
      } else {
        // The block is the authority on kind: a letter-variant code (35IC1A, 25IC1-G-23483) is still an insert.
        kind = 'insert';
        number = parsed.kind === 'insert' ? parsed.canonical : raw.toUpperCase();
        if (parsed.kind !== 'insert') {
          parsed.cavities = /SINGLE/i.test(category) ? 1 : /TWO/i.test(category) ? 2 : null;
          const tail = /-(\d{5,6})$/.exec(number);
          parsed.madeForDie = tail ? tail[1] : null;
        }
      }
      const location = text(rows[r][c + 2]) || null;
      const sizeClass = normalizeSizeClass(rows[r][c + 1]);
      const press = pressFromGex2Location(location) || pressFromSheetName(sheetName);
      out.push({
        number,
        kind,
        plant: 'GEX 2',
        held_presses: press ? [press] : [],
        size_class: sizeClass,
        size_class_source: sizeClass ? 'inventory' : null,
        size_class_confidence: sizeClass ? 'confirmed' : null,
        cavities: kind === 'insert' ? parsed.cavities : null,
        category: category || null,
        location,
        made_for_die: kind === 'insert' ? parsed.madeForDie : null,
        inventory_dims: null,
        source: 'inventory-2025',
      });
    }
  }
  return mergeToolingRows(out);
}

function parseGex1InsertSheet(rows, { onSkip = () => {} } = {}) {
  const headerRow = rows[0] || [];
  const out = [];
  for (let c = 0; c < headerRow.length; c += 4) {
    const pressMatch = /(\d+)/.exec(text(headerRow[c + 2]));
    if (!pressMatch) continue;
    const press = `PRESS ${pressMatch[1]}`;
    for (let r = 1; r < rows.length; r++) {
      const raw = text(rows[r] && rows[r][c + 1]);
      if (!raw) continue;
      const parsed = parseToolingNumber(`I-${raw.padStart(5, '0')}`);
      if (parsed.kind !== 'insert' || parsed.plant !== 'GEX 1') {
        onSkip({ sheet: 'GEX-1 inserts', row: r + 1, raw, reason: 'not an insert number' });
        continue;
      }
      out.push({
        number: parsed.canonical,
        kind: 'insert',
        plant: 'GEX 1',
        held_presses: [press],
        size_class: null,
        size_class_source: null,
        size_class_confidence: null,
        cavities: null,
        category: null,
        location: null,
        made_for_die: parsed.madeForDie,
        inventory_dims: null,
        source: 'inventory-2024-12',
      });
    }
  }
  return mergeToolingRows(out);
}

function parseGex1BolsterSheet(rows, { onSkip = () => {} } = {}) {
  const headerIdx = rows.findIndex((r) => (r || []).some((v) => text(v).toUpperCase() === 'BOL NO.'));
  if (headerIdx < 0) return [];
  const headerRow = rows[headerIdx];
  const out = [];
  for (let c = 0; c < headerRow.length; c++) {
    if (text(headerRow[c]).toUpperCase() !== 'BOL NO.') continue;
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const raw = text(row[c]);
      if (!raw || raw.toUpperCase() === 'BOL NO.') continue; // blank, or a repeated header row
      const pressMatch = /(\d+)/.exec(text(row[c - 1]));
      const parsed = parseToolingNumber(raw);
      const number = parsed.kind === 'bolster' ? parsed.canonical : `BOL-${raw.toUpperCase()}`;
      if (!pressMatch) onSkip({ sheet: 'GEX-1 bolsters', row: r + 1, raw, reason: 'no press, stored without one' });
      const a = row[c + 2];
      const b = row[c + 3];
      const both = typeof a === 'number' && typeof b === 'number';
      const sizeClass = normalizeSizeClass(row[c + 1]);
      out.push({
        number,
        kind: 'bolster',
        plant: 'GEX 1',
        held_presses: pressMatch ? [`PRESS ${pressMatch[1]}`] : [],
        size_class: sizeClass,
        size_class_source: sizeClass ? 'inventory' : null,
        size_class_confidence: sizeClass ? 'confirmed' : null,
        cavities: null,
        category: null,
        location: null,
        made_for_die: null,
        inventory_dims: both ? { a_len: a, b_wid: b } : null,
        source: 'bolster-inventory-p2-p6',
      });
    }
  }
  return mergeToolingRows(out);
}

function buildToolingUpsert(row) {
  const sql = `INSERT INTO toolings
    (number, kind, plant, held_presses, size_class, size_class_source, size_class_confidence,
     cavities, category, location, made_for_die, inventory_dims, source)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
  ON CONFLICT (number) DO UPDATE SET
    held_presses = (SELECT ARRAY(SELECT DISTINCT unnest(toolings.held_presses || EXCLUDED.held_presses))),
    size_class_source = CASE WHEN toolings.size_class IS NULL THEN EXCLUDED.size_class_source ELSE toolings.size_class_source END,
    size_class_confidence = CASE WHEN toolings.size_class IS NULL THEN EXCLUDED.size_class_confidence ELSE toolings.size_class_confidence END,
    size_class = COALESCE(toolings.size_class, EXCLUDED.size_class),
    location = COALESCE(EXCLUDED.location, toolings.location),
    category = COALESCE(EXCLUDED.category, toolings.category),
    cavities = COALESCE(EXCLUDED.cavities, toolings.cavities),
    inventory_dims = COALESCE(EXCLUDED.inventory_dims, toolings.inventory_dims),
    updated_at = CURRENT_TIMESTAMP`;
  const params = [
    row.number, row.kind, row.plant, row.held_presses, row.size_class, row.size_class_source,
    row.size_class_confidence, row.cavities, row.category, row.location, row.made_for_die,
    row.inventory_dims == null ? null : JSON.stringify(row.inventory_dims), row.source,
  ];
  return { sql, params };
}

module.exports = { parseGex2InventorySheet, parseGex1InsertSheet, parseGex1BolsterSheet, buildToolingUpsert, mergeToolingRows };
