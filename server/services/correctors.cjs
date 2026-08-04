'use strict';

// Master list behind the Corrector dropdown. The corrector columns on
// die_orders, sample_followups and quality_discrepancies remain plain TEXT —
// this list constrains input, it is not a foreign key. See
// docs/superpowers/specs/2026-08-04-correctors-master-list-design.md.

// Names are people's names, so capitalisation is preserved. Contrast
// suppliers, which upper-cases because those are codes.
function normalizeName(raw) {
  return String(raw == null ? '' : raw).trim();
}

function normalizePlant(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s || null;
}

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function listCorrectors(pool, { plant, includeInactive } = {}) {
  const where = [];
  const params = [];
  if (plant) {
    params.push(plant);
    where.push(`plant = $${params.length}`);
  }
  if (!includeInactive) where.push('is_active = TRUE');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, plant, is_active FROM correctors ${clause} ORDER BY name`,
    params
  );
  return rows;
}

async function createCorrector(pool, { name, plant }) {
  const cleanName = normalizeName(name);
  if (!cleanName) throw fail(400, 'Corrector name is required');
  const cleanPlant = normalizePlant(plant);

  // NULL plants compare as distinct in a UNIQUE constraint, so check
  // explicitly rather than relying on ON CONFLICT.
  const existing = await pool.query(
    `SELECT id FROM correctors WHERE name = $1 AND plant IS NOT DISTINCT FROM $2`,
    [cleanName, cleanPlant]
  );
  if (existing.rows.length) {
    throw fail(409, `"${cleanName}" already exists${cleanPlant ? ` for ${cleanPlant}` : ''}`);
  }

  const { rows } = await pool.query(
    `INSERT INTO correctors (name, plant) VALUES ($1, $2)
     RETURNING id, name, plant, is_active`,
    [cleanName, cleanPlant]
  );
  return rows[0];
}

async function updateCorrector(pool, id, { name, plant, is_active }) {
  const found = await pool.query(
    'SELECT id, name, plant, is_active FROM correctors WHERE id = $1',
    [id]
  );
  if (!found.rows.length) return null;
  const current = found.rows[0];

  const nextName = name !== undefined ? normalizeName(name) : current.name;
  if (!nextName) throw fail(400, 'Corrector name is required');
  const nextPlant = plant !== undefined ? normalizePlant(plant) : current.plant;
  const nextActive = is_active !== undefined ? !!is_active : current.is_active;

  const { rows } = await pool.query(
    `UPDATE correctors SET name = $1, plant = $2, is_active = $3,
            updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 RETURNING id, name, plant, is_active`,
    [nextName, nextPlant, nextActive, id]
  );
  return rows[0];
}

// Soft delete only. Historical dies reference the name as a string, so a hard
// delete would leave those records pointing at a corrector who appears nowhere.
async function deactivateCorrector(pool, id) {
  const found = await pool.query('SELECT id FROM correctors WHERE id = $1', [id]);
  if (!found.rows.length) return null;
  const { rows } = await pool.query(
    `UPDATE correctors SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 RETURNING id, name, plant, is_active`,
    [id]
  );
  return rows[0];
}

module.exports = {
  normalizeName, normalizePlant,
  listCorrectors, createCorrector, updateCorrector, deactivateCorrector,
};
