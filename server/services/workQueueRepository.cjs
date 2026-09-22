'use strict';

const permissions = require('./workQueuePermissions.cjs');
const calendar = require('./workQueueCalendar.cjs');
const qdSettings = require('./qdSettings.cjs');

function fail(status, message) { return Object.assign(new Error(message), { status }); }
function positiveId(value) {
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw fail(400, 'Invalid ID');
  return Number(value);
}
async function context(db, user) {
  const grants = (await db.query('SELECT * FROM work_queue_grants WHERE user_id=$1', [user.id])).rows;
  const { approverUserIds } = await qdSettings.getQdSettings(db);
  return { grants, approverUserIds, isQdApprover: qdSettings.isApprover(user, approverUserIds) };
}
const TABS = { pending_order:'flow-pending-order', awaiting_design:'flow-awaiting-design', simulation:'flow-simulation', design_approval:'flow-design-approval', pending_pr:'flow-pending-pr', oracle_entry:'flow-oracle-entry', design_to_ems:'flow-design-ems', manufacturing:'flow-completed', sample_submission:'flow-sample-followup', sample_approval:'flow-sample-followup' };
function serialize(item, user, ctx, now = new Date()) {
  const manage = permissions.canManageItem(user, item, ctx.grants);
  const mine = permissions.isMine(item, user, ctx);
  const active = ['active','paused'].includes(item.state);
  return { ...item, deadline_state: calendar.classify(item, now), can_manage: manage && active,
    can_assign: manage && active && item.owner_mode !== 'source',
    can_note: active && (manage || mine), can_snooze: active && mine,
    can_override_deadline: active && manage && item.deadline_basis !== 'eta',
    source_action: { kind:item.source_kind, id:item.source_id, tab:item.source_kind === 'qd' ? 'qd-tracker' : item.source_kind === 'sample' ? 'flow-sample-followup' : (TABS[item.stage_key] || 'orders') },
  };
}
async function getItem(db, id, user, lock = false) {
  const { rows } = await db.query(`SELECT i.*, u.username AS owner_name FROM work_queue_items i LEFT JOIN users u ON u.id=i.owner_id WHERE i.id=$1 ${lock ? 'FOR UPDATE OF i' : ''}`, [positiveId(id)]);
  if (!rows.length || !permissions.canReadSource(user, rows[0].source_kind)) throw fail(404, 'Work item not found');
  return rows[0];
}
async function detail(db, id, user) {
  const item = await getItem(db, id, user);
  const ctx = await context(db, user);
  const events = (await db.query('SELECT id,kind,note,actor_name,created_at,before_data,after_data FROM work_queue_events WHERE item_id=$1 ORDER BY id DESC LIMIT 200', [item.id])).rows;
  const result = serialize(item, user, ctx);
  return { item:result, events, can_manage:result.can_manage, can_note:result.can_note };
}
async function list(db, query, user) {
  const ctx = await context(db, user);
  const kinds = ['order','sample','qd'].filter(kind => permissions.canReadSource(user, kind));
  const page = Math.max(1, Math.min(1000000, parseInt(query.page,10) || 1));
  const limit = Math.max(1, Math.min(100, parseInt(query.limit,10) || 50));
  const scope = ['mine','team','unassigned'].includes(query.scope) ? query.scope : 'mine';
  const bucket = ['overdue','today','upcoming','setup','paused'].includes(query.bucket) ? query.bucket : 'all';
  const now = new Date();
  const values = [kinds, user.id, ctx.isQdApprover, query.plant || null, String(query.q || '').slice(0,200), now.toISOString()];
  const cte = `WITH authorized AS (
    SELECT i.*,u.username AS owner_name,
      CASE WHEN i.stage_key='qd_approval' THEN $3::boolean AND (i.owner_id=$2 OR i.owner_id IS NULL) ELSE i.owner_id=$2 END AS mine,
      CASE WHEN i.state='paused' THEN 'paused' WHEN i.setup_reason IS NOT NULL OR i.due_at IS NULL THEN 'setup'
        WHEN i.due_at<$6::timestamptz THEN 'overdue'
        WHEN (i.due_at AT TIME ZONE i.timezone)::date=($6::timestamptz AT TIME ZONE i.timezone)::date THEN 'today' ELSE 'upcoming' END AS bucket
    FROM work_queue_items i LEFT JOIN users u ON u.id=i.owner_id
    WHERE i.state IN ('active','paused') AND i.source_kind=ANY($1::text[])
  ), filtered AS (SELECT * FROM authorized WHERE ($4::text IS NULL OR plant=$4)
    AND ($5='' OR concat_ws(' ',die_no,stage_label,plant,supplier,owner_name) ILIKE '%'||$5||'%'))`;
  const scopeSql = scope === 'mine' ? 'mine IS TRUE' : scope === 'unassigned' ? 'owner_id IS NULL' : 'TRUE';
  const counts = (await db.query(`${cte} SELECT count(*)::int AS team,count(*) FILTER(WHERE mine)::int AS mine,count(*) FILTER(WHERE owner_id IS NULL)::int AS unassigned,
    count(*) FILTER(WHERE ${scopeSql} AND bucket='overdue')::int AS overdue,count(*) FILTER(WHERE ${scopeSql} AND bucket='today')::int AS today,
    count(*) FILTER(WHERE ${scopeSql} AND bucket='upcoming')::int AS upcoming,count(*) FILTER(WHERE ${scopeSql} AND bucket='setup')::int AS setup,
    count(*) FILTER(WHERE ${scopeSql} AND bucket='paused')::int AS paused,
    count(*) FILTER(WHERE ${scopeSql} AND ($7='all' OR bucket=$7))::int AS total FROM filtered`, [...values,bucket])).rows[0];
  const items = (await db.query(`${cte} SELECT * FROM filtered WHERE ${scopeSql} AND ($7='all' OR bucket=$7)
    ORDER BY CASE bucket WHEN 'overdue' THEN 0 WHEN 'today' THEN 1 WHEN 'setup' THEN 2 WHEN 'upcoming' THEN 3 ELSE 4 END,due_at NULLS LAST,id LIMIT $8 OFFSET $9`, [...values,bucket,limit,(page-1)*limit])).rows;
  const plants = (await db.query("SELECT DISTINCT plant AS name FROM work_queue_items WHERE source_kind=ANY($1::text[]) AND state IN ('active','paused') AND plant IS NOT NULL ORDER BY plant", [kinds])).rows.map(p=>({id:p.name,name:p.name}));
  return { items:items.map(i=>serialize(i,user,ctx,now)), counts:{mine:counts.mine,team:counts.team,unassigned:counts.unassigned,buckets:{overdue:counts.overdue,today:counts.today,upcoming:counts.upcoming,setup:counts.setup,paused:counts.paused}}, total:counts.total,page,pages:Math.ceil(counts.total/limit),asOf:now.toISOString(),isAdmin:user.role==='admin',plants };
}
async function assignees(db, id, user) {
  const item = await getItem(db,id,user);
  const ctx = await context(db,user);
  if (!permissions.canManageItem(user,item,ctx.grants)) throw fail(403,'Only a coordinator can choose an owner');
  const users = (await db.query('SELECT id,username,role,page_access FROM users ORDER BY username')).rows;
  return { users:users.filter(u=>permissions.eligibleOwner(u,item,ctx.approverUserIds)).map(u=>({id:u.id,displayName:u.username})) };
}
module.exports = { fail,positiveId,context,serialize,getItem,detail,list,assignees };
