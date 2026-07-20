'use strict';

function extractProfileFromDie(dieNo) {
  if (dieNo === null || dieNo === undefined) return null;
  const cleaned = String(dieNo).trim().split('-')[0].replace(/^0+/, '');
  return cleaned || null;
}

// Normalize a plant label so 'GEX 01' and 'GEX 1' (and case/space variants) compare equal.
function normalizePlant(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\b0+(\d+)\b/g, '$1');
}

function cleanPressToken(raw) {
  return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
}

// Resolve any press representation (press_name "PRESS 8", PDF token "P8", bare "8",
// master press_code "P35"/"E") to the canonical press_name using the presses master.
// Falls back to the cleaned token when nothing matches.
function canonicalPress(raw, presses) {
  const c = cleanPressToken(raw);
  if (!c) return '';
  for (const p of (presses || [])) {
    const nameClean = cleanPressToken(p.press_name);
    const codeClean = cleanPressToken(p.press_code);
    const num = (String(p.press_name || '').match(/\d+/) || [])[0];
    if (c === nameClean || (codeClean && c === codeClean) || (num && (c === 'P' + num || c === num))) {
      return p.press_name;
    }
  }
  return c;
}

async function loadPresses(client) {
  try {
    const { rows } = await client.query('SELECT press_name, press_code FROM presses');
    return rows;
  } catch {
    return [];
  }
}

function hasFullKey({ profile, plant, press, cavity }) {
  return Boolean(profile) && Boolean(plant) && Boolean(press) &&
    cavity !== null && cavity !== undefined && cavity !== '';
}

async function findActiveMatch(client, { profile, plant, press, cavity }) {
  if (!hasFullKey({ profile, plant, press, cavity })) return null;
  const presses = await loadPresses(client);
  const { rows } = await client.query(
    `SELECT * FROM frozen_designs
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4
         AND is_active = true
       LIMIT 1`,
    [profile, normalizePlant(plant), canonicalPress(press, presses), Math.round(Number(cavity))]
  );
  return rows[0] || null;
}

async function freezeDesign(client, { profile, plant, press, cavity, sourceOrderId, frozenBy, notes, supplier, dieSize }) {
  const cav = Math.round(Number(cavity));
  const presses = await loadPresses(client);
  plant = normalizePlant(plant);
  press = canonicalPress(press, presses);
  // Deactivate any existing active design for this key.
  await client.query(
    `UPDATE frozen_designs SET is_active = false, released_at = CURRENT_TIMESTAMP,
       released_by = $5, release_reason = 'superseded'
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4 AND is_active = true`,
    [profile, plant, press, cav, frozenBy || null]
  );
  const { rows } = await client.query(
    `INSERT INTO frozen_designs (profile_number, plant, press, cavity, source_order_id, frozen_by, notes, supplier, die_size)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [profile, plant, press, cav, sourceOrderId || null, frozenBy || null, notes || null, supplier || null, dieSize || null]
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
       fz.username AS frozen_by_name,
       rl.username AS released_by_name,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'released')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'released')
         AS released_count,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'bypassed')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'bypassed')
         AS bypassed_count
       FROM frozen_designs fd
       LEFT JOIN users fz ON fz.id = fd.frozen_by
       LEFT JOIN users rl ON rl.id = fd.released_by
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

// Given a list of keys [{ id, profile, plant, press, cavity }], return a map of
// id -> { id, frozen_at, files_count } for those that match an active frozen design.
// One presses query + one frozen_designs query regardless of list size.
async function matchBulk(client, keys) {
  const result = {};
  if (!Array.isArray(keys) || keys.length === 0) return result;
  const presses = await loadPresses(client);
  const { rows } = await client.query(
    `SELECT fd.id, fd.profile_number, fd.plant, fd.press, fd.cavity, fd.frozen_at,
            (SELECT COUNT(*) FROM frozen_design_files f WHERE f.frozen_design_id = fd.id) AS files_count
       FROM frozen_designs fd WHERE fd.is_active = true`
  );
  const map = new Map();
  for (const r of rows) {
    map.set(`${r.profile_number}|${r.plant}|${r.press}|${r.cavity}`, r);
  }
  for (const k of (keys || [])) {
    if (!hasFullKey(k)) continue;
    const lookup = `${k.profile}|${normalizePlant(k.plant)}|${canonicalPress(k.press, presses)}|${Math.round(Number(k.cavity))}`;
    const m = map.get(lookup);
    if (m) result[k.id] = { id: m.id, frozen_at: m.frozen_at, files_count: Number(m.files_count) || 0 };
  }
  return result;
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

module.exports = { extractProfileFromDie, normalizePlant, cleanPressToken, canonicalPress, loadPresses, hasFullKey, findActiveMatch, matchBulk, freezeDesign, listFrozenDesigns, manualRelease };
