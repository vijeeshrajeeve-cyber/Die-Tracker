import { fieldLabel, isBlankValue, planChanges } from './orderDetailEdits.js';

/**
 * Die order PDF import on a die that already has an order: the PDF may only
 * fill the order's blank fields. Changing a set value stays in the Order
 * Details drawer, where it needs permission and a reason. Blank is the
 * drawer's own rule (empty text or date, 0, false), so a fill here is a fill
 * there, and the drawer route re-checks it against the live row.
 */

// What the PDF or the import preview supplies that the drawer can save.
export const FILLABLE_FIELDS = Object.freeze([
  'Die Size', 'Supplier', 'Press', 'Plant', 'Cavity', 'Die Requested Date',
  'simulationEnabled', 'Type of shipment', 'TYPE', 'Mandrels per Cavity', 'Total Mandrels',
]);

export const FILL_NEEDS_PERMISSION = 'needs Order Details permission';

const EMPTY = { Cavity: 0, 'Mandrels per Cavity': 0, 'Total Mandrels': 0, simulationEnabled: false };
const emptyOf = (field) => (field in EMPTY ? EMPTY[field] : null);

// The parser's fallbacks for what the PDF did not say. They are not values.
function isPlaceholder(field, value, { plantFromPdf, shipmentFromTable }) {
  if (field === 'Supplier') return value === 'UNKNOWN';
  if (field === 'Die Size') return value === 'N/A';
  if (field === 'Plant') return !plantFromPdf;
  if (field === 'Type of shipment') return !shipmentFromTable;
  return false;
}

// Not on the PDF: only a pick in the preview may fill these. The parser copies an
// insert's row from its die's row, so what arrives here can be another order's value.
const PREVIEW_ONLY = new Set(['TYPE', 'Mandrels per Cavity', 'Total Mandrels']);

// The preview row for a die that already has an order: the order's value where
// it has one, otherwise what the PDF read (a placeholder shows as empty).
export function mergeExistingForPreview(existing, row, { plantFromPdf = false, shipmentFromTable = false } = {}) {
  const merged = { ...row };
  for (const field of FILLABLE_FIELDS) {
    if (!isBlankValue(field, existing[field])) merged[field] = existing[field];
    else if (PREVIEW_ONLY.has(field) || isPlaceholder(field, row[field], { plantFromPdf, shipmentFromTable })) {
      merged[field] = emptyOf(field);
    }
  }
  return merged;
}

// The blank fields of `existing` this preview row would fill, with drawer labels.
export function planPdfFills(existing, row) {
  const fields = {};
  for (const field of FILLABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) continue;
    let changes;
    try {
      changes = planChanges(existing, { [field]: row[field] });
    } catch {
      continue; // a value the drawer would refuse (e.g. shipment SEA) is not filled
    }
    if (changes.length && changes[0].kind === 'filled') fields[field] = row[field];
  }
  return { fields, labels: Object.keys(fields).map(fieldLabel) };
}

function fillFailureCause(error) {
  if (error?.data?.code === 'REASON_REQUIRED') return 'changed since preview';
  if (error?.status === 403) return FILL_NEEDS_PERMISSION;
  return error?.message || 'save failed';
}

// Saves each planned fill on its own through the drawer route (`patchDetails` is
// ordersAPI.patchDetails); one refusal or error never stops the rest.
export async function applyPdfFills(items, patchDetails) {
  let filled = 0;
  const failed = [];
  for (const { id, dieNo, fields } of items) {
    try {
      await patchDetails(id, { fields });
      filled += 1;
    } catch (error) {
      failed.push({ dieNo, cause: fillFailureCause(error) });
    }
  }
  return { filled, failed };
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function fillSummary({ created = 0, filled = 0, complete = 0, failed = [] }) {
  const parts = [];
  if (created) parts.push(`${count(created, 'new order', 'new orders')} created`);
  if (filled) parts.push(`${count(filled, 'existing order', 'existing orders')} filled`);
  if (complete) parts.push(`${complete} already complete`);
  if (failed.length) parts.push(`${failed.length} not filled (${failed.map((f) => `${f.dieNo}: ${f.cause}`).join('; ')})`);
  return `PDF import: ${parts.join(', ') || 'nothing to change'}`;
}
