import { parseDateDMY } from './helpers.js';
import { STATUS_CONFIG } from './constants.js';
import { typeLabel, dieTypeLabel } from './dieType.js';
import { designToEmsSince } from './oracleEntry.js';
import { toExcelDate } from './exportExcel.js';

/**
 * Die order export: the columns the Export dialog offers and the rows it
 * writes. Shared by the Orders page button and the top bar's Export.
 */

export const parseDieSize = (dieSize) => {
  if (!dieSize) return { diameter: null, thickness: null };
  const cleaned = String(dieSize).toUpperCase().replace(/^DIA\s+/i, '');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)[Xx×](\d+(?:\.\d+)?)/);
  if (match) return { diameter: match[1], thickness: match[2] };
  const single = cleaned.match(/^(\d+(?:\.\d+)?)/);
  return single ? { diameter: single[1], thickness: null } : { diameter: null, thickness: null };
};

export const calcLeadDays = (startDate, endDate) => {
  if (!startDate || !endDate) return null;
  const start = new Date(startDate), end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return null;
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
};

// Date the order entered its current stage.
export const getStageEntryDate = (order) => {
  switch (order.STATUS) {
    case 'PENDING FOR ORDERING': return order['Die Requested Date'] || order.created_at;
    case 'AWAITING FOR DESIGN': return order['Ordered date'];
    case 'UNDER SIMULATION': return order['Design Received Date'];
    case 'PENDING FOR DESIGN APPROVAL':
      return order.simulationEnabled ? order['Simulation Completed Date'] : order['Design Received Date'];
    case 'PENDING FOR PR': return order['Design Approved Date'];
    case 'PENDING FOR ORACLE ENTRY': return order['PR Entry'];
    case 'PENDING FOR DESIGN TO EMS': return designToEmsSince(order);
    case 'DONE': return order['Design to EMS Date'];
    default: return null;
  }
};

export const daysInStage = (order, today = new Date()) => {
  const entry = getStageEntryDate(order);
  if (!entry) return null;
  const iso = typeof entry === 'string' && /\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}/.test(entry)
    ? parseDateDMY(entry)
    : entry;
  const start = new Date(iso);
  if (isNaN(start)) return null;
  const now = new Date(today);
  const days = Math.floor((now.setHours(0, 0, 0, 0) - start.setHours(0, 0, 0, 0)) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
};

const blank = (v) => (v === null || v === undefined ? '' : v);
// A column that may hold a date or free text (PR Entry, ETA): a real date when it is one.
const dateOrText = (v) => toExcelDate(typeof v === 'string' ? v : '') || blank(v);
const urgencyLabel = (v) => ({ URGENT: 'Urgent', TOP_URGENT: 'Top urgent' }[String(v || '').toUpperCase()] || 'Normal');
const yesNo = (v) => (v === true || v === 1 ? 'Yes' : 'No');

/**
 * Every column the dialog offers, in order. `id` is the label (labels are
 * unique; keys are not, Die Size feeds two columns). `default` marks the
 * columns the Orders page exported before the dialog existed.
 */
