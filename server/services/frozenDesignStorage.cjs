'use strict';
const path = require('path');

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'dwg', 'dxf', 'step', 'stp'];
const MAX_FILE_BYTES = 100 * 1024 * 1024; // 100 MB

function getRoot() {
  return process.env.FROZEN_DESIGNS_ROOT || '/app/storage/frozen-designs';
}

// Temp upload dir kept ON THE SAME filesystem as the storage root so moving a
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

// Leading dots go too, so a segment of '..' (profile and press come straight
// from the request body) cannot climb out of the storage root.
function sanitizeSegment(value) {
  return String(value == null ? '' : value).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|_+$/g, '') || '_';
}

function isInsideRoot(root, p) {
  return path.resolve(p).startsWith(path.resolve(root) + path.sep);
}

function buildStoredPath(root, { profile, press, cavity, frozenDesignId, fileName }) {
  const dest = path.join(
    root,
    sanitizeSegment(profile),
    sanitizeSegment(press),
    sanitizeSegment(cavity),
    sanitizeSegment(frozenDesignId),
    sanitizeFilename(fileName)
  );
  // Callers mkdir and move to this path, so refuse rather than write elsewhere.
  if (!isInsideRoot(root, dest)) throw new Error('Refusing to store a file outside the storage root');
  return dest;
}

module.exports = {
  ALLOWED_EXTENSIONS,
  MAX_FILE_BYTES,
  getRoot,
  getTmpDir,
  isAllowedExtension,
  sanitizeFilename,
  sanitizeSegment,
  isInsideRoot,
  buildStoredPath,
};
