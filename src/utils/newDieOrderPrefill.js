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

const FIELD_TO_KEY = {
  dieSize: 'DIE_SIZE', cavities: 'NO_OF_CAV', press: 'PRESS', insertNo: 'INSERT_NO', bolsterNo: 'BOLSTER_NO',
  dieNo: 'DIE_NO', profileNo: 'PROFILE_NO', customer: 'CUSTOMER',
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
    BOLSTER_NO: text(f.bolsterNo), INSERT_NO: text(f.insertNo), BOLSTER_SIZE: '', INSERT_SIZE: '',
    DELIVERY_DATE: '', THREE_D_MODULE: false, SHIPMENT: '', PROFILE_WEIGHT_PCT: '',
    FINISH_MILL: false, FINISH_ANODIZING: false, FINISH_POWDER: false, PENDING_ORDER_KG: '0', REASON: '',
    PLANT: plant, DIE_NO: text(f.dieNo), PROFILE_NO: text(f.profileNo), CUSTOMER: text(f.customer),
  };
  const sources = {};
  for (const [field, key] of Object.entries(FIELD_TO_KEY)) if (read[field] && values[key] !== '') sources[key] = read[field];
  if (read.dieType && (values.SOLID || values.HOLLOW)) sources[values.SOLID ? 'SOLID' : 'HOLLOW'] = read.dieType;
  if (plant && read.press) sources.PLANT = read.press;
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
      return card;
    })
    : null;
  const shape = profile ? Object.fromEntries(SHAPE_FIELDS.map((k) => [k, profile[k] ?? null])) : null;
  return { chosen: chosen || null, candidates, profile: shape };
}
