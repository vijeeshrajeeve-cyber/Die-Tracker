-- Die Ordering App Database Initialization
-- This script runs on first container startup

-- Users table with password_must_change for security
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    -- Where the app writes to this person (e.g. their QD was sent back).
    -- Optional: an account with no address simply gets no email.
    email TEXT,
    -- How this person signs an outgoing email. A login name is not something to
    -- sign a supplier email with, so full_name wins where it is set.
    full_name TEXT,
    phone TEXT,
    role TEXT DEFAULT 'user',
    password_must_change BOOLEAN DEFAULT false,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMP,
    page_access TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    region TEXT,
    contact_email TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plants table
CREATE TABLE IF NOT EXISTS plants (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Profile master (profile number → customer name)
CREATE TABLE IF NOT EXISTS profiles (
    id SERIAL PRIMARY KEY,
    profile_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_profiles_profile_number ON profiles(profile_number);

-- Die Orders table
CREATE TABLE IF NOT EXISTS die_orders (
    id SERIAL PRIMARY KEY,
    plant TEXT,
    order_no TEXT,
    die_no TEXT,
    type TEXT,
    die_size TEXT,
    die_requested_date TEXT,
    ordered_date TEXT,
    shipment_type TEXT,
    mandrels_per_cavity INTEGER DEFAULT 0,
    total_mandrels INTEGER DEFAULT 0,
    design_received_date TEXT,
    three_d_model_received_date TEXT,
    simulation_enabled INTEGER DEFAULT 0,
    design_approved_date TEXT,
    delay INTEGER DEFAULT 0,
    pr_entry TEXT,
    pr_number TEXT,
    customer_name TEXT,
    oracle_entry TEXT,
    supplier TEXT,
    status TEXT,
    overall_delay INTEGER DEFAULT 0,
    eta TEXT,
    month TEXT,
    die_received_date TEXT,
    submission_date TEXT,
    sample_approval_date TEXT,
    no_of_trial INTEGER DEFAULT 0,
    corrector TEXT,
    press TEXT,
    ascona_reference TEXT DEFAULT 'No',
    sample_status TEXT DEFAULT 'Pending',
    remark TEXT,
    urgency TEXT DEFAULT 'NORMAL',
    special_follow_up BOOLEAN DEFAULT false,
    change_log TEXT DEFAULT '[]',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Press master (press name → code)
CREATE TABLE IF NOT EXISTS presses (
    id SERIAL PRIMARY KEY,
    press_name TEXT UNIQUE NOT NULL,
    press_code TEXT NOT NULL,
    plant TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO presses (press_name, press_code, plant) VALUES
    ('PRESS 2', 'B', 'GEX 01'),
    ('PRESS 4', 'D', 'GEX 01'),
    ('PRESS 5', 'E', 'GEX 01'),
    ('PRESS 6', 'F', 'GEX 01'),
    ('PRESS 7', 'P25', 'GEX 02'),
    ('PRESS 8', 'P35', 'GEX 02'),
    ('PRESS 9', 'I', 'GEX 02')
ON CONFLICT (press_name) DO UPDATE SET
    press_code = EXCLUDED.press_code,
    plant = EXCLUDED.plant;

-- Corrector master list. Constrains the Corrector dropdown on Die Receiving,
-- Sample Followup and QD. The corrector columns on die_orders,
-- sample_followups and quality_discrepancies stay plain TEXT by design — this
-- table governs what can be entered, not what is stored.
CREATE TABLE IF NOT EXISTS correctors (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    plant TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (name, plant)
);

-- Seed only when the table is empty, so names an admin later removes are not
-- silently resurrected on the next boot.
INSERT INTO correctors (name, plant)
SELECT * FROM (VALUES
    ('Kailash', 'GEX 2'),
    ('Jaypee', 'GEX 2'),
    ('Raheem', 'GEX 2'),
    ('Sujith', 'GEX 2'),
    ('Dinesh', 'GEX 2')
) AS seed(name, plant)
WHERE NOT EXISTS (SELECT 1 FROM correctors);

-- Backup Die Requests table
CREATE TABLE IF NOT EXISTS backup_die_requests (
    id SERIAL PRIMARY KEY,
    plant TEXT,
    die_no TEXT,
    customer TEXT,
    press TEXT,
    cavity INTEGER DEFAULT 0,
    requested_date TEXT,
    die_available TEXT,
    drawing_requested TEXT,
    ordered_date TEXT,
    status TEXT DEFAULT 'Pending',
    reason TEXT,
    order_received_last_year TEXT,
    remarks TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Frozen / Final Designs
CREATE TABLE IF NOT EXISTS frozen_designs (
    id SERIAL PRIMARY KEY,
    profile_number  TEXT NOT NULL,
    plant           TEXT NOT NULL,
    press           TEXT NOT NULL,
    cavity          INTEGER NOT NULL,
    source_order_id INTEGER REFERENCES die_orders(id),
    frozen_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    frozen_by       INTEGER REFERENCES users(id),
    is_active       BOOLEAN DEFAULT true,
    superseded_by   INTEGER REFERENCES frozen_designs(id),
    released_at     TIMESTAMP,
    released_by     INTEGER REFERENCES users(id),
    release_reason  TEXT,
    supplier        TEXT,
    die_size        TEXT,
    notes           TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_frozen
    ON frozen_designs (profile_number, plant, press, cavity)
    WHERE is_active = true;

CREATE TABLE IF NOT EXISTS frozen_design_files (
    id SERIAL PRIMARY KEY,
    frozen_design_id INTEGER NOT NULL REFERENCES frozen_designs(id) ON DELETE CASCADE,
    original_name    TEXT NOT NULL,
    stored_path      TEXT NOT NULL,
    mime_type        TEXT,
    size_bytes       BIGINT,
    uploaded_by      INTEGER REFERENCES users(id),
    uploaded_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_action TEXT;
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_override_reason TEXT;
ALTER TABLE die_orders          ADD COLUMN IF NOT EXISTS frozen_design_override_note TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_id INTEGER REFERENCES frozen_designs(id);
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_action TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_override_reason TEXT;
ALTER TABLE backup_die_requests ADD COLUMN IF NOT EXISTS frozen_design_override_note TEXT;

-- Sample Followup table
CREATE TABLE IF NOT EXISTS sample_followups (
    id SERIAL PRIMARY KEY,
    profile TEXT,
    plant TEXT,
    press TEXT,
    supplier TEXT,
    customer TEXT,
    die_received_date TEXT,
    ascona_reference TEXT DEFAULT 'No',
    submission_date TEXT,
    sample_approval_date TEXT,
    delay_days INTEGER DEFAULT 0,
    status TEXT DEFAULT 'Pending',
    no_of_trial INTEGER DEFAULT 0,
    remark TEXT,
    corrector TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed suppliers
INSERT INTO suppliers (name, region) VALUES
    ('ADEX', 'Europe'),
    ('ALMAX', 'Europe'),
    ('COMES', 'Turkiye'),
    ('COMPES', 'Europe'),
    ('EKSTEK', 'Turkiye'),
    ('JIANGSU', 'China'),
    ('PDTMC', 'UAE'),
    ('PHME', 'UAE'),
    ('PHOENIX', 'Europe'),
    ('WEFA', 'Europe')
ON CONFLICT (name) DO UPDATE SET region = EXCLUDED.region;

-- Seed plants
INSERT INTO plants (name) VALUES 
    ('GEX 01'), ('GEX 02')
ON CONFLICT (name) DO NOTHING;

-- Email configuration (SMTP/IMAP direct integration)
CREATE TABLE IF NOT EXISTS email_config (
    id SERIAL PRIMARY KEY,
    smtp_host TEXT,
    smtp_port INTEGER DEFAULT 587,
    imap_host TEXT,
    imap_port INTEGER DEFAULT 993,
    email_user TEXT,
    email_password TEXT,
    mailbox_email TEXT,
    send_enabled BOOLEAN DEFAULT false,
    receive_enabled BOOLEAN DEFAULT false,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email log (sent and received emails)
CREATE TABLE IF NOT EXISTS email_log (
    id SERIAL PRIMARY KEY,
    direction TEXT NOT NULL,
    message_id TEXT,
    conversation_id TEXT,
    from_address TEXT,
    to_addresses TEXT,
    cc_addresses TEXT,
    subject TEXT,
    body_preview TEXT,
    body_content TEXT,
    order_id INTEGER REFERENCES die_orders(id) ON DELETE SET NULL,
    sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'sent',
    error_message TEXT,
    importance TEXT DEFAULT 'normal',
    received_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Email templates
CREATE TABLE IF NOT EXISTS email_templates (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    category TEXT,
    default_to TEXT,
    default_cc TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO email_templates (name, subject_template, body_template, category) VALUES
    ('Design Reminder', 'URGENT: Design Pending for {{orderCount}} Die Order(s) - {{supplier}}',
     'Dear {{supplier}} Team,

This is a reminder that the following die order(s) have been awaiting design for more than 48 hours:

{{orderList}}

Please provide the design drawings at the earliest to avoid further delays in production.

Best regards,
Die Ordering Team',
     'design_reminder'),
    ('Ordering Reminder', 'URGENT: {{orderCount}} Die Order(s) Pending Ordering - {{plant}}',
     'Dear Purchase Team,

The following die order(s) for {{plant}} have been pending ordering for more than 24 hours:

{{orderList}}

Please process these orders at the earliest to avoid production delays.

Best regards,
Die Ordering Team',
     'ordering_reminder'),
    ('PDF Drawing Request', 'URGENT: PDF Drawing Request for {{requestCount}} Backup Die Request(s)',
     'Dear Design Team,

Please provide PDF drawings for the selected backup die request(s).

Best regards,
Die Ordering Team',
     'pdf_drawing_request')
ON CONFLICT (name) DO NOTHING;

-- Uploaded existing die master data by plant
CREATE TABLE IF NOT EXISTS existing_die_details (
    id SERIAL PRIMARY KEY,
    plant TEXT NOT NULL,
    die_no TEXT,
    profile_number TEXT,
    customer TEXT,
    die_size TEXT,
    press TEXT,
    -- Fields the app reads on every die lookup, promoted out of raw_data so the
    -- queries stop naming a plant's own column spelling. See
    -- server/services/dieListImport.cjs for the per-plant alias lists.
    die_status TEXT,
    cavity INTEGER,
    die_type TEXT,
    supplier TEXT,
    tonnage BIGINT,
    bolster_no TEXT,
    raw_data JSONB NOT NULL DEFAULT '{}',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_existing_die_details_plant ON existing_die_details(plant);
CREATE INDEX IF NOT EXISTS idx_existing_die_details_die_no ON existing_die_details(die_no);
CREATE INDEX IF NOT EXISTS idx_existing_die_details_profile ON existing_die_details(profile_number);

-- Uploaded existing production data by plant
CREATE TABLE IF NOT EXISTS existing_production_data (
    id SERIAL PRIMARY KEY,
    plant TEXT NOT NULL,
    die_no TEXT,
    profile_number TEXT,
    customer TEXT,
    production_date TEXT,
    quantity INTEGER,
    press TEXT,
    raw_data JSONB NOT NULL DEFAULT '{}',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_existing_production_data_plant ON existing_production_data(plant);
CREATE INDEX IF NOT EXISTS idx_existing_production_data_die_no ON existing_production_data(die_no);

-- Quality Discrepancies (QD Tracker)
CREATE TABLE IF NOT EXISTS quality_discrepancies (
    id SERIAL PRIMARY KEY,
    qd_no            TEXT UNIQUE,
    die_no           TEXT NOT NULL,
    profile_number   TEXT,
    die_order_id     INTEGER REFERENCES die_orders(id),
    raised_date      DATE NOT NULL,
    qd_requested_date DATE,
    plant            TEXT NOT NULL,
    supplier         TEXT NOT NULL,
    corrector        TEXT,
    status           TEXT NOT NULL DEFAULT 'Open',
    outcome          TEXT,
    issue_summary    TEXT NOT NULL,
    issue_detail     TEXT,
    eta_date         DATE,
    input_at_failure TEXT,
    sent_to_purchase_date DATE,
    sent_to_supplier_date DATE,
    closed_at        DATE,
    created_by       INTEGER REFERENCES users(id),
    created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approval_state   TEXT NOT NULL DEFAULT 'Draft',
    submitted_by     INTEGER REFERENCES users(id),
    submitted_at     TIMESTAMP,
    approved_by      INTEGER REFERENCES users(id),
    approved_at      TIMESTAMP,
    -- Who this QD was sent to for approval, chosen by the raiser at submit time.
    assigned_approver INTEGER REFERENCES users(id),
    sent_back_reason TEXT,
    sent_back_at     TIMESTAMP,
    prepared_by      TEXT,
    die_received_date TEXT,
    press              TEXT,
    die_type           TEXT,
    die_size           TEXT,
    no_of_cavity       TEXT,
    tooling            TEXT,
    no_of_trials       TEXT,
    no_of_corrections  TEXT,
    production_date    TEXT,
    manufacturing_defect TEXT,
    die_performance      TEXT,
    recommended_action   TEXT,
    supplier_acceptance   TEXT,
    action_taken          TEXT,
    supplier_comments     TEXT,
    received_by_supplier  TEXT
);
CREATE INDEX IF NOT EXISTS idx_qd_supplier ON quality_discrepancies(supplier);
CREATE INDEX IF NOT EXISTS idx_qd_status ON quality_discrepancies(status);

CREATE TABLE IF NOT EXISTS qd_settings (
    id                SERIAL PRIMARY KEY,
    approver_user_ids TEXT DEFAULT '[]',
    purchase_email_to TEXT DEFAULT '',
    purchase_email_cc TEXT DEFAULT '',
    press_options     TEXT DEFAULT '[]',
    die_type_options  TEXT DEFAULT '[]',
    alloy_options     TEXT DEFAULT '[]',
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Supplier performance scoring targets and weights. One row; the metrics
-- column is a JSON array of { key, ten, zero, target, weight }. Empty
-- means "use the code defaults" (see supplierPerformanceSettings.cjs).
-- No backticks in this block: it is mirrored into a JS template literal.
-- One row per year: targets are set annually, and a report already sent to a
-- supplier must keep the score it was given when next year's are set.
CREATE TABLE IF NOT EXISTS supplier_performance_settings (
    id         SERIAL PRIMARY KEY,
    year       INTEGER,
    metrics    TEXT DEFAULT '[]',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sps_year ON supplier_performance_settings (year);

-- Manual monthly die life capture, per supplier. Failure percentage is
-- derived from the counts at read time, never stored. Every value is
-- nullable and NULL means "not recorded" -- never zero. Rationale in db.cjs.
CREATE TABLE IF NOT EXISTS supplier_die_life (
    id                SERIAL PRIMARY KEY,
    supplier          TEXT     NOT NULL,
    year              INTEGER  NOT NULL,
    month             SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
    avg_die_life_mt   NUMERIC,
    dies_in_service   INTEGER,
    dies_failed       INTEGER,
    updated_by        INTEGER REFERENCES users(id),
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (supplier, year, month)
);
CREATE INDEX IF NOT EXISTS idx_supplier_die_life_lookup
    ON supplier_die_life (upper(btrim(supplier)), year, month);

CREATE TABLE IF NOT EXISTS quality_discrepancy_activity (
    id SERIAL PRIMARY KEY,
    qd_id       INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,
    icon        TEXT,
    tone        TEXT,
    occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id     INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_qd_activity_qd ON quality_discrepancy_activity(qd_id);

CREATE TABLE IF NOT EXISTS quality_discrepancy_files (
    id SERIAL PRIMARY KEY,
    qd_id         INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_path   TEXT NOT NULL,
    mime_type     TEXT,
    size_bytes    BIGINT,
    uploaded_by   INTEGER REFERENCES users(id),
    uploaded_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    category      TEXT DEFAULT 'general'
);
CREATE INDEX IF NOT EXISTS idx_qd_files_qd ON quality_discrepancy_files(qd_id);

CREATE TABLE IF NOT EXISTS qd_billet_parameters (
    id                   SERIAL PRIMARY KEY,
    qd_id                INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
    billet               TEXT NOT NULL,
    die_soaking_hours    TEXT,
    die_temperature      TEXT,
    billet_temp          TEXT,
    breakthrough_pressure TEXT,
    running_pressure     TEXT,
    billet_length        TEXT,
    alloy                TEXT,
    ram_speed            TEXT,
    any_delay_observed   TEXT,
    any_delay_details    TEXT,
    UNIQUE (qd_id, billet)
);
CREATE INDEX IF NOT EXISTS idx_qd_billet_qd ON qd_billet_parameters(qd_id);

-- One row per attempt at a free-of-charge replacement: what the supplier
-- promised, when it actually arrived, and how it did on trial. A QD loops when
-- a replacement fails its trial, so this cannot be columns on the QD itself —
-- round 2 would overwrite round 1 and destroy the evidence of a supplier who
-- has sent two bad dies against the same claim.
CREATE TABLE IF NOT EXISTS qd_foc_rounds (
    id            SERIAL PRIMARY KEY,
    qd_id         INTEGER NOT NULL REFERENCES quality_discrepancies(id) ON DELETE CASCADE,
    round_no      INTEGER NOT NULL,
    promised_eta  DATE,
    accepted_at   DATE,
    received_date DATE,
    received_by   INTEGER REFERENCES users(id),
    trial_date    DATE,
    trial_result  TEXT CHECK (trial_result IN ('Pass', 'Fail')),
    trial_notes   TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (qd_id, round_no)
);
CREATE INDEX IF NOT EXISTS idx_qd_foc_rounds_qd ON qd_foc_rounds(qd_id);

-- One scanned signature per user, drawn into the Signature column of the QD
-- form. Held in the database rather than on disk: the images are small, there
-- is exactly one per user, and this way they ride along in the existing pg_dump
-- backup instead of needing their own volume. Separate table so the blob never
-- loads with an ordinary SELECT * FROM users.
CREATE TABLE IF NOT EXISTS user_signatures (
    user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    mime_type  TEXT NOT NULL,
    image      BYTEA NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Which (order, stage) pairs have already appeared in a daily summary report
-- that was emailed. A stage reports exactly once: the primary key is what stops
-- a back-dated entry being counted twice, and its absence is what lets a late
-- entry be found at all.
--
-- The schedule and recipients live on reminder_settings, which db.cjs creates
-- on boot -- that table has never been mirrored here, so neither are its
-- daily_summary_* columns.
CREATE TABLE IF NOT EXISTS daily_report_ledger (
    order_id    INTEGER NOT NULL REFERENCES die_orders(id) ON DELETE CASCADE,
    stage       TEXT    NOT NULL,
    stage_date  DATE    NOT NULL,
    reported_on DATE    NOT NULL,
    PRIMARY KEY (order_id, stage)
);
CREATE INDEX IF NOT EXISTS idx_daily_report_ledger_reported_on
    ON daily_report_ledger(reported_on);

-- Note: Admin user is created by the application on startup with proper bcrypt hashing
