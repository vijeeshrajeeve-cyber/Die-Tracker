// Prefill for the Prepare New Die Order PDF modal (components/tooling/NewDieOrderModal):
// what page 1 of the picked drawing says, turned into the form's values. The patterns are
// PDFImportModal's Format A readers, copied rather than imported so the modal stays out of it.
import { extractBolsterInsertNos, readDieType } from './pdfImportFields.js';
import { splitDieNo } from './dieNumber.js';

// PDFImportModal's PRESS_TO_PLANT_PDF.
const PRESS_TO_PLANT = {
  '25': 'GEX 2', 'P25': 'GEX 2',
  '35': 'GEX 2', 'P35': 'GEX 2',
  '2': 'GEX 1', 'P2': 'GEX 1',
  '4': 'GEX 1', 'P4': 'GEX 1',
  '5': 'GEX 1', 'P5': 'GEX 1',
  '6': 'GEX 1', 'P6': 'GEX 1',
  '7': 'GEX 2', 'P7': 'GEX 2',
  '8': 'GEX 2', 'P8': 'GEX 2',
  'B': 'GEX 1', 'D': 'GEX 1', 'E': 'GEX 1', 'F': 'GEX 1',
};

const SIZE = /(?:Dia\s*)?(\d{2,4}\s*[Xx×]\s*\d{2,4})/i;
const cleanSize = (s) => s.replace(/\s+/g, '').toUpperCase().replace('×', 'X');

// pdf.js text items ({ str, transform }) as PDFImportModal's lines: grouped by rounded y,
// rows within 3 pt of a row's top merged into it, top of the page first, items left to right.
export function linesFromTextItems(textItems) {
  const byY = {};
  for (const item of textItems || []) {
    const y = Math.round(item.transform[5]);
    (byY[y] ||= []).push({ text: item.str, x: Math.round(item.transform[4]) });
  }
  const merged = {};
  let current = null;
  for (const y of Object.keys(byY).map(Number).sort((a, b) => b - a)) {
    if (current !== null && current - y <= 3) merged[current].push(...byY[y]);
    else { current = y; merged[y] = [...byY[y]]; }
  }
  return Object.keys(merged).map(Number).sort((a, b) => b - a).map((y) => {
    const items = merged[y].sort((a, b) => a.x - b.x);
    return { y, text: items.map((i) => i.text).join(' ').trim(), items };
  });
}

