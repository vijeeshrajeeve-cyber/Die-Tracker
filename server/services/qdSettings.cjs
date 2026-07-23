'use strict';

function parseIds(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
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
  };
}

async function saveQdSettings(pool, { approverUserIds, purchaseEmailTo, purchaseEmailCc }) {
  const ids = JSON.stringify((approverUserIds || []).map(Number).filter(Number.isFinite));
  const existing = await pool.query('SELECT id FROM qd_settings ORDER BY id LIMIT 1');
  if (existing.rows.length) {
    await pool.query(
      `UPDATE qd_settings SET approver_user_ids = $1, purchase_email_to = $2,
              purchase_email_cc = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '', existing.rows[0].id]);
  } else {
    await pool.query(
      `INSERT INTO qd_settings (approver_user_ids, purchase_email_to, purchase_email_cc)
       VALUES ($1, $2, $3)`,
      [ids, purchaseEmailTo || '', purchaseEmailCc || '']);
  }
}

module.exports = { parseIds, isApprover, getQdSettings, saveQdSettings };
