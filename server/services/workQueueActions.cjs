'use strict';
const { randomUUID } = require('node:crypto');
const repo = require('./workQueueRepository.cjs');
const permissions = require('./workQueuePermissions.cjs');
const cal = require('./workQueueCalendar.cjs');

function text(value, label, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw repo.fail(400, `${label} is required (maximum ${max} characters)`);
  return value.trim();
}
function snapshot(item) { return { ...item.calendar_snapshot, timezone:item.timezone, cutoff:String(item.cutoff || '17:00').slice(0,5) }; }
async function resumePreview(db,item) {
  const pauses = (await db.query('SELECT * FROM work_queue_pauses WHERE item_id=$1 ORDER BY id', [item.id])).rows;
  const already = new Set(pauses.flatMap(p=>p.credited_dates || []));
  const now = new Date();
  const credits = new Set(pauses.filter(p=>!p.end_at).flatMap(p=>cal.pauseCredit(p.start_at,now,snapshot(item))).filter(d=>!already.has(d)));
  const count = item.deadline_basis === 'eta' ? 0 : credits.size;
  const date = item.due_date && count ? cal.dueDate(item.due_date,count,item.deadline_basis,snapshot(item)) : item.due_date;
  return { dueDate:date,creditedDays:count,creditedDates:[...credits],localDay:cal.localDate(now,item.timezone) };
}
async function mutate(db,id,action,body,user) {
  const item = await repo.getItem(db,id,user,true);
  const ctx = await repo.context(db,user);
  const manageable = permissions.canManageItem(user,item,ctx.grants);
  const mine = permissions.isMine(item,user,ctx);
  if (action !== 'resume-preview') {
    if (typeof body.requestId !== 'string' || !/^[\w-]{8,80}$/.test(body.requestId)) throw repo.fail(400,'A request ID is required');
    const previous = (await db.query('SELECT kind,actor_id FROM work_queue_events WHERE item_id=$1 AND request_id=$2',[item.id,body.requestId])).rows[0];
    if (previous) {
      if (previous.kind !== action || Number(previous.actor_id) !== Number(user.id)) throw repo.fail(409,'Request ID has already been used');
      return {item:repo.serialize(item,user,ctx)};
    }
  }
  if (!manageable && !(mine && ['notes','snooze'].includes(action))) throw repo.fail(403,'You do not have permission to change this work item');
  if (!['active','paused'].includes(item.state)) throw repo.fail(409,'This stage has closed. Reload the work queue.');
  if (!Number.isInteger(body.version) || body.version !== item.version) throw repo.fail(409,'This work item changed. Reload it before saving.');
  let note = '';
  let changes = {};
  if (action === 'assignment') {
    if (item.owner_mode === 'source') throw repo.fail(409,'Manage this owner in the source approval workflow');
    let owner = null;
    if (body.ownerId !== null && body.ownerId !== '') {
      const uid = repo.positiveId(body.ownerId);
      owner = (await db.query('SELECT id,username,role,page_access FROM users WHERE id=$1',[uid])).rows[0];
      if (!permissions.eligibleOwner(owner,item,ctx.approverUserIds)) throw repo.fail(400,'Choose a user who can access this source');
    }
    changes = {owner_id:owner?.id || null,owner_mode:'manual'};
    note = owner ? `Assigned to ${owner.username}` : 'Assignment removed';
  } else if (action === 'deadline') {
    if (item.deadline_basis === 'eta') throw repo.fail(409,'Change the promised ETA in the source record');
    if (!cal.strictDate(body.dueDate)) throw repo.fail(400,'Enter a valid deadline date');
    if (item.setup_reason || !item.entered_date) throw repo.fail(409,'Resolve the missing source date or stage rule before overriding a deadline');
    note = text(body.reason,'Reason');
    changes = {due_date:body.dueDate,due_at:cal.localCutoffInstant(body.dueDate,String(item.cutoff).slice(0,5),item.timezone)};
  } else if (action === 'pause') {
    if (item.state === 'paused') throw repo.fail(409,'This work item is already paused');
    note = text(body.reason,'Reason');
    await db.query("INSERT INTO work_queue_pauses(item_id,start_at,origin) VALUES($1,clock_timestamp(),'manual')",[item.id]);
    changes = {state:'paused',pause_origin:'manual'};
  } else if (action === 'resume-preview' || action === 'resume') {
    if (item.state !== 'paused') throw repo.fail(409,'This item is not paused');
    if (item.source_held) throw repo.fail(409,'Release the hold in the source workflow first');
    if (action === 'resume-preview') {
      const preview = await resumePreview(db,item);
      const token = randomUUID();
      await db.query("INSERT INTO work_queue_previews(token,item_id,version,payload,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",[token,item.id,item.version,JSON.stringify({...preview,actorId:user.id})]);
      return {...preview,token};
    }
    note = text(body.reason,'Reason');
    if (typeof body.token !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.token)) throw repo.fail(400,'Preview the resumed deadline first');
    const preview = (await db.query('DELETE FROM work_queue_previews WHERE token=$1 AND item_id=$2 AND version=$3 AND expires_at>now() RETURNING payload',[body.token,item.id,item.version])).rows[0]?.payload;
    if (!preview || preview.actorId !== user.id || preview.localDay !== cal.localDate(new Date(),item.timezone)) throw repo.fail(409,'The resume preview expired. Preview the deadline again.');
    await db.query('UPDATE work_queue_pauses SET end_at=now(),credited_dates=$2::date[] WHERE item_id=$1 AND end_at IS NULL',[item.id,preview.creditedDates]);
    changes = {state:'active',pause_origin:null,due_date:preview.dueDate,due_at:preview.dueDate ? cal.localCutoffInstant(preview.dueDate,String(item.cutoff).slice(0,5),item.timezone) : null};
    note += ` (${preview.creditedDays} credited days)`;
  } else if (action === 'notes') {
    note = text(body.note,'Note');
  } else if (action === 'snooze') {
    if (!mine) throw repo.fail(403,'You can only snooze your own reminders');
    const until = new Date(body.untilAt);
    if (!Number.isFinite(until.getTime()) || until <= new Date() || until.getTime() > Date.now()+30*86400000) throw repo.fail(400,'Snooze must end within the next 30 days');
    await db.query('INSERT INTO work_queue_snoozes(item_id,user_id,until_at) VALUES($1,$2,$3) ON CONFLICT(item_id,user_id) DO UPDATE SET until_at=excluded.until_at',[item.id,user.id,until]);
    note = `Personal reminders snoozed until ${until.toISOString()}`;
  } else throw repo.fail(404,'Unknown work queue action');
  const params = [item.id];
  const sets = Object.entries(changes).map(([key,value])=>{params.push(value);return `${key}=$${params.length}`;});
  const updated = (await db.query(`UPDATE work_queue_items SET ${sets.length ? `${sets.join(',')},` : ''}
    first_breached_at=COALESCE(first_breached_at,CASE WHEN state='active' AND due_at<now() THEN due_at END), version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,params)).rows[0];
  await db.query('INSERT INTO work_queue_events(item_id,kind,note,actor_id,actor_name,before_data,after_data,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[item.id,action,note,user.id,user.username,JSON.stringify(item),JSON.stringify(updated),body.requestId]);
  return {item:repo.serialize({...updated,owner_name:updated.owner_id===item.owner_id ? item.owner_name : null},user,ctx)};
}
module.exports = { mutate,resumePreview,snapshot,text };