// `lines` are PDFImportModal's { y, text, items: [{ text, x }] }, top of the page first;
// `fullText` their texts joined. `fileName` (optional) is checked first for the die number,
// as the import does: "030724_701_.pdf" -> 030724-701. Each field read is marked
// sources[field] = 'drawing'; a field not read is null and has no source.
export function fieldsFromDrawing(lines, fullText, { fileName } = {}) {
  const ls = lines || [];
  let dieSize = null; let cavities = null; let press = null; let dieType = null;
  let insertNo = null; let bolsterNo = null; let customer = null;

  for (let i = 0; i < ls.length; i++) {
    const lineText = String(ls[i].text || '');
    const upperLine = lineText.toUpperCase();
    const next = ls[i + 1] ? String(ls[i + 1].text || '').trim() : null;

    if (upperLine.includes('DIE SIZE') && !dieSize) {
      const m = lineText.match(SIZE) || (next != null ? next.match(SIZE) : null);
      if (m) dieSize = cleanSize(m[1]);
    }

    if ((upperLine.includes('NO OF CAV') || upperLine.includes('NO. OF CAV') || upperLine.includes('CAVIT')) && cavities === null) {
      const m = lineText.match(/CAV\w*\s*[-:.]?\s*(\d+)\s*(?:PRESS|$)/i);
      if (m) cavities = parseInt(m[1], 10);
      if (cavities === null && next != null) {
        const combined = next.match(/^[-\s]*(\d{1,2})\s+(P?\s*\d+|[A-F])(?:\s|$)/i);
        if (combined) {
          cavities = parseInt(combined[1], 10);
          if (!press) press = combined[2].trim();
        } else {
          const alone = next.match(/^[-\s]*(\d{1,2})(?:\s|$)/);
          if (alone) cavities = parseInt(alone[1], 10);
        }
      }
      if (cavities === null && ls[i + 2]) {
        const m2 = String(ls[i + 2].text || '').trim().match(/^[-\s]*(\d{1,2})(?:\s|$)/);
        if (m2) cavities = parseInt(m2[1], 10);
      }
    }

    // "PRESS - P25", "PRESS - 7"; a lone letter only when nothing else follows it.
    if (upperLine.includes('PRESS') && !upperLine.includes('SHIPMENT') && !press) {
      const m = lineText.match(/PRESS\s*[-:=]?\s*(P\s*\d+|\d+|[A-F])(?:\s|$)/i);
      if (m) {
        const candidate = m[1].trim();
        if (candidate.length === 1 && /^[a-f]$/i.test(candidate)) {
          const afterPress = lineText.substring(upperLine.indexOf('PRESS') + 5).replace(/^[\s\-:=]+/, '');
          if (/^[A-F]\s*$/i.test(afterPress) || (/^[A-F]\b/i.test(afterPress) && afterPress.length <= 2)) {
            press = candidate.toUpperCase();
          }
        } else {
          press = candidate;
        }
      }
      if (!press && next != null) {
        const m2 = next.match(/^[-\s]*(?:\d{1,2}\s+)?(P\s*\d+|[A-F])$/i);
        if (m2) press = m2[1].trim();
      }
    }

    if (/\bHOLLOW\b/.test(upperLine) && dieType === null) {
      const near = [ls[i - 1], ls[i], ls[i + 1]].filter(Boolean)
        .filter((l) => l === ls[i] || /^(SOLID\b.*|OK|YES|Y)$/i.test(String(l.text || '').trim()));
      dieType = readDieType(near.flatMap((l) => l.items || []));
    }

    if ((upperLine.includes('BOLSTER') || upperLine.includes('INSERT')) && !bolsterNo && !insertNo) {
      ({ bolsterNo, insertNo } = extractBolsterInsertNos(lineText));
      if (!bolsterNo && !insertNo && next != null) {
        const nextUpper = next.toUpperCase();
        if (!nextUpper.startsWith('SIZE') && !nextUpper.startsWith('DIE SIZE')) {
          const id = next.match(/(?<!\d)([A-Za-z][-]?\d{3,6})/i);
          if (id) {
            if (upperLine.includes('INSERT')) insertNo = id[1].trim();
            else bolsterNo = id[1].trim();
          }
        }
      }
    }

    // Title block "Customer : <name>"; a printed label with no name says nothing.
    if (customer === null) {
      const m = lineText.match(/\bCustomer\s*[:-]+\s*(.*)$/i);
      const value = m ? m[1].replace(/^[-:\s]+/, '').trim() : '';
      if (value.length >= 2) customer = value;
    }
  }

  if (press) {
    press = press.replace(/\s+/g, '').toUpperCase();
    if (/^\d+$/.test(press)) press = `P${press}`;
  }

  // The file name first, then the page text (PDFImportModal's order).
  let dieNo = null;
  const fromName = String(fileName || '').replace(/\.pdf$/i, '').match(/(\d{3,6}[-_]\d{2,4})/);
  if (fromName) dieNo = fromName[1].replace('_', '-');
  else {
    const fromText = String(fullText || '').match(/\b(\d{3,6}[-]\d{2,4})\b/);
    if (fromText) dieNo = fromText[1];
  }
  const profileNo = dieNo ? splitDieNo(dieNo).profile || null : null;

  const fields = { dieSize, cavities, press, dieType, insertNo, bolsterNo, profileNo, dieNo, customer };
  const sources = {};
  for (const [key, value] of Object.entries(fields)) if (value != null) sources[key] = 'drawing';
  return { ...fields, sources };
}

// ---- the order form drawn as a picture ------------------------------------------------
// Many request drawings carry the die shop's order form as a stamped picture: its labels
// ("DIE SIZE", "No OF CAV", ...) are not text, only the values typed into it are. They are
// read by where they sit. The form is two columns of label + value:
//   SUPPLIER   | DATE
//   DIE SIZE (full width)
//   No OF CAV  | PRESS
//   SOLID      | HOLLOW
//   BOLSTER No | INSERT No
//   SIZE       | SIZE
//   REQUESTED DELIVERY DATE, 3D MODULE, MODE OF SHIPMENT, PROFILE WEIGHT START (full width)
// so a value left of the middle belongs to the left label of its row and one right of it to
// the right label. The supplier and the order date on the top row mark the two columns.

