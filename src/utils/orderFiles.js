/**
 * Order Details drawer attachments, client copy. server/services/orderFiles.cjs
 * is the authority; this copy checks a picked file early and builds the Review
 * changes rows, and orderFiles.test.js fails if the two ever disagree.
 */

// Slot -> label. The label is also the change log's field name.
export const ORDER_FILE_SLOTS = Object.freeze({
  die_order_form: 'Die Order Form',
  design_pdf: 'Die Design PDF',
});

export const ORDER_FILE_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

// Why a picked file cannot be attached, or null when it can.
export function orderFileProblem(file) {
  if (!/\.pdf$/i.test(file?.name || '')) return 'Attach the file as a PDF';
  if (file.size > ORDER_FILE_MAX_BYTES) return `File too large (max ${ORDER_FILE_MAX_BYTES / 1024 / 1024} MB)`;
  return null;
}

// The files picked in edit mode against the stored ones, as Review changes rows.
export function planFileChanges(current, staged) {
  return Object.keys(ORDER_FILE_SLOTS)
    .filter((slot) => staged?.[slot])
    .map((slot) => ({
      slot,
      label: ORDER_FILE_SLOTS[slot],
      kind: current?.[slot] ? 'replaced' : 'attached',
      before: current?.[slot]?.original_name ?? null,
      after: staged[slot].name,
    }));
}

// Like a value: attaching the first file needs no reason, replacing one does.
export const fileChangeNeedsReason = (change) => change.kind === 'replaced';

export const bySlot = (files) => Object.fromEntries((files || []).map((f) => [f.slot, f]));