export function orderExportColumns({ dieReceivedDateMap = {}, today = new Date() } = {}) {
  const leadTime = (startKey) => (_, order) => {
    const days = calcLeadDays(order[startKey], dieReceivedDateMap[order['DIE NO']?.trim()]);
    return days === null ? '' : days;
  };
  const cols = [
    { key: 'DIE NO', label: 'Die No', default: true },
    { key: 'Order No', label: 'Order No', default: true },
    { key: 'Plant', label: 'Plant', default: true },
    { key: 'TYPE', label: 'Item Type', default: true, format: (v) => typeLabel(v) },
    { key: 'Die Type', label: 'Die Type', default: true, format: (v) => dieTypeLabel(v) },
    { key: 'Die Size', label: 'Diameter', default: true, format: (v) => parseDieSize(v).diameter || '' },
    { key: 'Die Size', label: 'Thickness', default: true, format: (v) => parseDieSize(v).thickness || '' },
    { key: 'Cavity', label: 'Cavity', default: true },
    { key: 'Supplier', label: 'Supplier', default: true },
    { key: 'Customer Name', label: 'Customer', default: true },
    { key: 'PR Number', label: 'PR Number', default: true },
    { key: 'Mandrels per Cavity', label: 'Mandrels per Cavity', default: true },
    { key: 'Total Mandrels', label: 'Total Mandrels', default: true },
    { key: 'Die Requested Date', label: 'Requested Date', default: true, format: 'date' },
    { key: 'Type of shipment', label: 'Shipment', default: true },
    { key: 'STATUS', label: 'Status', default: true, format: (v) => STATUS_CONFIG[v]?.label || v || '' },
    { key: 'Ordered date', label: 'Delivery Lead Time (days)', default: true, format: leadTime('Ordered date') },
    { key: 'Design Approved Date', label: 'Mfg Lead Time (days)', default: true, format: leadTime('Design Approved Date') },
    { key: 'STATUS', label: 'Days in Stage', default: true, format: (_, order) => blank(daysInStage(order, today)) },
    { key: 'Press', label: 'Press' },
    { key: 'Urgency', label: 'Urgency', format: urgencyLabel },
    { key: 'specialFollowUp', label: 'Special Follow-up', format: yesNo },
    { key: 'Ordered date', label: 'Ordered Date', format: 'date' },
    { key: 'Design Received Date', label: 'Design Received Date', format: 'date' },
    { key: '3D Model Received Date', label: '3D Model Received Date', format: 'date' },
    { key: 'Simulation Completed Date', label: 'Simulation Completed Date', format: 'date' },
    { key: 'Design Approved Date', label: 'Design Approved Date', format: 'date' },
    { key: 'PR Entry', label: 'PR Entry', format: dateOrText },
    { key: 'Oracle Entry', label: 'Oracle Entry', format: dateOrText },
    { key: 'Design to EMS Date', label: 'Design to EMS Date', format: 'date' },
    { key: 'ETA', label: 'ETA', format: dateOrText },
    { key: 'Die Received Date', label: 'Die Received Date', format: 'date' },
    { key: 'Submission Date', label: 'Sample Submission Date', format: 'date' },
    { key: 'Sample Approval Date', label: 'Sample Approval Date', format: 'date' },
    { key: 'No of Trial', label: 'Trials' },
    { key: 'Corrector', label: 'Corrector' },
    { key: 'Design Revision Count', label: 'Design Revisions' },
    { key: 'Simulation Count', label: 'Simulations Done' },
    { key: 'Delay', label: 'Design Delay (days)' },
    { key: 'OVERALL DELAY', label: 'Overall Delay (days)' },
    { key: 'Remark', label: 'Remark' },
  ];
  return cols.map((c) => ({ ...c, id: c.label, default: !!c.default }));
}

export const defaultColumnIds = (columns) => columns.filter((c) => c.default).map((c) => c.id);

// The chosen columns in catalogue order; ids the catalogue no longer has are dropped.
export const pickColumns = (columns, ids) => {
  const chosen = new Set(ids || []);
  return columns.filter((c) => chosen.has(c.id));
};

/**
 * The rows an export writes. `dateOf` reads an order's Requested date as
 * YYYY-MM-DD (the register's own parser, so both agree on edge cases);
 * `from`/`to` are inclusive and either may be empty.
 */
export function exportRows({ allRows, filteredRows, applyFilters, from, to, dateOf }) {
  const base = (applyFilters ? filteredRows : allRows) || [];
  if (!from && !to) return base;
  return base.filter((order) => {
    const d = dateOf(order);
    if (!d) return false;
    return (!from || d >= from) && (!to || d <= to);
  });
}

const FILTER_LABELS = {
  plant: 'Plant', status: 'Status', supplier: 'Supplier', type: 'Item type', month: 'Month',
  year: 'Year', customer: 'Customer', urgency: 'Urgency', specialFollowUp: 'Special follow-up',
};

// The Orders page filters that are on, in words, for the "Apply current filters" line.
export function describeFilters(filters = {}, searchTerm = '') {
  const parts = [];
  if (String(searchTerm || '').trim()) parts.push(`Search "${String(searchTerm).trim()}"`);
  for (const [field, label] of Object.entries(FILTER_LABELS)) {
    const v = filters[field];
    if (!v || v === 'all') continue;
    let shown = v;
    if (field === 'status') shown = v === 'pre-approval' ? 'Pre–design approval' : (STATUS_CONFIG[v]?.label || v);
    else if (field === 'type') shown = typeLabel(v);
    else if (field === 'urgency') shown = urgencyLabel(v);
    else if (field === 'specialFollowUp') shown = v === 'yes' ? 'Flagged' : 'Not flagged';
    parts.push(`${label}: ${shown}`);
  }
  if (filters.dateFrom || filters.dateTo) {
    parts.push(`Requested ${filters.dateFrom || '…'} to ${filters.dateTo || '…'}`);
  }
  return parts;
}
