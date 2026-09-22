'use strict';
const { randomUUID } = require('node:crypto');
const { STAGES,STAGE_BY_KEY } = require('./workQueueStages.cjs');
const cal = require('./workQueueCalendar.cjs');
const repo = require('./workQueueRepository.cjs');
const permissions = require('./workQueuePermissions.cjs');
const { text } = require('./workQueueActions.cjs');

async function settings(db) {
  const rules = (await db.query('SELECT * FROM work_queue_rules ORDER BY plant NULLS FIRST,stage_key')).rows.map(r=>({...r,stage_label:STAGE_BY_KEY[r.stage_key]?.label || r.stage_key}));
  const calendars = (await db.query('SELECT * FROM work_queue_calendars ORDER BY plant NULLS FIRST')).rows.map(c=>({...c,cutoff:String(c.cutoff).slice(0,5)}));
  const users = (await db.query('SELECT id,username AS "displayName" FROM users ORDER BY username')).rows;
  const plants = (await db.query('SELECT id,name FROM plants ORDER BY name')).rows;
  const grants = (await db.query('SELECT * FROM work_queue_grants ORDER BY user_id,plant')).rows;
  const config = (await db.query('SELECT * FROM work_queue_config WHERE id=1')).rows[0];
  return {rules,calendars,users,plants,grants,stages:STAGES,notificationsEnabled:config.notifications_enabled,notificationsGoLiveAt:config.notifications_go_live_at};
}
async function plantOf(db,value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !(await db.query('SELECT 1 FROM plants WHERE name=$1',[value])).rowCount) throw repo.fail(400,'Choose a configured plant');
  return value;
}
async function selectedCalendar(db,plant) {
  const row = (await db.query('SELECT * FROM work_queue_calendars WHERE plant=$1 OR plant IS NULL ORDER BY plant NULLS LAST LIMIT 1',[plant])).rows[0];
  if (!row) throw repo.fail(409,'Set a working calendar first');
  return cal.validateCalendar({...row,cutoff:String(row.cutoff).slice(0,5)});
}
function validateRule(body) {
  const stage = STAGE_BY_KEY[body.stage_key];
  if (!stage) throw repo.fail(400,'Unknown stage');
  if (stage.days !== null && (!Number.isInteger(body.days) || body.days<1 || body.days>3650)) throw repo.fail(400,'Target must be 1 to 3650 whole days');
  if (!['working','calendar'].includes(body.day_mode)) throw repo.fail(400,'Choose working or calendar days');
  return stage;
}
async function saveVersioned(db,table,body,values) {
  // table/column names are exclusively internal constants; values are bound.
  const keys = Object.keys(values);
  if (body.id) {
    const params = Object.values(values);
    params.push(repo.positiveId(body.id),body.version);
    const result = await db.query(`UPDATE ${table} SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')},version=version+1 WHERE id=$${keys.length+1} AND version=$${keys.length+2} RETURNING *`,params);
    if (!result.rowCount) throw repo.fail(409,'These settings changed. Reload before saving.');
    return result.rows[0];
  }
  return (await db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,Object.values(values))).rows[0];
}
async function save(db,section,body,user) {
  if (section==='calendar') {
    const calendar = cal.validateCalendar(body);
    const plant = await plantOf(db,body.plant);
    return {calendar:await saveVersioned(db,'work_queue_calendars',body,{plant,...calendar})};
  }
  if (section==='rule') {
    const stage = validateRule(body);
    const plant = await plantOf(db,body.plant);
    const source_kind = stage.key.startsWith('qd_') || stage.key.startsWith('foc_') ? 'qd' : stage.key.startsWith('sample_') ? 'sample' : 'order';
    for (const key of ['default_owner_id','escalation_owner_id']) {
      if (body[key] != null && body[key] !== '') {
        const owner = (await db.query('SELECT id,role,page_access FROM users WHERE id=$1',[repo.positiveId(body[key])])).rows[0];
        if (!owner || !permissions.canReadSource(owner,source_kind)) throw repo.fail(400,'The selected owner needs source access');
      }
    }
    if (['qd_approval','qd_returned'].includes(stage.key) && body.default_owner_id) throw repo.fail(400,'QD approval and returned-work owners come from the source');
    return {rule:await saveVersioned(db,'work_queue_rules',body,{plant,stage_key:stage.key,days:stage.days===null ? null : body.days,day_mode:body.day_mode,default_owner_id:body.default_owner_id || null,escalation_owner_id:body.escalation_owner_id || null,enabled:body.enabled!==false})};
  }
  if (section==='grants') {
    const userId = repo.positiveId(body.userId);
    const plant = await plantOf(db,body.plant);
    if (!(await db.query('SELECT 1 FROM users WHERE id=$1',[userId])).rowCount) throw repo.fail(400,'User not found');
    if (body.remove === true) await db.query('DELETE FROM work_queue_grants WHERE user_id=$1 AND plant IS NOT DISTINCT FROM $2',[userId,plant]);
    else await db.query('INSERT INTO work_queue_grants(user_id,plant) VALUES($1,$2) ON CONFLICT DO NOTHING',[userId,plant]);
    return {ok:true};
  }
  if (section==='notifications') {
    if (typeof body.enabled !== 'boolean') throw repo.fail(400,'Enabled must be true or false');
    if (body.enabled && body.reviewed !== true) throw repo.fail(400,'Review calendars, owners, escalation contacts and current work before enabling reminders');
    // Enabling starts a fresh notification horizon; previous backlog stays quiet.
    const result = (await db.query('UPDATE work_queue_config SET notifications_enabled=$1,notifications_go_live_at=CASE WHEN $1 AND NOT notifications_enabled THEN now() ELSE notifications_go_live_at END WHERE id=1 RETURNING *',[body.enabled])).rows[0];
    return {notificationsEnabled:result.notifications_enabled,notificationsGoLiveAt:result.notifications_go_live_at};
  }
  if (section==='preview') {
    const stage = validateRule(body);
    const calendar = await selectedCalendar(db,await plantOf(db,body.plant));
    if (stage.days===null) return {dueDate:null,setupReason:'This stage uses the source ETA',...calendar};
    const date = cal.dueDate(body.entryDate,body.days,body.day_mode,calendar);
    return {dueDate:date,dueAt:cal.localCutoffInstant(date,calendar.cutoff,calendar.timezone),timezone:calendar.timezone,cutoff:calendar.cutoff};
  }
  if (section==='recalculate-preview') {
    const plant = await plantOf(db,body.plant);
    const rows = (await db.query("SELECT * FROM work_queue_items WHERE state='active' AND deadline_basis<>'eta' AND entered_date IS NOT NULL AND ($1::text IS NULL OR plant=$1) ORDER BY id LIMIT 2001",[plant])).rows;
    if (rows.length>2000) throw repo.fail(400,'Choose a plant with at most 2000 active items per recalculation');
    const changes=[];
    for (const item of rows) {
      const projection=(await db.query('SELECT work_queue_project($1,$2) AS value',[item.source_kind,item.source_id])).rows[0]?.value;
      if (!projection || projection.terminal || projection.setup_reason || item.setup_reason === 'Source owner is no longer eligible') continue;
      const rule = (await db.query('SELECT * FROM work_queue_rules WHERE stage_key=$1 AND (plant=$2 OR plant IS NULL) ORDER BY plant NULLS LAST LIMIT 1',[item.stage_key,item.plant])).rows[0];
      if (!rule?.enabled || !rule.days) continue;
      const calendar=await selectedCalendar(db,item.plant);
      const calendarVersion=(await db.query('SELECT id,version FROM work_queue_calendars WHERE plant=$1 OR plant IS NULL ORDER BY plant NULLS LAST LIMIT 1',[item.plant])).rows[0];
      const credits=(await db.query('SELECT DISTINCT unnest(credited_dates) AS day FROM work_queue_pauses WHERE item_id=$1',[item.id])).rows.length;
      const baseDate=cal.dueDate(item.entered_date,rule.days,rule.day_mode,calendar);
      const date=credits ? cal.dueDate(baseDate,credits,rule.day_mode,calendar) : baseDate;
      const dueAt=cal.localCutoffInstant(date,calendar.cutoff,calendar.timezone);
      changes.push({id:item.id,version:item.version,dieNo:item.die_no,stage:item.stage_label,oldDueAt:item.due_at,dueDate:date,dueAt,rule,calendar,calendarVersion});
    }
    const token=randomUUID();
    await db.query("INSERT INTO work_queue_previews(token,item_id,version,payload,expires_at) VALUES($1,NULL,0,$2,now()+interval '10 minutes')",[token,JSON.stringify({actorId:user.id,changes})]);
    return {token,changes};
  }
  if (section==='recalculate') {
    const reason=text(body.reason,'Reason');
    if (typeof body.token!=='string' || !/^[0-9a-f-]{36}$/i.test(body.token)) throw repo.fail(400,'Preview the changes first');
    const payload=(await db.query('DELETE FROM work_queue_previews WHERE token=$1 AND item_id IS NULL AND expires_at>now() RETURNING payload',[body.token])).rows[0]?.payload;
    if (!payload || payload.actorId!==user.id) throw repo.fail(409,'Preview expired. Preview the changes again.');
    for (const change of payload.changes) {
      const item=await repo.getItem(db,change.id,user,true);
      if (item.version!==change.version || item.state!=='active') throw repo.fail(409,'A work item changed after preview. Preview again.');
      const rule=(await db.query('SELECT id,version FROM work_queue_rules WHERE stage_key=$1 AND (plant=$2 OR plant IS NULL) ORDER BY plant NULLS LAST LIMIT 1 FOR SHARE',[item.stage_key,item.plant])).rows[0];
      const calendarVersion=(await db.query('SELECT id,version FROM work_queue_calendars WHERE plant=$1 OR plant IS NULL ORDER BY plant NULLS LAST LIMIT 1 FOR SHARE',[item.plant])).rows[0];
      if (rule?.id!==change.rule.id || rule?.version!==change.rule.version || calendarVersion?.id!==change.calendarVersion.id || calendarVersion?.version!==change.calendarVersion.version) throw repo.fail(409,'Deadline rules changed after preview. Preview again.');
      const updated=(await db.query(`UPDATE work_queue_items SET due_at=$2,due_date=$3,policy_snapshot=$4,calendar_snapshot=$5,timezone=$6,cutoff=$7,
        deadline_basis=$8,setup_reason=NULL,first_breached_at=COALESCE(first_breached_at,CASE WHEN due_at<now() THEN due_at END),version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [item.id,change.dueAt,change.dueDate,JSON.stringify(change.rule),JSON.stringify(change.calendar),change.calendar.timezone,change.calendar.cutoff,change.rule.day_mode==='calendar'?'calendar_days':'working_days'])).rows[0];
      await db.query("INSERT INTO work_queue_events(item_id,kind,note,actor_id,actor_name,before_data,after_data) VALUES($1,'recalculated',$2,$3,$4,$5,$6)",[item.id,reason,user.id,user.username,JSON.stringify(item),JSON.stringify(updated)]);
    }
    return {updated:payload.changes.length};
  }
  throw repo.fail(404,'Unknown settings action');
}
module.exports={settings,save,selectedCalendar};
