require('dotenv').config();
const { Pool, types } = require('pg');
const bcrypt = require('bcryptjs');

// Return PostgreSQL DATE columns as raw 'YYYY-MM-DD' strings instead of JS Date
// objects. The default parser converts to a Date in the server's local zone,
// which then serializes to JSON as an ISO datetime with a UTC offset — breaking
// downstream code that expects YYYY-MM-DD and causing off-by-one display bugs.
// 1082 = DATE OID.
types.setTypeParser(1082, (val) => val);

// Validate database configuration
const validateDbConfig = () => {
  // If DATABASE_URL is provided, use it; otherwise check for individual params
  if (process.env.DATABASE_URL) {
    return; // DATABASE_URL contains all connection info
  }

  const required = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required database environment variables: ${missing.join(', ')}`);
  }
};

// Build pool configuration
const getPoolConfig = () => {
  // If DATABASE_URL is provided (Docker/Supabase), use connection string
  if (process.env.DATABASE_URL) {
    // Disable SSL for internal Docker connections (supabase-db doesn't have SSL enabled)
    const isDockerInternal = process.env.DATABASE_URL.includes('supabase-db') ||
      process.env.DATABASE_URL.includes('localhost');
    return {
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Only enable SSL for external production connections
      ssl: !isDockerInternal && process.env.PGSSLMODE === 'require'
        ? { rejectUnauthorized: false }
        : false,
    };
  }

  // Otherwise use individual environment variables
  const host = process.env.PGHOST || 'localhost';
  const isDockerInternal = host === 'supabase-db' || host === 'localhost';

  return {
    host: host,
    port: parseInt(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || 'die_ordering',
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    // Only enable SSL for external production connections
    ssl: !isDockerInternal && process.env.PGSSLMODE === 'require'
      ? { rejectUnauthorized: false }
      : false,
  };
};

// PostgreSQL connection configuration
const pool = new Pool(getPoolConfig());

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

// Initialize database tables
const initializeDatabase = async () => {
  validateDbConfig();

  const client = await pool.connect();
  try {
    // Create tables
    await client.query(`
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

      -- Add columns if they don't exist (for existing databases)
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_must_change') THEN
          ALTER TABLE users ADD COLUMN password_must_change BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='failed_login_attempts') THEN
          ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='locked_until') THEN
          ALTER TABLE users ADD COLUMN locked_until TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='updated_at') THEN
          ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='page_access') THEN
          ALTER TABLE users ADD COLUMN page_access TEXT DEFAULT NULL;
        END IF;
      END $$;

      -- Suppliers table
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        shipment_mode TEXT DEFAULT 'LAND',
        region TEXT,
        contact_email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add shipment_mode column if not exists (migration for existing DBs)
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='shipment_mode') THEN
          ALTER TABLE suppliers ADD COLUMN shipment_mode TEXT DEFAULT 'LAND';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='region') THEN
          ALTER TABLE suppliers ADD COLUMN region TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='contact_email') THEN
          ALTER TABLE suppliers ADD COLUMN contact_email TEXT;
        END IF;
      END $$;

      -- Backfill default regions for known suppliers when region is null
      UPDATE suppliers SET region = v.region FROM (VALUES
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
      ) AS v(name, region)
      WHERE suppliers.name = v.name AND (suppliers.region IS NULL OR suppliers.region = '');

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
        cavity INTEGER DEFAULT 0,
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
        design_revision_count INTEGER DEFAULT 0,
        last_revision_date TEXT,
        change_log TEXT DEFAULT '[]',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add new optional columns to existing die_orders installs
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='pr_number') THEN
          ALTER TABLE die_orders ADD COLUMN pr_number TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='customer_name') THEN
          ALTER TABLE die_orders ADD COLUMN customer_name TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='die_received_date') THEN
          ALTER TABLE die_orders ADD COLUMN die_received_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='submission_date') THEN
          ALTER TABLE die_orders ADD COLUMN submission_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='sample_approval_date') THEN
          ALTER TABLE die_orders ADD COLUMN sample_approval_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='no_of_trial') THEN
          ALTER TABLE die_orders ADD COLUMN no_of_trial INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='corrector') THEN
          ALTER TABLE die_orders ADD COLUMN corrector TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='press') THEN
          ALTER TABLE die_orders ADD COLUMN press TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='cavity') THEN
          ALTER TABLE die_orders ADD COLUMN cavity INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='ascona_reference') THEN
          ALTER TABLE die_orders ADD COLUMN ascona_reference TEXT DEFAULT 'No';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='sample_status') THEN
          ALTER TABLE die_orders ADD COLUMN sample_status TEXT DEFAULT 'Pending';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='remark') THEN
          ALTER TABLE die_orders ADD COLUMN remark TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='change_log') THEN
          ALTER TABLE die_orders ADD COLUMN change_log TEXT DEFAULT '[]';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='urgency') THEN
          ALTER TABLE die_orders ADD COLUMN urgency TEXT DEFAULT 'NORMAL';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='special_follow_up') THEN
          ALTER TABLE die_orders ADD COLUMN special_follow_up BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='design_revision_count') THEN
          ALTER TABLE die_orders ADD COLUMN design_revision_count INTEGER DEFAULT 0;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='last_revision_date') THEN
          ALTER TABLE die_orders ADD COLUMN last_revision_date TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='design_to_ems_date') THEN
          ALTER TABLE die_orders ADD COLUMN design_to_ems_date DATE;
        END IF;
        -- Per-revision notes/pdf live in order_revisions; drop any legacy columns
        ALTER TABLE die_orders DROP COLUMN IF EXISTS revision_notes;
        ALTER TABLE die_orders DROP COLUMN IF EXISTS revision_pdf;
      END $$;

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

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='press') THEN
          ALTER TABLE backup_die_requests ADD COLUMN press TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='cavity') THEN
          ALTER TABLE backup_die_requests ADD COLUMN cavity INTEGER DEFAULT 0;
        END IF;
      END $$;

      -- Press master (press name → code)
      CREATE TABLE IF NOT EXISTS presses (
        id SERIAL PRIMARY KEY,
        press_name TEXT UNIQUE NOT NULL,
        press_code TEXT NOT NULL,
        plant TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='presses' AND column_name='plant') THEN
          ALTER TABLE presses ADD COLUMN plant TEXT;
        END IF;
      END $$;

      -- API Keys table for external data access (e.g. Excel Power Query)
      CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        key_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id),
        last_used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
        auth_method TEXT DEFAULT 'basic',
        oauth_tenant_id TEXT,
        oauth_client_id TEXT,
        oauth_client_secret TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Migrate existing email_config table if it has old Power Automate columns
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='smtp_host') THEN
          ALTER TABLE email_config ADD COLUMN smtp_host TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='smtp_port') THEN
          ALTER TABLE email_config ADD COLUMN smtp_port INTEGER DEFAULT 587;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='imap_host') THEN
          ALTER TABLE email_config ADD COLUMN imap_host TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='imap_port') THEN
          ALTER TABLE email_config ADD COLUMN imap_port INTEGER DEFAULT 993;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='email_user') THEN
          ALTER TABLE email_config ADD COLUMN email_user TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='email_password') THEN
          ALTER TABLE email_config ADD COLUMN email_password TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='send_enabled') THEN
          ALTER TABLE email_config ADD COLUMN send_enabled BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_config' AND column_name='receive_enabled') THEN
          ALTER TABLE email_config ADD COLUMN receive_enabled BOOLEAN DEFAULT false;
        END IF;
      END $$;

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

      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_templates' AND column_name='default_to') THEN
          ALTER TABLE email_templates ADD COLUMN default_to TEXT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='email_templates' AND column_name='default_cc') THEN
          ALTER TABLE email_templates ADD COLUMN default_cc TEXT;
        END IF;
      END $$;

      -- Plant budget targets for monthly trend charts
      CREATE TABLE IF NOT EXISTS plant_budgets (
        id SERIAL PRIMARY KEY,
        plant_name VARCHAR(100) NOT NULL,
        year INTEGER NOT NULL,
        type VARCHAR(10) NOT NULL CHECK (type IN ('backup', 'new')),
        values JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(plant_name, year, type)
      );

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

      -- App migrations marker table (one-time data migrations)
      CREATE TABLE IF NOT EXISTS app_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- One-time: enforce first-login password reset for every existing user.
      -- Admins who have already rotated their password will be asked to rotate again once.
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE id = 'force_pwd_reset_all_users_v1') THEN
          UPDATE users SET password_must_change = true;
          INSERT INTO app_migrations (id) VALUES ('force_pwd_reset_all_users_v1');
        END IF;
      END $$;

      -- Sample Followups table
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
    `);

    // Create default admin user if not exists
    const adminUsername = process.env.DEFAULT_ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

    const adminCheck = await client.query('SELECT id FROM users WHERE username = $1', [adminUsername]);
    if (adminCheck.rows.length === 0) {
      const passwordHash = bcrypt.hashSync(adminPassword, 12); // Increased salt rounds
      await client.query(
        'INSERT INTO users (username, password_hash, role, password_must_change) VALUES ($1, $2, $3, $4)',
        [adminUsername, passwordHash, 'admin', true] // Force password change on first login
      );
      console.log(`Created default admin user: ${adminUsername} (password change required on first login)`);
    }

    // Seed suppliers if table is empty
    const supplierCount = await client.query('SELECT COUNT(*) as count FROM suppliers');
    if (parseInt(supplierCount.rows[0].count) === 0) {
      const suppliers = ['PDTMC', 'EKSTEK', 'PHOENIX', 'COMPES', 'PHME', 'ADEX', 'JIANGSU', 'COMES', 'ALMAX', 'WEFA'];
      for (const name of suppliers) {
        await client.query('INSERT INTO suppliers (name) VALUES ($1)', [name]);
      }
      console.log('Seeded suppliers table with default suppliers');
    }

    // Seed plants if table is empty
    const plantCount = await client.query('SELECT COUNT(*) as count FROM plants');
    if (parseInt(plantCount.rows[0].count) === 0) {
      const plants = ['GEX 01', 'GEX 02'];
      for (const name of plants) {
        await client.query('INSERT INTO plants (name) VALUES ($1)', [name]);
      }
      console.log('Seeded plants table with default plants');
    }

    // Seed / sync default presses with their assigned plant
    await client.query(`
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
        plant = EXCLUDED.plant
    `);

    // Seed default email templates if table is empty
    const templateCount = await client.query('SELECT COUNT(*) as count FROM email_templates');
    if (parseInt(templateCount.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO email_templates (name, subject_template, body_template, category) VALUES
        ('Design Reminder', 'URGENT: Design Pending for {{orderCount}} Die Order(s) - {{supplier}}',
         'Dear {{supplier}} Team,\n\nThis is a reminder that the following die order(s) have been awaiting design for more than 48 hours:\n\n{{orderList}}\n\nPlease provide the design drawings at the earliest to avoid further delays in production.\n\nBest regards,\nDie Ordering Team',
         'design_reminder'),
        ('Ordering Reminder', 'URGENT: {{orderCount}} Die Order(s) Pending Ordering - {{plant}}',
         'Dear Purchase Team,\n\nThe following die order(s) for {{plant}} have been pending ordering for more than 24 hours:\n\n{{orderList}}\n\nPlease process these orders at the earliest to avoid production delays.\n\nBest regards,\nDie Ordering Team',
         'ordering_reminder')
      `);
      console.log('Seeded email_templates with default templates');
    }

    await client.query(`
      INSERT INTO email_templates (name, subject_template, body_template, category) VALUES
      ('PDF Drawing Request', 'URGENT: PDF Drawing Request for {{requestCount}} Backup Die Request(s)',
       'Dear Design Team,\n\nPlease provide PDF drawings for the selected backup die request(s).\n\nBest regards,\nDie Ordering Team',
       'pdf_drawing_request')
      ON CONFLICT (name) DO NOTHING
    `);

    // Migration: order_changes table (replaces change_log TEXT column)
    const ocExists = await client.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name='order_changes'`
    );
    if (ocExists.rows.length === 0) {
      await client.query(`
        CREATE TABLE order_changes (
          id SERIAL PRIMARY KEY,
          order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          changed_by_name TEXT,
          changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT,
          reason TEXT,
          stage TEXT
        );
        CREATE INDEX idx_order_changes_order_id ON order_changes(order_id);
      `);
      console.log('Created order_changes table');

      // Migrate existing change_log JSON into order_changes
      const rows = await client.query(
        `SELECT id, change_log FROM die_orders WHERE change_log IS NOT NULL AND change_log != '[]'`
      );
      let migrated = 0;
      for (const row of rows.rows) {
        let entries;
        try { entries = JSON.parse(row.change_log); } catch { continue; }
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          if (!e || !e.field) continue;
          const changedAt = e.date ? new Date(e.date) : new Date();
          await client.query(
            `INSERT INTO order_changes
              (order_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              row.id,
              e.changedBy || null,
              isNaN(changedAt) ? new Date() : changedAt,
              String(e.field),
              e.oldValue != null ? String(e.oldValue) : null,
              e.newValue != null ? String(e.newValue) : null,
              e.reason || null,
              e.stage || null,
            ]
          );
          migrated++;
        }
      }
      console.log(`Migrated ${migrated} change log entries to order_changes`);

      // Drop change_log column now that data is migrated
      const clColExists = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='die_orders' AND column_name='change_log'`
      );
      if (clColExists.rows.length > 0) {
        await client.query(`ALTER TABLE die_orders DROP COLUMN change_log`);
        console.log('Dropped die_orders.change_log column');
      }
    }

    // Order revisions history (one die order can have many design revisions)
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_revisions (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES die_orders(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        from_status TEXT,
        to_status TEXT,
        notes TEXT,
        revision_date TEXT,
        revision_pdf TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_by_name TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_order_revisions_order_id ON order_revisions(order_id)`);

    // Migration: TEXT date columns → DATE
    if (!(await client.query(`SELECT 1 FROM app_migrations WHERE id='date_columns_to_date_v1'`)).rows.length) {
      const dieDateCols = [
        'die_requested_date','ordered_date','design_received_date',
        'three_d_model_received_date','design_approved_date','die_received_date',
        'submission_date','sample_approval_date'
      ];
      for (const col of dieDateCols) {
        const exists = await client.query(
          `SELECT data_type FROM information_schema.columns WHERE table_name='die_orders' AND column_name=$1`, [col]
        );
        if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
          await client.query(`
            ALTER TABLE die_orders
              ALTER COLUMN ${col} TYPE DATE
              USING CASE
                WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN SUBSTRING(${col}, 1, 10)::DATE
                WHEN ${col} ~ '^\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{4}$'
                  THEN TO_DATE(${col}, 'DD/MM/YYYY')
                ELSE NULL
              END
          `);
        }
      }

      const backupDateCols = ['requested_date','drawing_requested','ordered_date'];
      for (const col of backupDateCols) {
        const exists = await client.query(
          `SELECT data_type FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name=$1`, [col]
        );
        if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
          await client.query(`
            ALTER TABLE backup_die_requests
              ALTER COLUMN ${col} TYPE DATE
              USING CASE
                WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN SUBSTRING(${col}, 1, 10)::DATE
                WHEN ${col} ~ '^\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{4}$'
                  THEN TO_DATE(${col}, 'DD/MM/YYYY')
                ELSE NULL
              END
          `);
        }
      }

      const followupDateCols = ['die_received_date','submission_date','sample_approval_date'];
      for (const col of followupDateCols) {
        const exists = await client.query(
          `SELECT data_type FROM information_schema.columns WHERE table_name='sample_followups' AND column_name=$1`, [col]
        );
        if (exists.rows.length > 0 && exists.rows[0].data_type === 'text') {
          await client.query(`
            ALTER TABLE sample_followups
              ALTER COLUMN ${col} TYPE DATE
              USING CASE
                WHEN ${col} ~ '^\\d{4}-\\d{2}-\\d{2}' THEN SUBSTRING(${col}, 1, 10)::DATE
                WHEN ${col} ~ '^\\d{1,2}[/\\-.]\\d{1,2}[/\\-.]\\d{4}$'
                  THEN TO_DATE(${col}, 'DD/MM/YYYY')
                ELSE NULL
              END
          `);
        }
      }

      await client.query(`INSERT INTO app_migrations (id) VALUES ('date_columns_to_date_v1')`);
      console.log('Converted TEXT date columns to DATE type');
    }

    // die_available holds labels/counts (e.g. Yes/No), not calendar dates
    if (!(await client.query(`SELECT 1 FROM app_migrations WHERE id='die_available_text_v1'`)).rows.length) {
      const dieAvailableCol = await client.query(
        `SELECT data_type FROM information_schema.columns WHERE table_name='backup_die_requests' AND column_name='die_available'`
      );
      if (dieAvailableCol.rows.length > 0 && dieAvailableCol.rows[0].data_type === 'date') {
        await client.query(`
          ALTER TABLE backup_die_requests
            ALTER COLUMN die_available TYPE TEXT
            USING CASE
              WHEN die_available IS NULL THEN NULL
              ELSE die_available::TEXT
            END
        `);
      }
      await client.query(`INSERT INTO app_migrations (id) VALUES ('die_available_text_v1')`);
      console.log('Ensured backup_die_requests.die_available is TEXT');
    }


    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Export pool and initialize function
module.exports = { pool, initializeDatabase };
