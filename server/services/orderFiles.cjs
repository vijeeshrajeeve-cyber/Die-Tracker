'use strict';
const path = require('path');
const { OrderEditError } = require('./orderDetailEdits.cjs');

// The Order Details drawer's attachments: one current file per slot. Each
// label is also the change log's field name. src/utils/orderFiles.js mirrors
// these and orderFiles.test.js fails if the two ever disagree.
const SLOTS = Object.freeze({
  die_order_form: 'Die Order Form',
  design_pdf: 'Die Design PDF',
});

const ALLOWED_EXTENSIONS = ['pdf'];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function getRoot() {
  return process.env.ORDER_FILES_ROOT || '/app/storage/order-files';
}

// Keep temp uploads on the same filesystem as the storage root so moving a
// finished upload into place is an intra-device rename (no EXDEV across the
// Docker volume boundary).
function getTmpDir() {
  return path.join(getRoot(), '.uploads-tmp');
}

function extOf(name) {
  const base = String(name || '');
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return '';
  return base.slice(dot + 1).toLowerCase();
}

function isAllowedExtension(name) {
  return ALLOWED_EXTENSIONS.includes(extOf(name));
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || '')).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || 'file';
}

function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '') || '_';
}

function isInsideRoot(root, p) {
  return path.resolve(p).startsWith(path.resolve(root) + path.sep);
}

// A replaced file stays on disk, so the stamp keeps a new upload with the same
// name from overwriting it.
function buildStoredPath(root, { dieNo, orderId, slot, stamp, fileName }) {
  const dest = path.join(root, sanitizeSegment(dieNo), sanitizeSegment(orderId), sanitizeSegment(slot),
    `${stamp}_${sanitizeFilename(fileName)}`);
  // Callers mkdir and move to this path, so refuse rather than write elsewhere.
  if (!isInsideRoot(root, dest)) throw new Error('Refusing to store a file outside the storage root');
  return dest;
}

// The drawer's rule for values applies to files: attaching the first one needs
// no reason, replacing one does. Returns the change log entry.
function planUpload({ slot, current, fileName, reason }) {
  const field = SLOTS[slot];
  if (current && !reason) {
    throw new OrderEditError(`Give a reason for replacing the ${field}`, 'REASON_REQUIRED', [field]);
  }
  return { field, oldValue: current ? current.original_name : null, newValue: fileName, reason };
}

module.exports = {
  SLOTS, ALLOWED_EXTENSIONS, MAX_FILE_BYTES,
  getRoot, getTmpDir, isAllowedExtension, sanitizeFilename, sanitizeSegment, isInsideRoot, buildStoredPath, planUpload,
};
