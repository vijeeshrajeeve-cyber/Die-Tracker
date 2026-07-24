'use strict';

// Default option lists for the raise/edit form's Press, Die Type and Alloy
// dropdowns. These are only fallbacks: they render when an admin hasn't set a
// list in Settings yet, and nothing is written to the DB until an admin saves.
// Presses in particular are plant-specific — set the real names in Settings.
const DEFAULT_PRESS_OPTIONS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
const DEFAULT_DIE_TYPE_OPTIONS = ['Solid', 'Hollow', 'Semi-hollow'];
const DEFAULT_ALLOY_OPTIONS = ['6060', '6063', '6061', '6005', '6082'];

function parseIds(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

// Trim, drop blanks and de-duplicate (case-insensitively, keeping first spelling).
function sanitizeList(list) {
  const seen = new Set();
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const s = String(v == null ? '' : v).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// Parse a stored JSON list; fall back to the code default when unset/empty/junk.
function parseList(raw, fallback) {
  const clean = sanitizeList((() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })());
  return clean.length ? clean : fallback;
}

function isApprover(user, approverUserIds) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return (approverUserIds || []).includes(user.id);
}

async function getQdSettings(pool) {
  const { rows } = await pool.query('SELECT * FROM qd_settings ORDER BY id LIMIT 1');
  const row = rows[0] || {};
  return {
    approverUserIds: parseIds(row.approver_user_ids),
    purchaseEmailTo: row.purchase_email_to || '',
    purchaseEmailCc: row.purchase_email_cc || '',
    pressOptions: parseList(row.press_options, DEFAULT_PRESS_OPTIONS),
    dieTypeOptions: parseList(row.die_type_options, DEFAULT_DIE_TYPE_OPTIONS),
    alloyOptions: parseList(row.alloy_options, DEFAULT_ALLOY_OPTIONS),
  };
}

async function saveQdSettings(pool, {
  approverUserIds, purchaseEmailTo, purchaseEmailCc, pressOptions, dieTypeOptions, alloyOptions,
}) {
  const ids = JSON.stringify((approverUserIds || []).map(Number).filter(Number.isFinite));
  const press = JSON.stringify(sanitizeList(pressOptions));
  const dieType = JSON.stringify(sanitizeList(dieTypeOptions));
  const alloy = JSON.stringify(sanitizeList(alloyOptions));
  const existing = await pool.query('SELECT id FROM qd_settings ORDER BY id LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      `UPDATE qd_settings SET approver_user_ids = $1, purchase_email_to = $2, purchase_email_cc = $3,
              press_options = $4, die_type_options = $5, alloy_options = $6,
              updated_at = CURRENT_TIMESTAMP WHERE id = $7`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '', press, dieType, alloy, existing.rows[0].id]);
  } else {
    await pool.query(
      `INSERT INTO qd_settings (approver_user_ids, purchase_email_to, purchase_email_cc,
              press_options, die_type_options, alloy_options)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '', press, dieType, alloy]);
  }
}

module.exports = {
  parseIds, parseList, sanitizeList, isApprover, getQdSettings, saveQdSettings,
  DEFAULT_PRESS_OPTIONS, DEFAULT_DIE_TYPE_OPTIONS, DEFAULT_ALLOY_OPTIONS,
};
