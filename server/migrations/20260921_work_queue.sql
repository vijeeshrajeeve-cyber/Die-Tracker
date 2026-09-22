-- Work Queue v1. Kept self-contained and idempotent for startup installation.
-- Typed source FKs plus explicit deletion tombstones preserve audit history;
-- this is a smaller implementation of the source-registry design in the plan.
CREATE TABLE IF NOT EXISTS work_queue_calendars (
  id SERIAL PRIMARY KEY, plant TEXT, timezone TEXT NOT NULL DEFAULT 'Asia/Dubai',
  weekdays INTEGER[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6], holidays DATE[] NOT NULL DEFAULT '{}',
  cutoff TIME NOT NULL DEFAULT '17:00', version INTEGER NOT NULL DEFAULT 1,
  CHECK (cardinality(weekdays) > 0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6])
);
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_calendar_scope ON work_queue_calendars ((COALESCE(plant,'')));
CREATE TABLE IF NOT EXISTS work_queue_rules (
  id SERIAL PRIMARY KEY, plant TEXT, stage_key TEXT NOT NULL, days INTEGER CHECK(days BETWEEN 1 AND 3650),
  day_mode TEXT NOT NULL DEFAULT 'working' CHECK(day_mode IN ('working','calendar')),
  default_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  escalation_owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1, enabled BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_rule_scope ON work_queue_rules ((COALESCE(plant,'')),stage_key);
CREATE TABLE IF NOT EXISTS work_queue_grants (
  id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, plant TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_grant_scope ON work_queue_grants(user_id,(COALESCE(plant,'')));
CREATE TABLE IF NOT EXISTS work_queue_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1), notifications_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  notifications_go_live_at TIMESTAMPTZ
);
INSERT INTO work_queue_config(id) VALUES(1) ON CONFLICT DO NOTHING;
INSERT INTO work_queue_calendars(plant) SELECT NULL WHERE NOT EXISTS(SELECT 1 FROM work_queue_calendars WHERE plant IS NULL);
INSERT INTO work_queue_rules(stage_key,days)
SELECT stage,days FROM (VALUES
 ('pending_order',1),('awaiting_design',3),('simulation',2),('design_approval',1),
 ('pending_pr',1),('oracle_entry',1),('design_to_ems',1),('manufacturing',NULL::integer),
 ('sample_submission',7),('sample_approval',3),('qd_approval',2),('qd_returned',2),
 ('foc_receipt',NULL::integer),('foc_trial',3)
) AS defaults(stage,days)
WHERE NOT EXISTS(SELECT 1 FROM work_queue_rules r WHERE r.plant IS NULL AND r.stage_key=defaults.stage);

