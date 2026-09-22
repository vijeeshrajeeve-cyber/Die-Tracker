'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const { randomUUID }=require('node:crypto');
const { Pool,types }=require('pg');
const express=require('express');
const { createWorkQueueRouter }=require('./work-queue.cjs');
const { initializeWorkQueue }=require('../services/workQueueSchema.cjs');
const { initializeWorkQueueExtraSchema }=require('../services/workQueueExtraSchema.cjs');
types.setTypeParser(1082,value=>value);

test('work queue HTTP authorization, pagination and audited actions', {skip:!process.env.WORK_QUEUE_API_TEST_DATABASE_URL},async t=>{
  const pool=new Pool({connectionString:process.env.WORK_QUEUE_API_TEST_DATABASE_URL});
  const plant=`WQ-API-${randomUUID()}`;
  const ids=[];
  const users=[];
  const one=async(sql,params=[]) => (await pool.query(sql,params)).rows[0];
  const db=await pool.connect();
  await initializeWorkQueue(db); await initializeWorkQueueExtraSchema(db); db.release();
  await pool.query('INSERT INTO plants(name) VALUES($1)',[plant]);
  for(const [name,role,pages] of [['admin','admin',null],['owner','user',['work-queue','orders']],['reader','user',['work-queue','orders']],['blocked','user',['work-queue']],['noqueue','user',['orders']]]) {
    users.push(await one('INSERT INTO users(username,password_hash,role,page_access) VALUES($1,$2,$3,$4) RETURNING id,username,role,page_access',[`${name}-${randomUUID()}`,'test-only',role,pages&&JSON.stringify(pages)]));
  }
  const [admin,owner,reader,blocked,noqueue]=users;
  const app=express(); app.use(express.json());
  app.use(async(req,res,next)=>{req.user=await one('SELECT id,username,role,page_access FROM users WHERE id=$1',[req.headers['x-test-user']||admin.id]);next();});
  app.use('/queue',createWorkQueueRouter(pool));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/queue`;
  const request=async(path,{user=admin,body}={})=> {
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','x-test-user':String(user.id)},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const order=async(extra={})=>{
    const values={die_no:`API-${randomUUID()}`,plant,status:'PENDING FOR ORDERING',die_requested_date:'2026-09-01',...extra};
    const keys=Object.keys(values);
    const row=await one(`INSERT INTO die_orders(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,Object.values(values));
    ids.push(row.id);
    return one("SELECT * FROM work_queue_items WHERE source_kind='order' AND source_id=$1 AND state IN ('active','paused')",[row.id]);
  };
  let item;
  const change=async(action,values={},user=admin,target=item)=>{
    const result=await request(`/items/${target.id}/${action}`,{user,body:{version:target.version,requestId:randomUUID(),...values}});
    if(result.status===200 && result.data.item && target===item) item=result.data.item;
    return result;
  };
  try {
    item=await order();
    await t.test('page access and source access both gate reads and source lookup',async()=>{
      assert.equal((await request('/items',{user:noqueue})).status,403);
      assert.equal((await request(`/items/${item.id}`,{user:blocked})).status,404);
      assert.equal((await request(`/items/${item.id}/source`,{user:blocked})).status,404);
      assert.equal((await request('/items?scope=team',{user:blocked})).data.total,0);
      assert.equal((await request('/settings',{user:reader})).status,403);
      assert.equal((await request(`/assignees?itemId=${item.id}`,{user:reader})).status,403);
    });
    await t.test('coordination grants do not bypass source access, and assignment retains baseline',async()=>{
      assert.equal((await change('assignment',{ownerId:owner.id},reader)).status,403);
      await pool.query('INSERT INTO work_queue_grants(user_id,plant) VALUES($1,$2),($3,$2)',[reader.id,plant,blocked.id]);
      assert.equal((await change('assignment',{ownerId:owner.id},blocked)).status,404);
      assert.equal((await change('assignment',{ownerId:blocked.id},reader)).status,400);
      const baseline=item.baseline_due_at;
      assert.equal((await change('assignment',{ownerId:owner.id},reader)).status,200);
      assert.equal(new Date(item.baseline_due_at).toISOString(),new Date(baseline).toISOString());
      assert.equal((await request(`/items?plant=${plant}&scope=mine`,{user:owner})).data.total,1);
      assert.equal((await request(`/items?plant=${plant}&scope=mine`,{user:reader})).data.total,0);
    });
    await t.test('stale writes fail and a retried request creates only one event',async()=>{
      const version=item.version;
      const requestId=randomUUID();
      const body={version,requestId,note:'Waiting for supplier confirmation'};
      const first=await request(`/items/${item.id}/notes`,{user:owner,body});
      assert.equal(first.status,200); item=first.data.item;
      assert.equal((await request(`/items/${item.id}/notes`,{user:owner,body})).status,200);
      assert.equal(Number((await one('SELECT count(*) FROM work_queue_events WHERE request_id=$1',[requestId])).count),1);
      assert.equal((await change('deadline',{version,dueDate:'2026-10-01',reason:'Changed priority'})).status,409);
      assert.equal(item.state,'active');
      assert.equal((await change('complete',{},owner)).status,403);
    });
    await t.test('deadline changes require reason and preserve first breach and baseline',async()=>{
      assert.equal((await change('deadline',{dueDate:'2026-02-30',reason:'Invalid'})).status,400);
      assert.equal((await change('deadline',{dueDate:'2026-10-01',reason:''})).status,400);
      const baseline=item.baseline_due_at;
      assert.equal((await change('deadline',{dueDate:'2026-10-01',reason:'Approved supplier extension'})).status,200);
      assert.equal(item.baseline_due_at,baseline);
      assert.ok(item.first_breached_at);
      assert.equal(item.due_at,'2026-10-01T13:00:00.000Z');
    });
    await t.test('pause/resume uses an expiring, versioned preview and cannot bypass source HOLD',async()=>{
      assert.equal((await change('pause',{reason:'Tool unavailable'})).status,200);
      assert.equal(item.state,'paused');
      const preview=await change('resume-preview');
      assert.equal(preview.status,200); assert.equal(preview.data.creditedDays,0);
      assert.equal((await change('resume',{token:preview.data.token,reason:'Tool returned'})).status,200);
      assert.equal(item.state,'active');
      await pool.query("UPDATE die_orders SET status='HOLD' WHERE id=$1",[item.source_id]);
      item=(await request(`/items/${item.id}`)).data.item;
      assert.equal((await change('resume-preview')).status,409);
    });
    await t.test('ETA promises are edited only through the source',async()=>{
      const eta=await order({status:'DONE',design_to_ems_date:'2026-09-01',eta:'2026-09-30'});
      assert.equal((await change('deadline',{dueDate:'2026-10-01',reason:'Change'},admin,eta)).status,409);
      const source=await request(`/items/${eta.id}/source`);
      assert.equal(source.status,200); assert.equal(source.data.record['DIE NO'],eta.die_no);
      assert.equal(source.data.source_action.tab,'flow-completed');
    });
    await t.test('rules preview and active recalculation reject changed calendar versions',async()=>{
      await order();
      let result=await request('/settings/calendar',{body:{plant,timezone:'Asia/Dubai',weekdays:[1,2,3,4,5],holidays:[],cutoff:'16:00'}});
      assert.equal(result.status,200); const calendar=result.data.calendar;
      result=await request('/settings/preview',{body:{plant,stage_key:'pending_order',days:1,day_mode:'working',entryDate:'2026-09-18'}});
      assert.equal(result.status,200); assert.equal(result.data.dueDate,'2026-09-21');
      const preview=await request('/settings/recalculate-preview',{body:{plant}});
      assert.equal(preview.status,200); assert.ok(preview.data.changes.length);
      result=await request('/settings/calendar',{body:{...calendar,cutoff:'15:00'}}); assert.equal(result.status,200);
      result=await request('/settings/recalculate',{body:{token:preview.data.token,reason:'New plant calendar'}}); assert.equal(result.status,409);
      const fresh=await request('/settings/recalculate-preview',{body:{plant}});
      result=await request('/settings/recalculate',{body:{token:fresh.data.token,reason:'New plant calendar'}});
      assert.equal(result.status,200); assert.ok(result.data.updated>0);
      assert.equal((await request('/settings/notifications',{body:{enabled:true}})).status,400);
      assert.equal((await request('/settings')).data.notificationsEnabled,false);
    });
    await t.test('recalculation retains pause credit and leaves incomplete sources unresolved',async()=>{
      const target=await order();
      await pool.query("INSERT INTO work_queue_pauses(item_id,start_at,end_at,credited_dates) VALUES($1,'2026-09-02','2026-09-05',ARRAY['2026-09-03'::date,'2026-09-04'::date])",[target.id]);
      const incomplete=await order({die_requested_date:null});
      const preview=await request('/settings/recalculate-preview',{body:{plant}});
      assert.equal(preview.status,200);
      assert.equal(preview.data.changes.find(row=>row.id===target.id).dueDate,'2026-09-04');
      assert.ok(!preview.data.changes.some(row=>row.id===incomplete.id));
      assert.ok((await request(`/items/${incomplete.id}`)).data.item.setup_reason);
    });
    await t.test('owner revocation clears ordinary assignment and request replay survives reassignment',async()=>{
      let target=await order();
      const assigned=await change('assignment',{ownerId:owner.id},admin,target); target=assigned.data.item;
      const body={version:target.version,requestId:randomUUID(),note:'Recorded before reassignment'};
      const noted=await request(`/items/${target.id}/notes`,{user:owner,body}); assert.equal(noted.status,200);
      target=noted.data.item;
      await change('assignment',{ownerId:admin.id},admin,target);
      assert.equal((await request(`/items/${target.id}/notes`,{user:owner,body})).status,200);
      target=(await request(`/items/${target.id}`)).data.item;
      await change('assignment',{ownerId:owner.id},admin,target);
      await pool.query('UPDATE users SET page_access=$2 WHERE id=$1',[owner.id,JSON.stringify(['work-queue'])]);
      target=(await request(`/items/${target.id}`)).data.item;
      assert.equal(target.owner_id,null); assert.equal(target.owner_mode,'manual');
    });
    await t.test('queue counts, pagination and source dispatch work beyond 5000 source records',async()=>{
      const bulkPlant=plant+'-bulk';
      const bulk=await pool.query("INSERT INTO die_orders(die_no,plant,status,die_requested_date) SELECT 'API-BULK-'||n,$1,'PENDING FOR ORDERING','2026-09-01' FROM generate_series(1,5001) n RETURNING id",[bulkPlant]);
      ids.push(...bulk.rows.map(r=>r.id));
      const response=await request(`/items?scope=team&plant=${bulkPlant}&page=101&limit=50`);
      assert.equal(response.status,200); assert.equal(response.data.total,5001); assert.equal(response.data.counts.unassigned,5001);
      assert.equal(response.data.items.length,1); assert.equal(response.data.pages,101);
      const deep=await request(`/items/${response.data.items[0].id}/source`);
      assert.equal(deep.status,200); assert.equal(deep.data.record.id,response.data.items[0].source_id);
    });
  } finally {
    await new Promise(resolve=>server.close(resolve));
    await pool.query('DELETE FROM die_orders WHERE id=ANY($1::int[])',[ids]);
    await pool.query('DELETE FROM work_queue_grants WHERE user_id=ANY($1::int[])',[users.map(u=>u.id)]);
    await pool.query('DELETE FROM work_queue_calendars WHERE plant=$1',[plant]);
    await pool.query('DELETE FROM plants WHERE name=$1',[plant]);
    await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[users.map(u=>u.id)]);
    await pool.end();
  }
});
