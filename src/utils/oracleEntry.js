import { WORKFLOW_STEPS } from './constants.js';
import { SUPPLIER_ALIASES } from './dieOrderPrefill.js';

// Oracle Entry rules shared by the flow pages, the order drawer and the Oracle
// batch. A tooling (order type T) is not a separate asset in Oracle, so it
// skips the Oracle Entry stage and never goes into a batch.

export const isTooling = (order) => String(order?.TYPE ?? '').trim().toUpperCase() === 'T';

// The status an order moves to when `status` is completed.
export const nextStatusAfter = (order, status) => (
  status === 'PENDING FOR PR' && isTooling(order)
    ? 'PENDING FOR DESIGN TO EMS'
    : WORKFLOW_STEPS[status]?.nextStatus ?? null
);

// When an order entered Design to EMS: its Oracle entry, or for a tooling,
// which skipped Oracle Entry, its PR entry.
export const designToEmsSince = (order) => order?.['Oracle Entry'] || order?.['PR Entry'] || null;

// ── The Oracle batch ────────────────────────────────────────────────────────
// What Dinesh types into Oracle's Create Item / Update GEX screens for one die,
// worked out from the order. Fixed values (category, status, correctors…) are
// Oracle conventions and live in the Fill die bookmark, not here.

// First line of a copied batch, so the bookmark knows what was pasted.
export const ORACLE_BATCH_MARK = 'DIETRACKER-ORACLE-BATCH v1';

// Die life Oracle is given at creation, in mT (user decision 2026-10-24).
const DIE_LIFE = { HOLLOW: 55, SOLID: 50 };

// Press codes that are not "P<number>": the presses master (init.sql) maps
// them to the press Oracle lists by number.
const PRESS_CODES = { B: '2', D: '4', E: '5', F: '6', I: '9', P25: '7', P35: '8' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const oraclePress = (raw) => {
  const code = String(raw ?? '').replace(/\s+/g, '').toUpperCase();
  if (!code) return null;
  if (PRESS_CODES[code]) return PRESS_CODES[code];
  const number = code.match(/^P?(\d{1,2})$/);
  return number ? String(Number(number[1])) : null;
};

// dd-Mon-yyyy from the tracker's YYYY-MM-DD (or day-first) text.
const oracleDate = (raw) => {
  const text = String(raw ?? '').trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}`;
  m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[1].padStart(2, '0')}-${MONTHS[Number(m[2]) - 1]}-${m[3]}`;
  return null;
};

const supplierNamesFor = (code) => [
  code, ...Object.keys(SUPPLIER_ALIASES).filter((alias) => SUPPLIER_ALIASES[alias] === code),
];

export const toOracleDie = (order) => {
  if (isTooling(order)) return { ok: false, reason: 'tooling — not an Oracle asset' };
  const dieNo = String(order?.['DIE NO'] ?? '').trim();
  const split = dieNo.match(/^([A-Za-z0-9]+)-(\d+)$/);
  if (!split) return { ok: false, reason: 'die number is not <profile>-<index>' };
  const [, profileId, dieIndex] = split;

  const flags = [];
  const type = String(order['Die Type'] ?? '').toUpperCase();
  const dieLife = DIE_LIFE[type] ?? null;
  if (!dieLife) flags.push('die type missing');
  const size = String(order['Die Size'] ?? '').match(/(\d{2,4})\s*[Xx×]\s*(\d{2,4})/);
  if (!size) flags.push('die size not readable');
  const press = oraclePress(order.Press);
  if (!press) flags.push('press missing');
  const orderedDate = oracleDate(order['Ordered date']);
  if (!orderedDate) flags.push('ordered date missing');
  const supplier = String(order.Supplier ?? '').trim().toUpperCase();
  const knownSupplier = supplier && supplier !== 'UNKNOWN' ? supplier : null;
  if (!knownSupplier) flags.push('supplier missing');

  return { ok: true, die: {
    dieNo, profileId, dieIndex, itemCode: `GEX.DIE_${profileId}_${dieIndex}`,
    cavities: Number(order.Cavity) || null,
    diameter: size ? Number(size[1]) : null,
    thickness: size ? Number(size[2]) : null,
    supplier: knownSupplier,
    supplierNames: knownSupplier ? supplierNamesFor(knownSupplier) : [],
    dieType: dieLife ? type[0] + type.slice(1).toLowerCase() : null,
    dieLife, press, orderedDate, flags,
  } };
};

export const buildOracleBatch = (orders) => {
  const dies = [];
  const skipped = [];
  for (const order of orders || []) {
    const result = toOracleDie(order);
    if (result.ok) dies.push(result.die);
    else skipped.push({ dieNo: order?.['DIE NO'] ?? '', reason: result.reason });
  }
  return { dies, skipped, text: `${ORACLE_BATCH_MARK}
${JSON.stringify(dies)}` };
};