CREATE TABLE IF NOT EXISTS work_queue_items (
 id BIGSERIAL PRIMARY KEY, source_kind TEXT NOT NULL CHECK(source_kind IN ('order','sample','qd')),
 source_id INTEGER NOT NULL, order_id INTEGER REFERENCES die_orders(id) ON DELETE RESTRICT,
 sample_id INTEGER REFERENCES sample_followups(id) ON DELETE RESTRICT,
 qd_id INTEGER REFERENCES quality_discrepancies(id) ON DELETE RESTRICT, source_deleted_at TIMESTAMPTZ,
 stage_key TEXT NOT NULL, stage_label TEXT NOT NULL, die_no TEXT, plant TEXT, supplier TEXT,
 owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 owner_mode TEXT NOT NULL DEFAULT 'rule' CHECK(owner_mode IN ('rule','manual','source')),
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','completed','cancelled','superseded')),
 entered_date DATE, baseline_due_at TIMESTAMPTZ, due_at TIMESTAMPTZ, due_date DATE,
 timezone TEXT NOT NULL DEFAULT 'Asia/Dubai', cutoff TIME NOT NULL DEFAULT '17:00',
 deadline_basis TEXT NOT NULL DEFAULT 'working_days' CHECK(deadline_basis IN ('working_days','calendar_days','eta')),
 policy_snapshot JSONB NOT NULL DEFAULT '{}', calendar_snapshot JSONB NOT NULL DEFAULT '{}',
 first_breached_at TIMESTAMPTZ, setup_reason TEXT, source_held BOOLEAN NOT NULL DEFAULT FALSE,
 pause_origin TEXT CHECK(pause_origin IN ('source','manual')), version INTEGER NOT NULL DEFAULT 1,
 occurrence INTEGER NOT NULL DEFAULT 1, source_signature TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 closed_at TIMESTAMPTZ,
 CHECK ((source_deleted_at IS NOT NULL AND num_nonnulls(order_id,sample_id,qd_id)=0)
   OR (source_deleted_at IS NULL AND num_nonnulls(order_id,sample_id,qd_id)=1 AND
     ((source_kind='order' AND order_id=source_id) OR (source_kind='sample' AND sample_id=source_id)
       OR (source_kind='qd' AND qd_id=source_id))))
);
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_one_active_source ON work_queue_items(source_kind,source_id) WHERE state IN ('active','paused');
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_occurrence ON work_queue_items(source_kind,source_id,occurrence);
CREATE INDEX IF NOT EXISTS work_queue_active_due ON work_queue_items(state,due_at,id);
CREATE INDEX IF NOT EXISTS work_queue_owner_due ON work_queue_items(owner_id,state,due_at,id);
CREATE INDEX IF NOT EXISTS work_queue_plant_stage ON work_queue_items(plant,stage_key,state);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='work_queue_source_identity_check' AND conrelid='work_queue_items'::regclass) THEN
   ALTER TABLE work_queue_items ADD CONSTRAINT work_queue_source_identity_check CHECK (
     (source_deleted_at IS NOT NULL AND num_nonnulls(order_id,sample_id,qd_id)=0)
     OR (source_deleted_at IS NULL AND num_nonnulls(order_id,sample_id,qd_id)=1 AND CASE source_kind
       WHEN 'order' THEN order_id IS NOT NULL AND order_id=source_id
       WHEN 'sample' THEN sample_id IS NOT NULL AND sample_id=source_id
       WHEN 'qd' THEN qd_id IS NOT NULL AND qd_id=source_id ELSE FALSE END));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS work_queue_events (
 id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL, note TEXT, actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL, actor_name TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 before_data JSONB, after_data JSONB, request_id TEXT,
 UNIQUE(item_id,request_id)
);
CREATE INDEX IF NOT EXISTS work_queue_event_timeline ON work_queue_events(item_id,id DESC);
CREATE TABLE IF NOT EXISTS work_queue_pauses (
 id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE CASCADE,
 start_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, end_at TIMESTAMPTZ,
 credited_dates DATE[] NOT NULL DEFAULT '{}', origin TEXT NOT NULL DEFAULT 'manual',
 CHECK(origin IN ('manual','source')), CHECK(end_at IS NULL OR end_at>=start_at)
);
CREATE TABLE IF NOT EXISTS work_queue_source_epochs (
 source_kind TEXT NOT NULL, source_id INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(source_kind,source_id)
);

CREATE OR REPLACE FUNCTION work_queue_strict_date(raw TEXT) RETURNS DATE
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE parts TEXT[]; candidate DATE;
BEGIN
 IF raw IS NULL OR btrim(raw)='' THEN RETURN NULL; END IF;
 parts:=regexp_match(btrim(raw),'^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$');
 IF parts IS NOT NULL THEN RETURN make_date(parts[1]::int,parts[2]::int,parts[3]::int); END IF;
 parts:=regexp_match(btrim(raw),'^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$');
 IF parts IS NOT NULL THEN RETURN make_date(parts[3]::int,parts[2]::int,parts[1]::int); END IF;
 RETURN NULL;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_text_representation THEN RETURN NULL;
END $$;

-- Explicitly reject missing/repeated local cutoff instants at DST changes.
-- PostgreSQL's implicit AT TIME ZONE resolution alone would silently guess.
CREATE OR REPLACE FUNCTION work_queue_local_cutoff(day DATE, cutoff TIME, zone TEXT) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE AS $$
DECLARE result TIMESTAMPTZ; matches INTEGER; wall TIMESTAMP:=day+cutoff;
BEGIN
 IF wall IS NULL OR zone IS NULL THEN RETURN NULL; END IF;
 WITH offsets AS (
   SELECT DISTINCT (probe AT TIME ZONE zone)-(probe AT TIME ZONE 'UTC') AS delta
     FROM generate_series((wall AT TIME ZONE 'UTC')-interval '48 hours',
       (wall AT TIME ZONE 'UTC')+interval '48 hours',interval '1 hour') probe
 ), candidates AS (
   SELECT (wall AT TIME ZONE 'UTC')-delta AS instant FROM offsets
 ) SELECT count(*),min(instant) INTO matches,result FROM candidates WHERE instant AT TIME ZONE zone=wall;
 RETURN CASE WHEN matches=1 THEN result END;
