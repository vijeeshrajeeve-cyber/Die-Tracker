'use strict';
// Storage helpers for tooling drawing files (DXF/DWG/PDF/TIF) kept on disk
// under TOOLING_FILES_ROOT; the database stores the root-relative path.
const crypto = require('node:crypto');
const path = require('node:path');
const { sanitizeFilename, sanitizeSegment, isInsideRoot } = require('./orderFiles.cjs');

const getRoot = () => process.env.TOOLING_FILES_ROOT || '/app/storage/tooling-files';

// Forward slashes always: the value is persisted and served on Linux.
const storedRelativePath = ({ number, sha256, originalName }) =>
  path.posix.join(sanitizeSegment(number), `${sha256.slice(0, 8)}_${sanitizeFilename(originalName)}`);

const absolutePath = (root, relative) => {
  const abs = path.resolve(root, relative);
  if (!isInsideRoot(root, abs)) throw new Error('Refusing to read a file outside the tooling storage root');
  return abs;
};

const FORMATS = { dxf: 'dxf', dwg: 'dwg', pdf: 'pdf', tif: 'tif', tiff: 'tif' };
const formatOf = (fileName) => FORMATS[path.extname(String(fileName)).slice(1).toLowerCase()] || null;

const sha256Of = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = { getRoot, storedRelativePath, absolutePath, formatOf, sha256Of };