const STAMP_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
const STAMP_SIZE = /^(?:DIA\.?\s*)?(\d{2,4}(?:\.\d+)?)\s*[xX×]\s*(\d{2,4}(?:\.\d+)?)$/i;
const STAMP_TICK = /^(ok|yes|y)$/i;
const STAMP_3D = /^(no|not\s*required|required|yes|ok)$/i;
const STAMP_SHIP = /^(?:by\s+)?(road|air|sea|land)$/i;
const STAMP_WEIGHT = /^([-+]\s*\d+(?:\.\d+)?)\s*%?$/;
const STAMP_ROWS = 24; // the form is about 12 rows tall; twice that leaves room for loose typing

const isoDate = (m) => `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;

// pdf.js text items of page 1 -> the values typed into the stamped form, or null when the
// page has no such form (no supplier-and-date row). Fields not typed are null.
export function stampValuesFromItems(textItems) {
  const items = (textItems || [])
    .map((it) => ({
      text: String(it?.str ?? '').trim(),
      x: Number(it?.transform?.[4]), y: Number(it?.transform?.[5]),
      h: Number(it?.height) || Math.abs(Number(it?.transform?.[3])) || 0,
    }))
    .filter((i) => i.text && Number.isFinite(i.x) && Number.isFinite(i.y));

  // The top row: a name with the order date to its right on the same line.
  let anchor = null;
  for (const date of items.filter((i) => STAMP_DATE.test(i.text)).sort((a, b) => b.y - a.y)) {
    const row = Math.max(date.h, 4);
    const supplier = items
      .filter((i) => i !== date && Math.abs(i.y - date.y) <= row && i.x < date.x && date.x - i.x < row * 30
        && /[A-Za-z]{2,}/.test(i.text) && !STAMP_SIZE.test(i.text) && !STAMP_DATE.test(i.text))
      .sort((a, b) => b.x - a.x)[0];
    if (supplier) { anchor = { date, supplier, row }; break; }
  }
  if (!anchor) return null;

  const { date, supplier, row } = anchor;
  const split = (supplier.x + date.x) / 2;
  const below = items
    .filter((i) => i !== date && i !== supplier && i.y < date.y - row * 0.5 && i.y > date.y - row * STAMP_ROWS
      && i.x > supplier.x - row * 12 && i.x < date.x + row * 18)
    .sort((a, b) => b.y - a.y || a.x - b.x);

  const out = {
    supplier: supplier.text, orderDate: isoDate(date.text.match(STAMP_DATE)),
    dieSize: null, cavities: null, press: null, dieType: null,
    bolsterNo: null, insertNo: null, bolsterSize: null, insertSize: null,
    deliveryDate: null, threeD: null, shipment: null, weightPct: null,
  };
  let seenCavRow = false; let seenToolingRow = false;
  for (const i of below) {
    const left = i.x < split;
    const size = i.text.match(STAMP_SIZE);
    const sizeText = size ? `${size[1]}X${size[2]}`.toUpperCase() : null;
    const dateM = i.text.match(STAMP_DATE);
    if (dateM) { if (!out.deliveryDate) out.deliveryDate = isoDate(dateM); continue; }
    if (sizeText && !out.dieSize && !seenCavRow) { out.dieSize = sizeText; continue; }
    if (/^\d{1,2}$/.test(i.text) && !seenToolingRow && !out.deliveryDate) {
      seenCavRow = true;
      if (left && out.cavities == null) out.cavities = parseInt(i.text, 10);
      else if (!left && out.press == null) out.press = i.text;
      continue;
    }
    if (STAMP_TICK.test(i.text) && !seenToolingRow && !out.deliveryDate) {
      if (!out.dieType) out.dieType = left ? 'SOLID' : 'HOLLOW';
      continue;
    }
    if (sizeText || /^(old|new)$/i.test(i.text)) {
      const key = left ? 'bolsterSize' : 'insertSize';
      if (!out[key]) out[key] = sizeText || i.text.toUpperCase();
      continue;
    }
    const ship = i.text.match(STAMP_SHIP);
    if (ship) { if (!out.shipment) out.shipment = i.text.toUpperCase().replace(/\s+/g, ' '); continue; }
    const weight = i.text.match(STAMP_WEIGHT);
    if (weight) { if (!out.weightPct) out.weightPct = weight[1].replace(/\s+/g, ''); continue; }
    if (out.deliveryDate && STAMP_3D.test(i.text)) {
      if (out.threeD == null) out.threeD = !/^no/i.test(i.text);
      continue;
    }
    // A tooling number: letters with at least three digits ("I-05043", "BOL-30587", "25IC2-030724").
    if (!out.deliveryDate && /[A-Za-z]/.test(i.text) && /\d{3,}/.test(i.text)) {
      seenToolingRow = true;
      const key = left ? 'bolsterNo' : 'insertNo';
      if (!out[key]) out[key] = i.text.toUpperCase();
    }
  }
  return out;
}

// The customer named on the order-details sheet (page 2): the text on the profile number's
// line, right of it. `textItems` are that page's pdf.js items.
export function customerFromOrderDetails(textItems, profileNo) {
  const want = String(profileNo ?? '').trim();
  if (!want) return null;
  const items = (textItems || []).map((it) => ({
    text: String(it?.str ?? '').trim(), x: Number(it?.transform?.[4]), y: Number(it?.transform?.[5]),
  })).filter((i) => i.text);
  const at = items.find((i) => i.text === want);
  if (!at) return null;
  const name = items
    .filter((i) => i !== at && Math.abs(i.y - at.y) <= 4 && i.x > at.x && /[A-Za-z]{3,}/.test(i.text))
    .sort((a, b) => b.text.length - a.text.length)[0];
  return name ? name.text : null;
}

// Everything page 1 (and the order-details page, when given) says, as fieldsFromDrawing's
// answer with the stamped form's extra fields. A form printed as text (labels and values, as
// this app stamps it) is read by its labels and is the whole answer; only when the page has no
// such form are the values read by position.
export function fieldsFromPages(page1Items, { fileName, page2Items = null } = {}) {
  const lines = linesFromTextItems(page1Items);
  const base = fieldsFromDrawing(lines, lines.map((l) => l.text).join(' '), { fileName });
  const labelled = base.dieSize != null || base.cavities != null;
  const stamp = (labelled ? null : stampValuesFromItems(page1Items)) || {};
  const fields = { ...base };
  const sources = { ...base.sources };
  const fill = (key, value) => {
    if (fields[key] != null && fields[key] !== '') return;
    if (value == null || value === '') return;
    fields[key] = value;
    sources[key] = 'drawing';
  };
  for (const key of ['dieSize', 'cavities', 'dieType', 'insertNo', 'bolsterNo']) fill(key, stamp[key]);
  if (stamp.press != null) fill('press', /^\d+$/.test(stamp.press) ? `P${stamp.press}` : String(stamp.press).toUpperCase());
  for (const key of ['supplier', 'bolsterSize', 'insertSize', 'deliveryDate', 'threeD', 'shipment', 'weightPct']) {
    fields[key] = null;
    fill(key, stamp[key]);
  }
  if (page2Items) fill('customer', customerFromOrderDetails(page2Items, fields.profileNo));
  return { ...fields, sources, lines };
}

const FIELD_TO_KEY = {
  dieSize: 'DIE_SIZE', cavities: 'NO_OF_CAV', press: 'PRESS', insertNo: 'INSERT_NO', bolsterNo: 'BOLSTER_NO',
  dieNo: 'DIE_NO', profileNo: 'PROFILE_NO', customer: 'CUSTOMER',
  insertSize: 'INSERT_SIZE', bolsterSize: 'BOLSTER_SIZE', deliveryDate: 'DELIVERY_DATE', weightPct: 'PROFILE_WEIGHT_PCT',
};

// The form's values: every dieOrderTemplate VALUE_KEYS entry (checkboxes false, texts '',
// DATE today, PENDING_ORDER_KG '0') plus PLANT, DIE_NO, PROFILE_NO, CUSTOMER, with
// sources keyed by value key. PLANT follows the drawing's press.
export function valuesFromFields(fields = {}, { today = '' } = {}) {
  const f = fields || {};
  const read = f.sources || {};
  const text = (v) => (v == null ? '' : String(v));
  const type = String(f.dieType || '').toUpperCase();
  const plant = f.press ? PRESS_TO_PLANT[String(f.press).toUpperCase()] || '' : '';
  const values = {
    SUPPLIER: '', DATE: today, DIE_SIZE: text(f.dieSize), NO_OF_CAV: text(f.cavities), PRESS: text(f.press),
    SOLID: type === 'SOLID', HOLLOW: type === 'HOLLOW',
    BOLSTER_NO: text(f.bolsterNo), INSERT_NO: text(f.insertNo), BOLSTER_SIZE: text(f.bolsterSize), INSERT_SIZE: text(f.insertSize),
    DELIVERY_DATE: text(f.deliveryDate), THREE_D_MODULE: f.threeD === true, SHIPMENT: '', PROFILE_WEIGHT_PCT: text(f.weightPct),
    FINISH_MILL: false, FINISH_ANODIZING: false, FINISH_POWDER: false, PENDING_ORDER_KG: '0', REASON: '',
    PLANT: plant, DIE_NO: text(f.dieNo), PROFILE_NO: text(f.profileNo), CUSTOMER: text(f.customer),
  };
  const sources = {};
  for (const [field, key] of Object.entries(FIELD_TO_KEY)) if (read[field] && values[key] !== '') sources[key] = read[field];
  if (read.dieType && (values.SOLID || values.HOLLOW)) sources[values.SOLID ? 'SOLID' : 'HOLLOW'] = read.dieType;
  if (plant && read.press) sources.PLANT = read.press;
  if (read.threeD && f.threeD != null) sources.THREE_D_MODULE = read.threeD;
  return { values, sources };
}

const squash = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();

// The presses-master name for a press read off a drawing: its press code ("P25" -> PRESS 7)
// first, then its number ("P7", "7" -> PRESS 7). Unknown presses are kept as read.
export function pressOptionName(press, presses) {
  const key = squash(press);
  if (!key) return '';
  const list = presses || [];
  const byCode = list.find((p) => squash(p.press_code) === key);
  if (byCode) return byCode.press_name;
  const n = key.match(/^P?(\d+)$/);
  const byNumber = n && list.find((p) => squash(p.press_name) === `PRESS${n[1]}`);
  return byNumber ? byNumber.press_name : String(press).trim();
}

const PAIRS = { insert: ['INSERT_NO', 'INSERT_SIZE'], bolster: ['BOLSTER_NO', 'BOLSTER_SIZE'] };

// Typing into a tooling field. Over the chosen candidate's own pair the choice is kept (its
// number stays for the record) but no longer counts as taken from the finder.
export function editToolingField(values, chosen, key, value) {
  const next = { ...values, [key]: value };
  if (!chosen || !(PAIRS[chosen.kind] || []).includes(key)) return { values: next, chosen };
  return { values: next, chosen: { ...chosen, fromFinder: false } };
}

// The trace result's columns the form record keeps (new-die-order-forms sanitizeProfile).
const SHAPE_FIELDS = [
  'style', 'outer_unit', 'holes_unit', 'true_size', 'outer_mm', 'holes_mm', 'ccd_mm',
  'true_size_source', 'true_size_confidence', 'needs_review', 'review_reason',
];

// The `finder` part of the generate request. Pockets and placements are dropped from every
// candidate: the record keeps the cards, not polygons, and the multipart field cap is 1 MB.
export function finderPayload({ chosen = null, result = null, profile = null } = {}) {
  const candidates = Array.isArray(result?.candidates)
    ? result.candidates.map((candidate) => {
      const card = { ...candidate };
      delete card.pockets;
      delete card.placements;
      delete card.outer;
      return card;
    })
    : null;
  const shape = profile ? Object.fromEntries(SHAPE_FIELDS.map((k) => [k, profile[k] ?? null])) : null;
  return { chosen: chosen || null, candidates, profile: shape };
}