EXCEPTION WHEN invalid_parameter_value THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION work_queue_due(entered DATE, target INTEGER, mode TEXT, cal JSONB) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql STABLE AS $$
DECLARE day DATE:=entered; counted INTEGER:=0; iterations INTEGER:=0; eligible BOOLEAN;
BEGIN
 IF entered IS NULL OR target IS NULL OR target<1 OR target>3650 THEN RETURN NULL; END IF;
 IF mode NOT IN ('working','calendar') THEN RETURN NULL; END IF;
 WHILE counted<target LOOP
   day:=day+1; iterations:=iterations+1;
   IF iterations>30000 THEN RETURN NULL; END IF;
   eligible:=mode='calendar' OR (
     EXISTS(SELECT 1 FROM jsonb_array_elements_text(cal->'weekdays') x WHERE x::int=extract(dow FROM day)::int)
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(cal->'holidays') h WHERE h::date=day));
   IF eligible THEN counted:=counted+1; END IF;
 END LOOP;
 RETURN work_queue_local_cutoff(day,COALESCE((cal->>'cutoff')::time,'17:00'::time),COALESCE(cal->>'timezone','Asia/Dubai'));
END $$;

CREATE OR REPLACE FUNCTION work_queue_owner_allowed(uid INTEGER, stage TEXT, kind TEXT DEFAULT NULL) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE AS $$
DECLARE u RECORD; page TEXT; access JSONB; approvers JSONB;
BEGIN
 IF uid IS NULL THEN RETURN FALSE; END IF;
 SELECT role,page_access INTO u FROM users WHERE id=uid;
 IF NOT FOUND THEN RETURN FALSE; END IF;
 IF u.role='admin' THEN RETURN TRUE; END IF;
 IF stage='qd_approval' THEN
   BEGIN SELECT approver_user_ids::jsonb INTO approvers FROM qd_settings ORDER BY id LIMIT 1;
   EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE; END;
   IF NOT COALESCE(approvers @> to_jsonb(ARRAY[uid]),FALSE) THEN RETURN FALSE; END IF;
 END IF;
 IF u.page_access IS NULL THEN RETURN TRUE; END IF;
 BEGIN access:=u.page_access::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE; END;
 IF kind='order' THEN
   RETURN COALESCE(access ?| ARRAY['dashboard','orders','analytics','process-flow','flow-pending-order','flow-awaiting-design',
     'flow-simulation','flow-design-approval','flow-pending-pr','flow-oracle-entry','flow-design-ems','flow-completed','flow-sample-followup'],FALSE);
 END IF;
 page:=CASE stage
 WHEN 'pending_order' THEN 'flow-pending-order' WHEN 'awaiting_design' THEN 'flow-awaiting-design'
 WHEN 'simulation' THEN 'flow-simulation' WHEN 'design_approval' THEN 'flow-design-approval'
 WHEN 'pending_pr' THEN 'flow-pending-pr' WHEN 'oracle_entry' THEN 'flow-oracle-entry'
 WHEN 'design_to_ems' THEN 'flow-design-ems' WHEN 'manufacturing' THEN 'flow-completed'
 WHEN 'sample_submission' THEN 'flow-sample-followup' WHEN 'sample_approval' THEN 'flow-sample-followup'
 WHEN 'qd_approval' THEN 'qd-tracker' WHEN 'qd_returned' THEN 'qd-tracker'
 WHEN 'foc_receipt' THEN 'qd-tracker' WHEN 'foc_trial' THEN 'qd-tracker' ELSE 'orders' END;
 RETURN COALESCE(access ? page OR (page LIKE 'flow-%' AND access ? 'process-flow'),FALSE);
END $$;

CREATE OR REPLACE FUNCTION work_queue_project(kind TEXT, sid INTEGER) RETURNS JSONB
LANGUAGE plpgsql STABLE AS $$
DECLARE s JSONB; rev JSONB; foc JSONB; st TEXT; label TEXT; anchor TEXT; eta TEXT; sig TEXT;
 held BOOLEAN:=FALSE; reason TEXT; owner INTEGER; omode TEXT:='rule'; epoch INTEGER:=0; status TEXT;
