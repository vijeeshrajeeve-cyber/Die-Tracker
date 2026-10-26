import { TYPE_LABELS } from './constants.js';

// Two different things an order carries, kept apart on every page:
//   item type (die_orders.type)     N / B / T  → New / Backup / Tooling
//   die type  (die_orders.die_type) SOLID / HOLLOW

const clean = (value) => String(value ?? '').trim();

// "Backup" for 'B'; an unknown code is shown as stored; '' when blank.
export const typeLabel = (type) => TYPE_LABELS[clean(type).toUpperCase()] || clean(type);

// "Solid" / "Hollow"; anything else as stored; '' when blank.
export const dieTypeLabel = (dieType) => {
  const text = clean(dieType);
  const upper = text.toUpperCase();
  return upper === 'SOLID' || upper === 'HOLLOW' ? upper[0] + upper.slice(1).toLowerCase() : text;
};

// The SF (solid) / PH (hollow) code in the Copy ERP line. Taken from the die
// type; an order with none keeps the old rule (tooling SF, otherwise PH).
export const erpDieTypeCode = (order) => {
  const dieType = clean(order?.['Die Type']).toUpperCase();
  if (dieType === 'SOLID') return 'SF';
  if (dieType === 'HOLLOW') return 'PH';
  return clean(order?.TYPE).toUpperCase() === 'T' ? 'SF' : 'PH';
};

// An order's die type as one of the QD form's Die Type options (Settings),
// matched ignoring case; '' when the order has none.
export const qdDieTypeFor = (dieType, options = []) => {
  const label = dieTypeLabel(dieType);
  if (!label) return '';
  return options.find((o) => clean(o).toLowerCase() === label.toLowerCase()) || label;
};
