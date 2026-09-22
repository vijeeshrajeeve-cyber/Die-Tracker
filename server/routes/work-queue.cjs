'use strict';
const express = require('express');
const repo = require('../services/workQueueRepository.cjs');
const permissions = require('../services/workQueuePermissions.cjs');
const actions = require('../services/workQueueActions.cjs');
const settingsService = require('../services/workQueueSettings.cjs');
const { reconcileAll } = require('../services/workQueueSync.cjs');
const { presentOrder } = require('../services/orderPresentation.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');
const qdSettings = require('../services/qdSettings.cjs');

// Factory allows the real routes to be exercised against an isolated database.
function createWorkQueueRouter(pool) {
  const router = express.Router();
  router.use((req,res,next)=> permissions.canAccessPage(req.user,'work-queue') ? next() : res.status(403).json({error:'Work queue access is required'}));
  const handle = (fn,{transaction=false,admin=false}={}) => async(req,res)=> {
    if (admin && req.user.role!=='admin') return res.status(403).json({error:'Administrator access required'});
    const db = await pool.connect();
    try {
      if (transaction) await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const result = await fn(db,req);
      if (transaction) await db.query('COMMIT');
      res.json(result);
    } catch(error) {
      if (transaction) await db.query('ROLLBACK');
      const status = error.status || (['23505','40001','40P01'].includes(error.code) ? 409 : 500);
      if (status===500) console.error('Work queue error:',error);
      res.status(status).json({error:status===500 ? 'Work queue request failed' : error.code==='23505' ? 'This configuration already exists. Reload before editing.' : ['40001','40P01'].includes(error.code) ? 'This item changed. Reload before saving.' : error.message});
    } finally { db.release(); }
  };
  router.get('/items',handle((db,req)=>repo.list(db,req.query,req.user),{transaction:true}));
  router.get('/items/:id',handle((db,req)=>repo.detail(db,req.params.id,req.user),{transaction:true}));
  router.get('/items/:id/source',handle(async(db,req)=> {
    const item=await repo.getItem(db,req.params.id,req.user);
    if (item.source_deleted_at) throw repo.fail(404,'The source record has been deleted');
    let record;
    if (item.source_kind==='qd') {
      record=(await qd.listQDs(db,item.source_id))[0];
      if (record) {
        const settings=await qdSettings.getQdSettings(db);
        record.can_approve=qdSettings.isApprover(req.user,settings.approverUserIds) && qd.canActOnApproval(req.user,record);
        record.assigned_approver_name=record.assigned_approver ? (await db.query('SELECT username FROM users WHERE id=$1',[record.assigned_approver])).rows[0]?.username : null;
      }
    } else {
      const table=item.source_kind==='order' ? 'die_orders' : 'sample_followups';
      record=(await db.query(`SELECT * FROM ${table} WHERE id=$1`,[item.source_id])).rows[0];
      if (record && item.source_kind==='order') record=presentOrder(record);
    }
    if (!record) throw repo.fail(404,'Source record not found');
    return {kind:item.source_kind,record,source_action:repo.serialize(item,req.user,await repo.context(db,req.user)).source_action};
  },{transaction:true}));
  router.get('/assignees',handle((db,req)=>repo.assignees(db,req.query.itemId,req.user)));
  router.post('/items/:id/:action',handle((db,req)=>actions.mutate(db,req.params.id,req.params.action,req.body,req.user),{transaction:true}));
  router.get('/settings',handle(db=>settingsService.settings(db),{admin:true,transaction:true}));
  router.post('/settings/backfill',handle((db,req)=> {
    if (typeof req.body.dryRun!=='boolean') throw repo.fail(400,'Choose preview or apply');
    return reconcileAll(db,{dryRun:req.body.dryRun,plant:req.body.plant || null});
  },{admin:true}));
  router.post('/settings/:section',handle((db,req)=>settingsService.save(db,req.params.section,req.body,req.user),{admin:true,transaction:true}));
  router.get('/inbox',handle(async(db,req)=> {
    const kinds=['order','sample','qd'].filter(k=>permissions.canReadSource(req.user,k));
    return {notifications:(await db.query(`SELECT n.* FROM work_queue_inbox n JOIN work_queue_items i ON i.id=n.item_id
      WHERE n.recipient_id=$1 AND i.source_kind=ANY($2::text[]) ORDER BY n.id DESC LIMIT 100`,[req.user.id,kinds])).rows};
  }));
  router.post('/inbox/:id/read',handle(async(db,req)=> {
    await db.query('UPDATE work_queue_inbox SET read_at=now() WHERE id=$1 AND recipient_id=$2',[repo.positiveId(req.params.id),req.user.id]);
    return {ok:true};
  }));
  return router;
}
module.exports={createWorkQueueRouter};
