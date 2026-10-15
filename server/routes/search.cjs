'use strict';
// Universal search (the Ctrl+K palette). Mounted behind authMiddleware only:
// a user may read one group and not the other, so access is decided per group
// here, with the same rules /api/orders and /api/quality-discrepancies use.
const express = require('express');
const { pool } = require('../db.cjs');
const search = require('../services/search.cjs');
const { canReadSource } = require('../services/workQueuePermissions.cjs');
const { presentOrder } = require('../services/orderPresentation.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');
const qdSettings = require('../services/qdSettings.cjs');

const router = express.Router();

const ORDER_MATCH = search.matchClause(search.ORDER_SEARCH.fields);
const ORDER_RANK = search.rankClause(search.ORDER_SEARCH);
const QD_MATCH = search.matchClause(search.QD_SEARCH.fields);
const QD_RANK = search.rankClause(search.QD_SEARCH);

const presentQd = (row) => ({
  id: row.id, qd_no: row.qd_no, die_no: row.die_no, supplier: row.supplier, plant: row.plant,
  status: row.status, approval_state: row.approval_state, raised_date: row.raised_date,
});

async function findOrders(q) {
  const pattern = search.containsPattern(q);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT o.*, (SELECT COUNT(*) FROM order_changes c WHERE c.order_id = o.id)::int AS change_count,
         (SELECT f.id FROM die_order_files f
           WHERE f.order_id = o.id AND f.slot = 'profile_image' AND f.replaced_at IS NULL) AS profile_image_id
       FROM die_orders o WHERE ${ORDER_MATCH}
       ORDER BY ${ORDER_RANK}, o.created_at DESC LIMIT ${search.CANDIDATE_LIMIT}`,
      [pattern, q.toLowerCase(), search.prefixPattern(q)],
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM die_orders WHERE ${ORDER_MATCH}`, [pattern]),
  ]);
  return {
    items: search.rankRows(rows.rows, q, search.ORDER_SEARCH)
      .map(({ row, matchedField }) => ({ ...presentOrder(row), profileImageId: row.profile_image_id ?? null, matchedField })),
    total: count.rows[0].total,
  };
}

// A draft QD belongs to whoever is writing it, the same rule as the tracker's
// excludeDrafts / onlyDrafts split.
async function findQds(q, userId) {
  const pattern = search.containsPattern(q);
  const [rows, count] = await Promise.all([
    pool.query(
      `SELECT * FROM quality_discrepancies WHERE ${QD_MATCH}
       AND (approval_state <> 'Draft' OR created_by = $4)
       ORDER BY ${QD_RANK}, raised_date DESC, id DESC LIMIT ${search.CANDIDATE_LIMIT}`,
      [pattern, q.toLowerCase(), search.prefixPattern(q), userId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM quality_discrepancies WHERE ${QD_MATCH}
       AND (approval_state <> 'Draft' OR created_by = $2)`,
      [pattern, userId],
    ),
  ]);
  return {
    items: search.rankRows(rows.rows, q, search.QD_SEARCH)
      .map(({ row, matchedField }) => ({ ...presentQd(row), matchedField })),
    total: count.rows[0].total,
  };
}

// GET /api/search?q=
router.get('/', async (req, res) => {
  const q = search.normaliseQuery(req.query.q);
  if (!q) return res.status(400).json({ error: `Type between ${search.MIN_QUERY_LENGTH} and ${search.MAX_QUERY_LENGTH} characters` });
  try {
    const [orders, qds] = await Promise.all([
      canReadSource(req.user, 'order') ? findOrders(q) : null,
      canReadSource(req.user, 'qd') ? findQds(q, req.user.id) : null,
    ]);
    res.json({ ...(orders && { orders }), ...(qds && { qds }) });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/search/qd/:id — the full QD a search result opens. The tracker's own
// list leaves out drafts and anything outside its filters, so the drawer is
// handed this record directly, the same way the Work Queue does it.
router.get('/qd/:id', async (req, res) => {
  if (!canReadSource(req.user, 'qd')) return res.status(403).json({ error: 'Page access required' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid QD id' });
  try {
    const record = (await qd.listQDs(pool, id))[0];
    if (!record || (record.approval_state === 'Draft' && record.created_by !== req.user.id)) {
      return res.status(404).json({ error: 'QD not found' });
    }
    const settings = await qdSettings.getQdSettings(pool);
    record.can_approve = qdSettings.isApprover(req.user, settings.approverUserIds) && qd.canActOnApproval(req.user, record);
    record.assigned_approver_name = record.assigned_approver
      ? (await pool.query('SELECT username FROM users WHERE id=$1', [record.assigned_approver])).rows[0]?.username || null
      : null;
    res.json(record);
  } catch (error) {
    console.error('Search QD record error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
