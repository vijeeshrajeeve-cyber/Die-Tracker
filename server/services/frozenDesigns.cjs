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
       ed.username AS edited_by_name,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'released')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'released')
         AS released_count,
       (SELECT COUNT(*) FROM die_orders o WHERE o.frozen_design_id = fd.id AND o.frozen_design_action = 'bypassed')
       + (SELECT COUNT(*) FROM backup_die_requests b WHERE b.frozen_design_id = fd.id AND b.frozen_design_action = 'bypassed')
         AS bypassed_count
       FROM frozen_designs fd
       LEFT JOIN users fz ON fz.id = fd.frozen_by
       LEFT JOIN users rl ON rl.id = fd.released_by
       LEFT JOIN users ed ON ed.id = fd.edited_by
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

// Admin correction of a frozen design. Supplier, die size and notes can change on
// any version. The match key (profile/plant/press/cavity) only on the active one —
// a retired or superseded row is history — and never onto a key another active
// design already holds. Returns { ok } or { error, status }.
async function updateFrozenDesign(client, { id, userId, profile, plant, press, cavity, supplier, dieSize, notes }) {
  const { rows } = await client.query('SELECT * FROM frozen_designs WHERE id = $1', [id]);
  const d = rows[0];
  if (!d) return { error: 'Frozen design not found', status: 404 };

  const presses = await loadPresses(client);
  const next = {
    profile: profile === undefined ? d.profile_number : String(profile).trim(),
    plant: plant === undefined ? d.plant : normalizePlant(plant),
    press: press === undefined ? d.press : canonicalPress(press, presses),
    cavity: cavity === undefined ? d.cavity : Math.round(Number(cavity)),
  };
  if (!hasFullKey(next) || !(next.cavity > 0)) {
    return { error: 'Profile, plant, press and a cavity above 0 are required', status: 400 };
  }
  const keyChanged = next.profile !== d.profile_number || next.plant !== d.plant
    || next.press !== d.press || next.cavity !== d.cavity;
  if (keyChanged && !d.is_active) {
    return { error: 'Only the frozen version can change its profile, plant, press or cavity', status: 409 };
  }
  if (keyChanged) {
    const clash = await client.query(
      `SELECT id FROM frozen_designs WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4
         AND is_active = true AND id <> $5 LIMIT 1`,
      [next.profile, next.plant, next.press, next.cavity, id]
    );
    if (clash.rows.length) {
      return { error: `${next.profile} · ${next.plant} · ${next.press} · ${next.cavity} cav is already frozen as another design`, status: 409 };
    }
  }
  const text = (v, old) => (v === undefined ? old : (String(v).trim() || null));
  await client.query(
    `UPDATE frozen_designs SET profile_number = $1, plant = $2, press = $3, cavity = $4,
       supplier = $5, die_size = $6, notes = $7, edited_at = CURRENT_TIMESTAMP, edited_by = $8
       WHERE id = $9`,
    [next.profile, next.plant, next.press, next.cavity,
      text(supplier, d.supplier), text(dieSize, d.die_size), text(notes, d.notes), userId || null, id]
  );
  return { ok: true };
}

// Every die order and backup request that met a frozen design for the same
// Profile + Plant + Press + Cavity as design `id` — across all its versions, so a
// superseded version's history stays visible beside the current one.
async function listUsage(client, id) {
  const { rows } = await client.query(
    `WITH k AS (SELECT profile_number, plant, press, cavity FROM frozen_designs WHERE id = $1),
          v AS (SELECT fd.id FROM frozen_designs fd JOIN k ON fd.profile_number = k.profile_number
                  AND fd.plant = k.plant AND fd.press = k.press AND fd.cavity = k.cavity)
     SELECT 'order' AS kind, o.id, o.die_no::text AS die_no, o.order_no::text AS order_no, o.status::text AS status,
            o.created_at, o.frozen_design_id, o.frozen_design_action AS action,
            o.frozen_design_override_reason AS reason, o.frozen_design_override_note AS note
       FROM die_orders o WHERE o.frozen_design_id IN (SELECT id FROM v) AND o.frozen_design_action IS NOT NULL
     UNION ALL
     SELECT 'backup' AS kind, b.id, b.die_no::text, NULL::text, b.status::text,
            b.created_at, b.frozen_design_id, b.frozen_design_action,
            b.frozen_design_override_reason, b.frozen_design_override_note
       FROM backup_die_requests b WHERE b.frozen_design_id IN (SELECT id FROM v) AND b.frozen_design_action IS NOT NULL
     ORDER BY created_at DESC`,
    [id]
  );
  return rows;
}

module.exports = { extractProfileFromDie, normalizePlant, cleanPressToken, canonicalPress, loadPresses, hasFullKey, findActiveMatch, matchBulk, freezeDesign, listFrozenDesigns, manualRelease, listUsage, updateFrozenDesign };
