'use strict';

function extractProfileFromDie(dieNo) {
  if (dieNo === null || dieNo === undefined) return null;
  const cleaned = String(dieNo).trim().split('-')[0].replace(/^0+/, '');
  return cleaned || null;
}

function hasFullKey({ profile, plant, press, cavity }) {
  return Boolean(profile) && Boolean(plant) && Boolean(press) &&
    cavity !== null && cavity !== undefined && cavity !== '';
}

async function findActiveMatch(client, { profile, plant, press, cavity }) {
  if (!hasFullKey({ profile, plant, press, cavity })) return null;
  const { rows } = await client.query(
    `SELECT * FROM frozen_designs
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4
         AND is_active = true
       LIMIT 1`,
    [profile, plant, press, Math.round(Number(cavity))]
  );
  return rows[0] || null;
}

async function freezeDesign(client, { profile, plant, press, cavity, sourceOrderId, frozenBy, notes }) {
  const cav = Math.round(Number(cavity));
  // Deactivate any existing active design for this key.
  await client.query(
    `UPDATE frozen_designs SET is_active = false, released_at = CURRENT_TIMESTAMP,
       released_by = $5, release_reason = 'superseded'
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4 AND is_active = true`,
    [profile, plant, press, cav, frozenBy || null]
  );
  const { rows } = await client.query(
    `INSERT INTO frozen_designs (profile_number, plant, press, cavity, source_order_id, frozen_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [profile, plant, press, cav, sourceOrderId || null, frozenBy || null, notes || null]
  );
  const newId = rows[0].id;
  // Point superseded rows (just deactivated for this key) at the new active one.
  await client.query(
    `UPDATE frozen_designs SET superseded_by = $1
       WHERE profile_number = $2 AND plant = $3 AND press = $4 AND cavity = $5
         AND is_active = false AND release_reason = 'superseded' AND superseded_by IS NULL AND id <> $1`,
    [newId, profile, plant, press, cav]
  );
  return newId;
}

async function listFrozenDesigns(client, { profile, plant, press, cavity, activeOnly } = {}) {
  const where = [];
  const params = [];
  if (profile) { params.push(profile); where.push(`fd.profile_number = $${params.length}`); }
  if (plant)   { params.push(plant);   where.push(`fd.plant = $${params.length}`); }
  if (press)   { params.push(press);   where.push(`fd.press = $${params.length}`); }
  if (cavity !== undefined && cavity !== null && cavity !== '') {
    params.push(Math.round(Number(cavity))); where.push(`fd.cavity = $${params.length}`);
  }
  if (activeOnly) where.push('fd.is_active = true');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { rows } = await client.query(
    `SELECT fd.*,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'released')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'released')
         AS released_count,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'bypassed')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'bypassed')
         AS bypassed_count
       FROM frozen_designs fd
       ${whereSql}
       ORDER BY fd.frozen_at DESC`,
    params
  );
  const ids = rows.map(r => r.id);
  let files = [];
  if (ids.length) {
    const fres = await client.query(
      `SELECT id, frozen_design_id, original_name, mime_type, size_bytes, uploaded_at
         FROM frozen_design_files WHERE frozen_design_id = ANY($1) ORDER BY uploaded_at ASC`,
      [ids]
    );
    files = fres.rows;
  }
  return rows.map(r => ({
    ...r,
    released_count: Number(r.released_count) || 0,
    bypassed_count: Number(r.bypassed_count) || 0,
    files: files.filter(f => f.frozen_design_id === r.id),
  }));
}

async function manualRelease(client, { id, userId }) {
  const { rowCount } = await client.query(
    `UPDATE frozen_designs SET is_active = false, released_at = CURRENT_TIMESTAMP,
       released_by = $1, release_reason = 'manual'
       WHERE id = $2 AND is_active = true`,
    [userId || null, id]
  );
  return rowCount > 0;
}

module.exports = { extractProfileFromDie, hasFullKey, findActiveMatch, freezeDesign, listFrozenDesigns, manualRelease };
