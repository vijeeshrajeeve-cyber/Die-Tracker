'use strict';
const path = require('path');

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB — QD evidence is photos and reports

function getRoot() {
  return process.env.QD_FILES_ROOT || '/app/storage/qd-files';
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

// Leading dots go too, so a segment of '..' (an imported QD No is only checked
// for being present) cannot climb out of the storage root.
function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '') || '_';
}

function isInsideRoot(root, p) {
  return path.resolve(p).startsWith(path.resolve(root) + path.sep);
}

function buildStoredPath(root, { qdNo, qdId, fileName }) {
  const dest = path.join(root, sanitizeSegment(qdNo), sanitizeSegment(qdId), sanitizeFilename(fileName));
  // Callers mkdir and move to this path, and the import route unlinks it on
  // rollback, so refuse before it is ever handed out.
  if (!isInsideRoot(root, dest)) throw new Error('Refusing to store a file outside the storage root');
  return dest;
}

module.exports = {
  ALLOWED_EXTENSIONS, MAX_FILE_BYTES,
  getRoot, getTmpDir, isAllowedExtension, sanitizeFilename, sanitizeSegment, isInsideRoot, buildStoredPath,
};