BEGIN
 IF kind='order' THEN SELECT to_jsonb(d) INTO s FROM die_orders d WHERE id=sid;
 ELSIF kind='sample' THEN SELECT to_jsonb(d) INTO s FROM sample_followups d WHERE id=sid;
 ELSIF kind='qd' THEN SELECT to_jsonb(d) INTO s FROM quality_discrepancies d WHERE id=sid;
 ELSE RAISE EXCEPTION 'Unknown work queue source kind: %',kind; END IF;
 IF s IS NULL THEN RETURN NULL; END IF;
 SELECT e.epoch INTO epoch FROM work_queue_source_epochs e WHERE e.source_kind=kind AND e.source_id=sid;
 epoch:=COALESCE(epoch,0);
 status:=COALESCE(s->>'status','');
 IF kind='order' AND upper(status)='CANCELLED' THEN RETURN jsonb_build_object('terminal','cancelled'); END IF;
 IF kind IN ('order','sample') THEN
   IF (kind='sample' OR NULLIF(s->>'die_received_date','') IS NOT NULL OR upper(status)='DIE RECEIVED') THEN
     status:=COALESCE(NULLIF(CASE WHEN kind='order' THEN s->>'sample_status' ELSE s->>'status' END,''),'Pending');
     IF status='Approved' THEN RETURN jsonb_build_object('terminal','completed'); END IF;
     held:=status='On hold' OR (kind='order' AND s->>'status'='HOLD');
     IF status IN ('Pending','On hold') THEN st:='sample_submission'; label:='Sample Submission'; anchor:=s->>'die_received_date';
     ELSIF status IN ('Sample Submitted','Rejected') THEN st:='sample_approval'; label:=CASE WHEN status='Rejected' THEN 'Sample Rework / Retrial' ELSE 'Sample Approval' END; anchor:=s->>'submission_date';
     ELSE st:='needs_setup'; label:='Unknown Sample Status'; reason:='Unknown sample status: '||status; END IF;
     sig:=st||':'||epoch;
   ELSIF kind='order' THEN
     SELECT to_jsonb(r) INTO rev FROM order_revisions r WHERE order_id=sid ORDER BY revision_number DESC,id DESC LIMIT 1;
     held:=status='HOLD';
     CASE status
       WHEN 'PENDING FOR ORDERING' THEN st:='pending_order'; label:='Pending Order'; anchor:=s->>'die_requested_date';
       WHEN 'AWAITING FOR DESIGN' THEN st:='awaiting_design'; label:='Awaiting Design'; anchor:=COALESCE(rev->>'revision_date',s->>'ordered_date');
       WHEN 'UNDER SIMULATION' THEN st:='simulation'; label:='Simulation'; anchor:=COALESCE(rev->>'revision_date',s->>'design_received_date');
       WHEN 'PENDING FOR DESIGN APPROVAL' THEN st:='design_approval'; label:='Design Approval'; anchor:=COALESCE(NULLIF(rev->>'design_received_date',''),s->>'design_received_date');
       WHEN 'PENDING FOR PR' THEN st:='pending_pr'; label:='Pending PR'; anchor:=s->>'design_approved_date';
       WHEN 'PENDING FOR ORACLE ENTRY' THEN st:='oracle_entry'; label:='Oracle Entry'; anchor:=s->>'pr_entry';
       WHEN 'PENDING FOR DESIGN TO EMS' THEN st:='design_to_ems'; label:='Design to EMS'; anchor:=s->>'oracle_entry';
       WHEN 'DONE' THEN st:='manufacturing'; label:='In Manufacturing'; anchor:=s->>'design_to_ems_date'; eta:=s->>'eta';
       ELSE st:='needs_setup'; label:=CASE WHEN held THEN 'On Hold' ELSE 'Unknown Order Status' END;
         reason:=CASE WHEN held THEN 'Held source has no known prior queue stage' ELSE 'Unknown order status: '||status END;
     END CASE;
     sig:=st||':revision:'||COALESCE(s->>'design_revision_count','0')||':'||epoch;
   END IF;
 ELSE
   IF status NOT IN ('Open','Sent to Supplier','FOC Accepted','FOC Received','Rejected','Reference','Rework In-house','Closed') THEN
     RETURN jsonb_build_object('stage_key','needs_setup','stage_label','Unknown QD Status','signature','qd:unknown:'||status,
       'source_held',FALSE,'setup_reason','Unknown QD status: '||status,'owner_mode','rule',
       'plant',s->>'plant','supplier',s->>'supplier','die_no',s->>'die_no');
   END IF;
   IF status IN ('Closed','Rejected','Reference') THEN RETURN jsonb_build_object('terminal','completed'); END IF;
   IF s->>'approval_state'='Draft' THEN RETURN jsonb_build_object('terminal','cancelled'); END IF;
   IF s->>'approval_state'='Pending' THEN
     st:='qd_approval'; label:='QD Approval'; anchor:=s->>'submitted_at'; owner:=(s->>'assigned_approver')::int; omode:='source'; sig:=st||':'||COALESCE(s->>'submitted_at','legacy');
   ELSIF s->>'approval_state'='SentBack' THEN
     st:='qd_returned'; label:='QD Returned'; anchor:=s->>'sent_back_at'; owner:=(s->>'created_by')::int; omode:='source'; sig:=st||':'||COALESCE(s->>'sent_back_at','legacy');
   ELSIF s->>'approval_state'='Approved' THEN
     SELECT to_jsonb(r) INTO foc FROM qd_foc_rounds r WHERE qd_id=sid ORDER BY round_no DESC,id DESC LIMIT 1;
     IF foc IS NOT NULL AND foc->>'trial_result' IS NULL THEN
       IF foc->>'received_date' IS NULL THEN st:='foc_receipt'; label:='FOC Receipt'; anchor:=foc->>'accepted_at'; eta:=foc->>'promised_eta';
       ELSE st:='foc_trial'; label:='FOC Trial Follow-up'; anchor:=foc->>'received_date'; END IF;
       sig:=st||':round:'||(foc->>'id');
     ELSIF status IN ('FOC Accepted','FOC Received') AND foc IS NULL THEN st:='foc_receipt'; label:='FOC Receipt'; reason:='FOC status has no source round'; sig:='foc:missing';
     ELSE RETURN jsonb_build_object('terminal','completed'); END IF;
   ELSE st:='needs_setup'; label:='Unknown QD Approval State'; reason:='Unknown approval state: '||COALESCE(s->>'approval_state',''); sig:='qd:unknown'; END IF;
 END IF;
 IF st IN ('manufacturing','foc_receipt') THEN
   IF work_queue_strict_date(eta) IS NULL THEN reason:=COALESCE(reason,'Missing or invalid promised ETA'); END IF;
 ELSIF work_queue_strict_date(anchor) IS NULL THEN reason:=COALESCE(reason,'Missing or invalid stage entry date'); END IF;
 IF NULLIF(btrim(s->>'plant'),'') IS NULL THEN reason:=COALESCE(reason,'Missing source plant'); END IF;
 RETURN jsonb_build_object('stage_key',st,'stage_label',label,'entered_date',work_queue_strict_date(anchor),
   'eta',work_queue_strict_date(eta),'signature',sig,'source_held',held,'setup_reason',reason,
   'owner_id',owner,'owner_mode',omode,'plant',s->>'plant','supplier',s->>'supplier',
   'die_no',COALESCE(s->>'die_no',s->>'profile'));
