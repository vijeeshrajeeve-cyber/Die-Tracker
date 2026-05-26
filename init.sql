-- Die Ordering App Database Initialization
-- This script runs on first container startup

-- Users table with password_must_change for security
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
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

-- Backup Die Requests table
CREATE TABLE IF NOT EXISTS backup_die_requests (
    id SERIAL PRIMARY KEY,
    plant TEXT,
    die_no TEXT,
    customer TEXT,
    press TEXT,
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

-- Sample Followup table
CREATE TABLE IF NOT EXISTS sample_followups (
    id SERIAL PRIMARY KEY,
    profile TEXT,
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
    raw_data JSONB NOT NULL DEFAULT '{}',
    source_file TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_existing_die_details_plant ON existing_die_details(plant);
CREATE INDEX IF NOT EXISTS idx_existing_die_details_die_no ON existing_die_details(die_no);

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

-- Note: Admin user is created by the application on startup with proper bcrypt hashing
