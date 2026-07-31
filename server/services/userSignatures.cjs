'use strict';
// Scanned signatures, one per user, drawn into the Signature column of the QD
// form. Stored as bytes in `user_signatures` (see db.cjs for why the database
// and not the filesystem).

// pdf-lib can only embed PNG and JPEG, so anything else would upload cleanly
// and then silently vanish from the PDF. Reject it at the door instead.
const ALLOWED_MIME = ['image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg'];
// A signature is a small crop, not a page scan. Keeping the cap low keeps the
// PDF (and the emailed attachment) small and keeps the JSON preview cheap.
const MAX_BYTES = 1024 * 1024;

const extOf = (name) => {
  const dot = String(name || '').lastIndexOf('.');
  return dot < 0 ? '' : String(name).slice(dot + 1).toLowerCase();
};

// Browsers are inconsistent about the mime they attach, so accept a file when
// either the declared type or the extension is one we can embed.
function isAllowed({ mimetype, originalname } = {}) {
  return ALLOWED_MIME.includes(String(mimetype || '').toLowerCase())
    || ALLOWED_EXTENSIONS.includes(extOf(originalname));
}

// Normalises to a mime pdf-lib can act on, whatever the browser claimed.
function mimeFor({ mimetype, originalname } = {}) {
  const declared = String(mimetype || '').toLowerCase();
  if (ALLOWED_MIME.includes(declared)) return declared;
  return extOf(originalname) === 'png' ? 'image/png' : 'image/jpeg';
}

async function saveSignature(pool, userId, { mimeType, bytes }) {
  await pool.query(
    `INSERT INTO user_signatures (user_id, mime_type, image, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE
       SET mime_type = EXCLUDED.mime_type, image = EXCLUDED.image, updated_at = CURRENT_TIMESTAMP`,
    [userId, mimeType, bytes]
  );
}

// Returns { mimeType, bytes, updatedAt } or null when the user has not uploaded one.
async function getSignature(pool, userId) {
  if (!userId) return null;
  const r = await pool.query('SELECT mime_type, image, updated_at FROM user_signatures WHERE user_id = $1', [userId]);
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  return { mimeType: row.mime_type, bytes: row.image, updatedAt: row.updated_at };
}

async function deleteSignature(pool, userId) {
  const r = await pool.query('DELETE FROM user_signatures WHERE user_id = $1', [userId]);
  return r.rowCount > 0;
}

// For the Settings preview: an <img>-ready data URL, since the browser cannot
// put an Authorization header on an <img src>.
function toDataUrl(signature) {
  if (!signature) return null;
  return `data:${signature.mimeType};base64,${Buffer.from(signature.bytes).toString('base64')}`;
}

module.exports = {
  ALLOWED_MIME, ALLOWED_EXTENSIONS, MAX_BYTES,
  isAllowed, mimeFor, saveSignature, getSignature, deleteSignature, toDataUrl,
};