END $$;

CREATE OR REPLACE FUNCTION work_queue_sync(kind TEXT,sid INTEGER) RETURNS BIGINT
LANGUAGE plpgsql AS $$
DECLARE p JSONB; old work_queue_items%ROWTYPE; item work_queue_items%ROWTYPE;
 cal JSONB; policy JSONB; due TIMESTAMPTZ; reason TEXT; owner INTEGER; mode TEXT; basis TEXT;
 nextstate TEXT; occurrence_no INTEGER; previous JSONB; eventkind TEXT; silent BOOLEAN;
 pause_row RECORD; credit DATE[]; credit_count INTEGER; closed_state TEXT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('work_queue:'||kind||':'||sid,0));
 p:=work_queue_project(kind,sid);
 SELECT * INTO old FROM work_queue_items WHERE source_kind=kind AND source_id=sid AND state IN ('active','paused') FOR UPDATE;
 IF p IS NULL OR p ? 'terminal' THEN
   IF old.id IS NOT NULL THEN
     UPDATE work_queue_items SET state=COALESCE(p->>'terminal','cancelled'),closed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
       first_breached_at=COALESCE(first_breached_at,CASE WHEN old.state='active' AND old.due_at<clock_timestamp() THEN old.due_at END)
       WHERE id=old.id RETURNING * INTO item;
     INSERT INTO work_queue_events(item_id,kind,note,before_data,after_data) VALUES(item.id,item.state,'Source workflow closed this item',to_jsonb(old),to_jsonb(item));
     UPDATE work_queue_pauses SET end_at=clock_timestamp() WHERE item_id=old.id AND end_at IS NULL;
   END IF;
   RETURN old.id;
 END IF;
 -- A source HOLD never erases the stage or resets its clock.
 IF (p->>'source_held')::boolean AND old.id IS NOT NULL THEN
   IF NOT old.source_held OR old.state<>'paused' THEN
     UPDATE work_queue_items SET state='paused',source_held=TRUE,pause_origin=COALESCE(pause_origin,'source'),updated_at=clock_timestamp(),version=version+1,
       first_breached_at=COALESCE(first_breached_at,CASE WHEN state='active' AND due_at<clock_timestamp() THEN due_at END)
       WHERE id=old.id RETURNING * INTO item;
     INSERT INTO work_queue_events(item_id,kind,note,before_data,after_data) VALUES(item.id,'source_held','Source placed on hold; deadline preserved',to_jsonb(old),to_jsonb(item));
     INSERT INTO work_queue_pauses(item_id,origin) VALUES(item.id,'source');
   END IF;
   RETURN old.id;
 END IF;
 IF old.id IS NOT NULL AND old.source_signature<>(p->>'signature') THEN
   closed_state:=CASE WHEN old.stage_key=p->>'stage_key' THEN 'superseded' ELSE 'completed' END;
   UPDATE work_queue_items SET state=closed_state,closed_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
     first_breached_at=COALESCE(first_breached_at,CASE WHEN old.state='active' AND old.due_at<clock_timestamp() THEN old.due_at END)
     WHERE id=old.id RETURNING * INTO item;
   INSERT INTO work_queue_events(item_id,kind,note,before_data,after_data) VALUES(item.id,closed_state,'Source moved to a new stage or occurrence',to_jsonb(old),to_jsonb(item));
   UPDATE work_queue_pauses SET end_at=clock_timestamp() WHERE item_id=old.id AND end_at IS NULL;
   old:=NULL;
 END IF;
 SELECT to_jsonb(c)||jsonb_build_object('cutoff',to_char(c.cutoff,'HH24:MI')) INTO cal FROM work_queue_calendars c WHERE c.plant=p->>'plant' OR c.plant IS NULL ORDER BY (c.plant IS NOT NULL) DESC LIMIT 1;
 SELECT to_jsonb(r) INTO policy FROM work_queue_rules r WHERE r.stage_key=p->>'stage_key' AND (r.plant=p->>'plant' OR r.plant IS NULL) ORDER BY (r.plant IS NOT NULL) DESC LIMIT 1;
 IF old.id IS NOT NULL THEN cal:=old.calendar_snapshot; policy:=old.policy_snapshot; END IF;
 reason:=p->>'setup_reason';
 IF policy IS NULL OR NOT COALESCE((policy->>'enabled')::boolean,FALSE) THEN reason:=COALESCE(reason,'No enabled stage rule'); END IF;
 basis:=CASE WHEN p->>'stage_key' IN ('manufacturing','foc_receipt') THEN 'eta' WHEN policy->>'day_mode'='calendar' THEN 'calendar_days' ELSE 'working_days' END;
 IF basis='eta' THEN due:=work_queue_local_cutoff(work_queue_strict_date(p->>'eta'),COALESCE((cal->>'cutoff')::time,'17:00'::time),COALESCE(cal->>'timezone','Asia/Dubai'));
 ELSE due:=work_queue_due(work_queue_strict_date(p->>'entered_date'),(policy->>'days')::int,policy->>'day_mode',cal); END IF;
 IF due IS NULL THEN reason:=COALESCE(reason,'Invalid deadline calendar or local cutoff'); END IF;
 IF reason IS NOT NULL THEN due:=NULL; END IF;
 mode:=p->>'owner_mode'; owner:=COALESCE((p->>'owner_id')::int,(policy->>'default_owner_id')::int);
 IF mode='source' THEN owner:=(p->>'owner_id')::int; END IF;
 IF old.id IS NOT NULL AND old.owner_mode='manual' AND mode<>'source' THEN owner:=old.owner_id; mode:='manual'; END IF;
 IF owner IS NOT NULL AND NOT work_queue_owner_allowed(owner,p->>'stage_key',kind) THEN
   IF mode='source' THEN reason:=COALESCE(reason,'Source owner is no longer eligible');
   ELSE owner:=NULL; IF old.id IS NOT NULL THEN mode:='manual'; END IF; END IF;
 END IF;
 nextstate:=CASE WHEN (p->>'source_held')::boolean OR (old.state='paused' AND old.pause_origin='manual') THEN 'paused' ELSE 'active' END;
 IF old.id IS NULL THEN
   SELECT COALESCE(MAX(occurrence),0)+1 INTO occurrence_no FROM work_queue_items WHERE source_kind=kind AND source_id=sid;
   INSERT INTO work_queue_items(source_kind,source_id,order_id,sample_id,qd_id,stage_key,stage_label,die_no,plant,supplier,owner_id,owner_mode,state,
     entered_date,baseline_due_at,due_at,due_date,timezone,cutoff,deadline_basis,policy_snapshot,calendar_snapshot,setup_reason,source_held,pause_origin,occurrence,source_signature)
   VALUES(kind,sid,CASE WHEN kind='order' THEN sid END,CASE WHEN kind='sample' THEN sid END,CASE WHEN kind='qd' THEN sid END,
     p->>'stage_key',p->>'stage_label',p->>'die_no',p->>'plant',p->>'supplier',owner,mode,nextstate,work_queue_strict_date(p->>'entered_date'),due,due,
     (due AT TIME ZONE COALESCE(cal->>'timezone','Asia/Dubai'))::date,COALESCE(cal->>'timezone','Asia/Dubai'),COALESCE((cal->>'cutoff')::time,'17:00'::time),basis,
     COALESCE(policy,'{}'),COALESCE(cal,'{}'),reason,(p->>'source_held')::boolean,CASE WHEN (p->>'source_held')::boolean THEN 'source' END,occurrence_no,p->>'signature') RETURNING * INTO item;
   eventkind:='created';
   IF item.source_held THEN INSERT INTO work_queue_pauses(item_id,origin) VALUES(item.id,'source'); END IF;
 ELSE
   -- Ordinary corrections never restart an established SLA. ETA changes are
   -- revised promises; baseline stays immutable. Fixing setup establishes due.
   IF basis<>'eta' AND old.due_at IS NOT NULL THEN due:=old.due_at; END IF;
   IF old.source_held AND NOT (p->>'source_held')::boolean THEN
     FOR pause_row IN SELECT * FROM work_queue_pauses WHERE item_id=old.id AND origin='source' AND end_at IS NULL FOR UPDATE LOOP
       SELECT COALESCE(array_agg(day::date),'{}'::date[]) INTO credit FROM generate_series(
         (pause_row.start_at AT TIME ZONE old.timezone)::date+1,
         (clock_timestamp() AT TIME ZONE old.timezone)::date-1,interval '1 day') day
       WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(cal->'weekdays') w WHERE w::int=extract(dow FROM day)::int)
         AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(cal->'holidays') h WHERE h::date=day::date)
         AND NOT EXISTS(SELECT 1 FROM work_queue_pauses credited WHERE credited.item_id=old.id AND day::date=ANY(credited.credited_dates));
       UPDATE work_queue_pauses SET end_at=clock_timestamp(),credited_dates=credit WHERE id=pause_row.id;
       credit_count:=cardinality(credit);
       IF basis<>'eta' AND credit_count>0 AND due IS NOT NULL THEN
         due:=work_queue_due((due AT TIME ZONE old.timezone)::date,credit_count,policy->>'day_mode',cal);
       END IF;
     END LOOP;
   END IF;
   previous:=to_jsonb(old);
   IF (old.owner_id,old.owner_mode,old.state,old.die_no,old.plant,old.supplier,old.stage_label,old.due_at,old.setup_reason,old.source_held)
      IS NOT DISTINCT FROM (owner,mode,nextstate,p->>'die_no',p->>'plant',p->>'supplier',p->>'stage_label',due,reason,(p->>'source_held')::boolean) THEN RETURN old.id; END IF;
   UPDATE work_queue_items SET owner_id=owner,owner_mode=mode,state=nextstate,die_no=p->>'die_no',plant=p->>'plant',supplier=p->>'supplier',stage_label=p->>'stage_label',
     due_at=due,due_date=(due AT TIME ZONE timezone)::date,baseline_due_at=COALESCE(baseline_due_at,due),setup_reason=reason,
     source_held=(p->>'source_held')::boolean,pause_origin=CASE WHEN nextstate='active' THEN NULL ELSE pause_origin END,
     first_breached_at=COALESCE(first_breached_at,CASE WHEN old.state='active' AND old.due_at<clock_timestamp() THEN old.due_at END),
     entered_date=COALESCE(entered_date,work_queue_strict_date(p->>'entered_date')),updated_at=clock_timestamp(),version=version+1
     WHERE id=old.id RETURNING * INTO item;
   eventkind:=CASE WHEN old.owner_id IS DISTINCT FROM owner THEN 'assigned' WHEN old.due_at IS DISTINCT FROM due THEN 'deadline_revised' ELSE 'source_updated' END;
 END IF;
 silent:=COALESCE(current_setting('work_queue.suppress_notifications',TRUE),'false')='true';
 INSERT INTO work_queue_events(item_id,kind,note,before_data,after_data,actor_name)
 VALUES(item.id,eventkind,CASE WHEN silent THEN 'Reconciliation (notifications suppressed)' ELSE 'Source workflow synchronization' END,
   previous,to_jsonb(item)||jsonb_build_object('suppress_notifications',silent),'Source workflow');
 RETURN item.id;
