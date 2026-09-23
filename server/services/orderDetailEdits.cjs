'use strict';
/**
 * Order Details drawer edits: which fields the drawer may change, what counts
 * as a change, and when a change needs a reason. PATCH /api/orders/:id/details
 * is the authority. src/utils/orderDetailEdits.js holds the client copy that
 * builds the Review changes dialog; its test fails if the two drift.
 */
const { normalizeEta } = require('./deliveryFollowup.cjs');

class OrderEditError extends Error {
  constructor(message, code = 'INVALID', fields) {
    super(message);
    this.status = 400;
    this.code = code;
    if (fields) this.fields = fields;
  }
}

// Every status the drawer offers (STATUS_CONFIG in src/utils/constants.js).
// DIE RECEIVED is a real stored status, although the order routes'
// VALID_STATUSES list leaves it out.
const STATUSES = Object.freeze([
  'AWAITING FOR DESIGN', 'PENDING FOR DESIGN APPROVAL', 'UNDER SIMULATION',
  'PENDING FOR DESIGN TO EMS', 'PENDING FOR PR', 'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING', 'DONE', 'DIE RECEIVED', 'CANCELLED', 'HOLD',
]);

// Moving into or out of these always needs a reason, as the drawer asked before.
const REASON_STATUSES = Object.freeze(['CANCELLED', 'HOLD']);
const REASON_MAX = 500;

// Drawer field -> column, how its values compare, and its limits.
//   text      trimmed text; blank is empty
//   int       whole number; 0 is empty (these columns default to 0 for "not set")
//   bool      yes/no; false is empty
//   urgency   NORMAL | URGENT | TOP_URGENT; never empty
//   date      a date column, compared as YYYY-MM-DD
//   datetext  a TEXT column that usually holds a date but may hold e.g. "TBC"
const EDITABLE_FIELDS = Object.freeze({
  'Plant':                  { col: 'plant', type: 'text' },
  'TYPE':                   { col: 'type', type: 'text', oneOf: ['N', 'B', 'T', 'C', 'H'] },
  'Die Size':               { col: 'die_size', type: 'text' },
  'Cavity':                 { col: 'cavity', type: 'int', max: 10000 },
  'Mandrels per Cavity':    { col: 'mandrels_per_cavity', type: 'int', max: 10000 },
  'Total Mandrels':         { col: 'total_mandrels', type: 'int', max: 100000 },
  'Type of shipment':       { col: 'shipment_type', type: 'text', oneOf: ['AIR', 'LAND'] },
  'Supplier':               { col: 'supplier', type: 'text' },
  'Customer Name':          { col: 'customer_name', type: 'text' },
  'PR Number':              { col: 'pr_number', type: 'text' },
  'Press':                  { col: 'press', type: 'text' },
  'simulationEnabled':      { col: 'simulation_enabled', type: 'bool', storedAsInt: true },
  'Urgency':                { col: 'urgency', type: 'urgency' },
  'specialFollowUp':        { col: 'special_follow_up', type: 'bool' },
  'STATUS':                 { col: 'status', type: 'text', oneOf: STATUSES },
  'Die Requested Date':     { col: 'die_requested_date', type: 'date' },
  'Design Received Date':   { col: 'design_received_date', type: 'date' },
  '3D Model Received Date': { col: 'three_d_model_received_date', type: 'date' },
  'Design Approved Date':   { col: 'design_approved_date', type: 'date' },
  'PR Entry':               { col: 'pr_entry', type: 'datetext' },
  'Oracle Entry':           { col: 'oracle_entry', type: 'datetext' },
  'Ordered date':           { col: 'ordered_date', type: 'date' },
  'ETA':                    { col: 'eta', type: 'datetext' },
  'Die Received Date':      { col: 'die_received_date', type: 'date' },
  'Submission Date':        { col: 'submission_date', type: 'date' },
  'Sample Approval Date':   { col: 'sample_approval_date', type: 'date' },
  'No of Trial':            { col: 'no_of_trial', type: 'int', max: 1000 },
  'Corrector':              { col: 'corrector', type: 'text' },
});

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const textOf = (value) => (value === null || value === undefined ? '' : String(value).trim());

// Same mapping as normalizeUrgencyInput in routes/orders.cjs.
function normalizeUrgency(value) {
  const s = textOf(value).toUpperCase().replace(/\s+/g, '_');
  if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
  if (s === 'URGENT') return 'URGENT';
  return 'NORMAL';
}

// One comparable form per type. Stored and incoming values both pass through
// here, so '', null and '  ' match, and 15/09/2026 matches 2026-09-15.
function canonical(type, value) {
  const text = textOf(value);
  switch (type) {
    case 'int': {
      if (text === '') return 0;
      const n = Math.round(Number(text));
      return n === 0 ? 0 : n; // folds -0 into 0
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

// A column's "not set yet" value.
function isEmpty(type, value) {
  if (type === 'int') return value === 0;
  if (type === 'bool') return value === false;
  if (type === 'urgency') return false;
  return value === null;
}

// Refuses a new value the column cannot take.
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

// The edits that really change something, one entry per field. `before` and
// `fields` are both keyed by drawer field ('Ordered date', not ordered_date).
function planChanges(before, fields) {
  const changes = [];
  for (const [field, raw] of Object.entries(fields || {})) {
    if (!hasOwn(EDITABLE_FIELDS, field)) {
      throw new OrderEditError(`${field} cannot be changed from Order Details`);
    }
    const { type } = EDITABLE_FIELDS[field];
    const stored = before ? before[field] : undefined;
    // Sent back untouched: whatever the column holds is already stored, so an
    // odd legacy value never blocks saving the fields that did change.
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

// Filling an empty field needs no reason. Status is derived from the dates as
// they are filled in, so an ordinary status step needs none either; only a
// move into or out of CANCELLED or HOLD does.
function changeNeedsReason({ field, kind, before, after }) {
  if (field === 'STATUS') return REASON_STATUSES.includes(before) || REASON_STATUSES.includes(after);
  return kind !== 'filled';
}

const needsReason = (changes) => changes.some(changeNeedsReason);

// How a value is written to the change log.
function displayValue(field, value) {
  const { type } = EDITABLE_FIELDS[field];
  if (type === 'bool') return value ? 'Yes' : 'No';
  if (type === 'int') return String(value);
  return value === null || value === undefined ? null : String(value);
}

function validateReason(reason) {
  const text = textOf(reason);
  if (text.length > REASON_MAX) {
    throw new OrderEditError(`Keep the reason to ${REASON_MAX} characters or fewer`);
  }
  return text || null;
}

function canEditOrderDetails(user) {
  return !!user && (user.role === 'admin' || user.canEditOrderDetails === true);
}

// A die_orders row keyed by drawer field, for planChanges.
function fromRow(row) {
  return Object.fromEntries(Object.entries(EDITABLE_FIELDS).map(([field, { col }]) => [field, row[col]]));
}

// What to write: simulation_enabled is an INTEGER column, not a boolean.
function columnValue(field, value) {
  return EDITABLE_FIELDS[field].storedAsInt ? (value ? 1 : 0) : value;
}

module.exports = {
  EDITABLE_FIELDS, STATUSES, REASON_MAX, OrderEditError,
  canonical, planChanges, changeNeedsReason, needsReason, displayValue,
  validateReason, canEditOrderDetails, fromRow, columnValue,
};
