import { normalizeEta } from './deliveryFollowup.js';

/**
 * Order Details drawer edits, client copy. server/services/orderDetailEdits.cjs
 * is the authority; this copy only builds the Review changes dialog, and
 * orderDetailEdits.test.js fails if the two ever disagree.
 */

export class OrderEditError extends Error {
  constructor(message, code = 'INVALID', fields) {
    super(message);
    this.status = 400;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

// Every status the drawer offers (STATUS_CONFIG in ./constants.js).
export const STATUSES = Object.freeze([
  'AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'UNDER SIMULATION',
  'PENDING FOR DESIGN TO EMS', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING', 'DONE', 'DIE RECEIVED', 'CANCELLED', 'HOLD',
]);

const REASON_STATUSES = Object.freeze(['CANCELLED', 'HOLD']);
export const REASON_MAX = 500;

// Drawer field -> how its values compare. Types are described in the server copy.
export const EDITABLE_FIELDS = Object.freeze({
  'Plant':                  { type: 'text' },
  'TYPE':                   { type: 'text', oneOf: ['N', 'B', 'T', 'C', 'H'] },
  'Die Size':               { type: 'text' },
  'Cavity':                 { type: 'int', max: 10000 },
  'Mandrels per Cavity':    { type: 'int', max: 10000 },
  'Total Mandrels':         { type: 'int', max: 100000 },
  'Type of shipment':       { type: 'text', oneOf: ['AIR', 'LAND'] },
  'Supplier':               { type: 'text' },
  'Customer Name':          { type: 'text' },
  'PR Number':              { type: 'text' },
  'Press':                  { type: 'text' },
  'simulationEnabled':      { type: 'bool' },
  'Urgency':                { type: 'urgency' },
  'specialFollowUp':        { type: 'bool' },
  'STATUS':                 { type: 'text', oneOf: STATUSES },
  'Die Requested Date':     { type: 'date' },
  'Design Received Date':   { type: 'date' },
  '3D Model Received Date': { type: 'date' },
  'Design Approved Date':   { type: 'date' },
  'PR Entry':               { type: 'datetext' },
  'Oracle Entry':           { type: 'datetext' },
  'Ordered date':           { type: 'date' },
  'ETA':                    { type: 'datetext' },
  'Die Received Date':      { type: 'date' },
  'Submission Date':        { type: 'date' },
  'Sample Approval Date':   { type: 'date' },
  'No of Trial':            { type: 'int', max: 1000 },
  'Corrector':              { type: 'text' },
});

// The drawer's own labels where they differ from the field name.
const FIELD_LABELS = {
  'TYPE': 'Type',
  'STATUS': 'Status',
  'simulationEnabled': 'Simulation',
  'specialFollowUp': 'Special follow-up',
  'Type of shipment': 'Shipment',
  'Mandrels per Cavity': 'Mandrels/Cav',
  'Ordered date': 'Ordered',
};

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const textOf = (value) => (value === null || value === undefined ? '' : String(value).trim());

function normalizeUrgency(value) {
  const s = textOf(value).toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
}

function canonical(type, value) {
  const text = textOf(value);
  switch (type) {
    case 'int': {
      if (text === '') return 0;
      const n = Math.round(Number(text));
      return n === 0 ? 0 : n;
    }
    case 'bool':
      return value === true || value === 1 || ['true', '1', 'yes', 'y'].includes(text.toLowerCase());
    case 'urgency':
      return normalizeUrgency(value);
    case 'date':
      return text === '' ? null : normalizeEta(text);
    case 'datetext':
      return text === '' ? null : (normalizeEta(text) || text.slice(0, 500));
    default:
      return text === '' ? null : text.slice(0, 500);
  }
}

function isEmpty(type, value) {
  if (type === 'int') return value === 0;
  if (type === 'bool') return value === false;
  if (type === 'urgency') return false;
  return value === null;
}

function checkValue(field, value, raw) {
  const spec = EDITABLE_FIELDS[field];
  if (spec.type === 'int' && !(Number.isInteger(value) && value >= 0 && value <= spec.max)) {
    throw new OrderEditError(`${field} must be a whole number from 0 to ${spec.max}`);
  }
  if (spec.type === 'date' && value === null && textOf(raw) !== '') {
    throw new OrderEditError(`${field} is not a valid date`);
  }
  if (spec.oneOf && value !== null && !spec.oneOf.includes(value)) {
    throw new OrderEditError(`${field} cannot be ${value}`);
  }
}

export function planChanges(before, fields) {
  const changes = [];
  for (const [field, raw] of Object.entries(fields || {})) {
    if (!hasOwn(EDITABLE_FIELDS, field)) {
      throw new OrderEditError(`${field} cannot be changed from Order Details`);
    }
    const { type } = EDITABLE_FIELDS[field];
    const stored = before ? before[field] : undefined;
    if (textOf(raw) === textOf(stored)) continue;
    const was = canonical(type, stored);
    const after = canonical(type, raw);
    checkValue(field, after, raw);
    if (Object.is(was, after)) continue;
    let kind = 'changed';
    if (isEmpty(type, was)) kind = 'filled';
    else if (isEmpty(type, after)) kind = 'cleared';
    changes.push({ field, kind, before: was, after });
  }
  return changes;
}

export function changeNeedsReason({ field, kind, before, after }) {
  if (field === 'STATUS') return REASON_STATUSES.includes(before) || REASON_STATUSES.includes(after);
  return kind !== 'filled';
}

export const needsReason = (changes) => changes.some(changeNeedsReason);

export function displayValue(field, value) {
  const { type } = EDITABLE_FIELDS[field];
  if (type === 'bool') return value ? 'Yes' : 'No';
  if (type === 'int') return String(value);
  return value === null || value === undefined ? null : String(value);
}

export function canEditOrderDetails(user) {
  return !!user && (user.role === 'admin' || user.canEditOrderDetails === true);
}

// The drawer's edited order carries every column; only these may be sent.
export function pickEditable(order) {
  return Object.fromEntries(Object.keys(EDITABLE_FIELDS)
    .filter((field) => hasOwn(order || {}, field))
    .map((field) => [field, order[field]]));
}

export const fieldLabel = (field) => FIELD_LABELS[field] || field;
export const fieldType = (field) => (hasOwn(EDITABLE_FIELDS, field) ? EDITABLE_FIELDS[field].type : undefined);