END $$;

CREATE OR REPLACE FUNCTION work_queue_source_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE kind TEXT:=TG_ARGV[0]; sid INTEGER; oldsample TEXT; newsample TEXT;
BEGIN
 sid:=CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END;
 IF TG_OP='UPDATE' AND kind IN ('order','sample') THEN
   oldsample:=CASE WHEN kind='order' THEN to_jsonb(OLD)->>'sample_status' ELSE to_jsonb(OLD)->>'status' END;
   newsample:=CASE WHEN kind='order' THEN to_jsonb(NEW)->>'sample_status' ELSE to_jsonb(NEW)->>'status' END;
   IF (oldsample='Rejected' AND newsample='Sample Submitted') OR (oldsample='Approved' AND newsample IN ('Pending','Sample Submitted')) THEN
     INSERT INTO work_queue_source_epochs(source_kind,source_id,epoch) VALUES(kind,sid,1)
     ON CONFLICT(source_kind,source_id) DO UPDATE SET epoch=work_queue_source_epochs.epoch+1;
   END IF;
 END IF;
 PERFORM work_queue_sync(kind,sid);
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION work_queue_child_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='order_revisions' THEN PERFORM work_queue_sync('order',CASE WHEN TG_OP='DELETE' THEN OLD.order_id ELSE NEW.order_id END);
 ELSE PERFORM work_queue_sync('qd',CASE WHEN TG_OP='DELETE' THEN OLD.qd_id ELSE NEW.qd_id END); END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION work_queue_source_deleted() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item work_queue_items%ROWTYPE; prior JSONB;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('work_queue:'||TG_ARGV[0]||':'||OLD.id,0));
 FOR item IN SELECT * FROM work_queue_items WHERE source_kind=TG_ARGV[0] AND source_id=OLD.id FOR UPDATE LOOP
   prior:=to_jsonb(item);
   UPDATE work_queue_items SET source_deleted_at=clock_timestamp(),order_id=NULL,sample_id=NULL,qd_id=NULL,
     state=CASE WHEN state IN ('active','paused') THEN 'cancelled' ELSE state END,
     closed_at=COALESCE(closed_at,clock_timestamp()),updated_at=clock_timestamp(),version=version+1 WHERE id=item.id;
   INSERT INTO work_queue_events(item_id,kind,note,before_data,after_data) VALUES(item.id,'source_deleted','Source record deleted',prior,to_jsonb(OLD));
   UPDATE work_queue_pauses SET end_at=clock_timestamp() WHERE item_id=item.id AND end_at IS NULL;
 END LOOP;
 RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS work_queue_order_sync ON die_orders;
