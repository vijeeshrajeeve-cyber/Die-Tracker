'use strict';
// Design enhancement tables. One source of truth for db.cjs and for test setups
// that need the table before the Work Queue projection is installed.
// source_trial_id is a snapshot pointer, deliberately not a foreign key: the
// verdict keeps its numbers if the trial is edited.
const DESIGN_ENHANCEMENT_SCHEMA_SQL = `
ALTER TABLE die_orders ADD COLUMN IF NOT EXISTS design_enhancement INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS design_enhancements (
  id                        SERIAL PRIMARY KEY,
  die_order_id              INTEGER NOT NULL UNIQUE REFERENCES die_orders(id) ON DELETE CASCADE,
  current_issue             TEXT,
  reference_dies            TEXT,
  baseline_failure_pct      NUMERIC,
  baseline_productivity_kgh NUMERIC,
  baseline_recovery_pct     NUMERIC,
  target_failure_pct        NUMERIC,
  target_productivity_kgh   NUMERIC,
  target_recovery_pct       NUMERIC,
  failure_assessment_required BOOLEAN NOT NULL DEFAULT FALSE,
  trial_productivity_kgh    NUMERIC,
  trial_recovery_pct        NUMERIC,
  trial_verdict             TEXT,
  trial_verdict_remark      TEXT,
  trial_verdict_by          TEXT,
  trial_verdict_date        DATE,
  source_trial_id           INTEGER,
  life_review_due_date      DATE,
  actual_failure_pct        NUMERIC,
  life_review_remark        TEXT,
  life_review_by            TEXT,
  life_review_date          DATE,
  final_verdict             TEXT,
  final_verdict_remark      TEXT,
  final_verdict_by          TEXT,
  final_verdict_date        DATE,
  created_by                TEXT,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);
`;

async function ensureDesignEnhancementSchema(client) {
  await client.query(DESIGN_ENHANCEMENT_SCHEMA_SQL);
}

module.exports = { DESIGN_ENHANCEMENT_SCHEMA_SQL, ensureDesignEnhancementSchema };
