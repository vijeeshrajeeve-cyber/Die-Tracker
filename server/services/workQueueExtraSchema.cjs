'use strict';

// Run after initializeWorkQueue on the same connected client. No mail is sent
// by installation, and the main schema keeps notifications disabled by default.
const EXTRA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS work_queue_pauses (
 id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE RESTRICT,
 start_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, end_at TIMESTAMPTZ,
 credited_dates DATE[] NOT NULL DEFAULT '{}', origin TEXT NOT NULL DEFAULT 'manual',
 CHECK(end_at IS NULL OR end_at>=start_at)
);
DROP INDEX IF EXISTS work_queue_one_open_pause;
CREATE UNIQUE INDEX IF NOT EXISTS work_queue_one_open_pause_origin ON work_queue_pauses(item_id,origin) WHERE end_at IS NULL;
CREATE TABLE IF NOT EXISTS work_queue_snoozes (
 item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, until_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(item_id,user_id)
);
CREATE TABLE IF NOT EXISTS work_queue_previews (
 token UUID PRIMARY KEY, item_id BIGINT REFERENCES work_queue_items(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, payload JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS work_queue_preview_expiry ON work_queue_previews(expires_at);
ALTER TABLE work_queue_previews ALTER COLUMN item_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS work_queue_notification_outbox (
 id BIGSERIAL PRIMARY KEY, item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE CASCADE,
 recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
 deadline_version INTEGER NOT NULL DEFAULT 0, event_key TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
 available_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, delivered_at TIMESTAMPTZ,
 cancelled_at TIMESTAMPTZ, attempts INTEGER NOT NULL DEFAULT 0, lease_until TIMESTAMPTZ,
 lease_token UUID, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(item_id,recipient_id,kind,event_key)
);
CREATE INDEX IF NOT EXISTS work_queue_outbox_pending ON work_queue_notification_outbox(available_at,id)
 WHERE delivered_at IS NULL AND cancelled_at IS NULL;
CREATE TABLE IF NOT EXISTS work_queue_inbox (
 id BIGSERIAL PRIMARY KEY, outbox_id BIGINT NOT NULL UNIQUE REFERENCES work_queue_notification_outbox(id) ON DELETE CASCADE,
 recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id BIGINT NOT NULL REFERENCES work_queue_items(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 read_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS work_queue_inbox_recipient ON work_queue_inbox(recipient_id,created_at DESC);

CREATE OR REPLACE FUNCTION work_queue_event_notification() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE item work_queue_items%ROWTYPE; settings work_queue_config%ROWTYPE; notification_kind TEXT;
BEGIN
 SELECT * INTO settings FROM work_queue_config WHERE id=1;
 IF NOT COALESCE(settings.notifications_enabled,FALSE) OR settings.notifications_go_live_at IS NULL
   OR NEW.created_at<settings.notifications_go_live_at
   OR COALESCE((NEW.after_data->>'suppress_notifications')::boolean,FALSE)
   OR COALESCE(current_setting('work_queue.suppress_notifications',TRUE),'false')='true' THEN RETURN NEW; END IF;
 SELECT * INTO item FROM work_queue_items WHERE id=NEW.item_id;
 IF item.owner_id IS NULL OR item.state NOT IN ('active','paused') OR item.source_deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.kind IN ('assigned','assignment','created') THEN
   -- Existing QD submission/send-back notifications remain authoritative.
   IF item.stage_key IN ('qd_approval','qd_returned') THEN RETURN NEW; END IF;
   notification_kind:='assignment';
 ELSIF NEW.kind IN ('note','notes','note_added') THEN notification_kind:='note';
 ELSE RETURN NEW; END IF;
 IF NEW.actor_id=item.owner_id THEN RETURN NEW; END IF;
 INSERT INTO work_queue_notification_outbox(item_id,recipient_id,kind,deadline_version,event_key,payload)
 VALUES(item.id,item.owner_id,notification_kind,item.version,'event:'||NEW.id,
   jsonb_build_object('event_id',NEW.id,'note',NEW.note,'actor_name',NEW.actor_name,'owner_id',item.owner_id))
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS work_queue_event_notify ON work_queue_events;
CREATE TRIGGER work_queue_event_notify AFTER INSERT ON work_queue_events
 FOR EACH ROW EXECUTE FUNCTION work_queue_event_notification();
`;

async function initializeWorkQueueExtraSchema(client) {
  await client.query(EXTRA_SCHEMA_SQL);
}

module.exports = { initializeWorkQueueExtraSchema, EXTRA_SCHEMA_SQL };