CREATE CONSTRAINT TRIGGER work_queue_order_sync AFTER INSERT OR UPDATE ON die_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_queue_source_changed('order');
DROP TRIGGER IF EXISTS work_queue_sample_sync ON sample_followups;
CREATE CONSTRAINT TRIGGER work_queue_sample_sync AFTER INSERT OR UPDATE ON sample_followups DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_queue_source_changed('sample');
DROP TRIGGER IF EXISTS work_queue_qd_sync ON quality_discrepancies;
CREATE CONSTRAINT TRIGGER work_queue_qd_sync AFTER INSERT OR UPDATE ON quality_discrepancies DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_queue_source_changed('qd');
DROP TRIGGER IF EXISTS work_queue_revision_sync ON order_revisions;
CREATE CONSTRAINT TRIGGER work_queue_revision_sync AFTER INSERT OR UPDATE OR DELETE ON order_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_queue_child_changed();
DROP TRIGGER IF EXISTS work_queue_foc_sync ON qd_foc_rounds;
CREATE CONSTRAINT TRIGGER work_queue_foc_sync AFTER INSERT OR UPDATE OR DELETE ON qd_foc_rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_queue_child_changed();
DROP TRIGGER IF EXISTS work_queue_order_delete ON die_orders;
CREATE TRIGGER work_queue_order_delete BEFORE DELETE ON die_orders FOR EACH ROW EXECUTE FUNCTION work_queue_source_deleted('order');
DROP TRIGGER IF EXISTS work_queue_sample_delete ON sample_followups;
CREATE TRIGGER work_queue_sample_delete BEFORE DELETE ON sample_followups FOR EACH ROW EXECUTE FUNCTION work_queue_source_deleted('sample');
DROP TRIGGER IF EXISTS work_queue_qd_delete ON quality_discrepancies;
CREATE TRIGGER work_queue_qd_delete BEFORE DELETE ON quality_discrepancies FOR EACH ROW EXECUTE FUNCTION work_queue_source_deleted('qd');

-- Access changes take effect in the same transaction as the user/settings edit.
-- Preserve named source approvers; NULL means the legacy shared approval pool.
CREATE OR REPLACE FUNCTION work_queue_access_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item work_queue_items%ROWTYPE;
BEGIN
 FOR item IN SELECT * FROM work_queue_items WHERE state IN ('active','paused')
   AND (owner_id IS NOT NULL AND NOT work_queue_owner_allowed(owner_id,stage_key,source_kind)
     OR setup_reason='Source owner is no longer eligible') ORDER BY id LOOP
   PERFORM work_queue_sync(item.source_kind,item.source_id);
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS work_queue_user_access ON users;
CREATE TRIGGER work_queue_user_access AFTER UPDATE OF page_access,role ON users
 FOR EACH STATEMENT EXECUTE FUNCTION work_queue_access_changed();
DROP TRIGGER IF EXISTS work_queue_approver_access ON qd_settings;
CREATE TRIGGER work_queue_approver_access AFTER UPDATE OF approver_user_ids ON qd_settings
 FOR EACH STATEMENT EXECUTE FUNCTION work_queue_access_changed();
