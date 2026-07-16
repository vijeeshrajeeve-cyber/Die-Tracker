'use strict';

// Fields whose "received" date must be preserved on first receipt and recorded
// against the latest open revision on subsequent (post-revision) receipts.
const RECEIVED_FIELDS = {
  'Design Received Date':   { orderCol: 'design_received_date',        revisionCol: 'design_received_date' },
  '3D Model Received Date': { orderCol: 'three_d_model_received_date', revisionCol: 'model_received_date' },
};

function isEmpty(v) {
  return v == null || String(v).trim() === '';
}

// Decide where a stage-completion date should be written.
// - Unknown field: order column (null → caller handles generically).
// - Known field, no existing value: order column (first receipt).
// - Known field, existing value present: latest open revision row (re-receipt).
function planReceivedDate({ field, existingValue }) {
  const mapping = RECEIVED_FIELDS[field];
  if (!mapping) {
    return { writeTo: 'order', orderCol: null, revisionCol: null };
  }
  if (isEmpty(existingValue)) {
    return { writeTo: 'order', orderCol: mapping.orderCol, revisionCol: mapping.revisionCol };
  }
  return { writeTo: 'revision', orderCol: mapping.orderCol, revisionCol: mapping.revisionCol };
}

module.exports = { RECEIVED_FIELDS, planReceivedDate, isEmpty };
