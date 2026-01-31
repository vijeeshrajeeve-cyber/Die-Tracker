require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Validate database configuration
const validateDbConfig = () => {
  // If DATABASE_URL is provided, use it; otherwise check for individual params
  if (process.env.DATABASE_URL) {
    return; // DATABASE_URL contains all connection info
  }

  const required = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0 && process.env.NODE_ENV === 'production') {
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
    user: process.env.PGUSER || 'dieorder',
    password: process.env.PGPASSWORD || 'dieorder123',
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

// Test connection and log status
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

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
      END $$;

      -- Suppliers table
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Plants table
      CREATE TABLE IF NOT EXISTS plants (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
        oracle_entry TEXT,
        supplier TEXT,
        status TEXT,
        overall_delay INTEGER DEFAULT 0,
        eta TEXT,
        month TEXT,
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
      const plants = ['EXT 1', 'EXT 2'];
      for (const name of plants) {
        await client.query('INSERT INTO plants (name) VALUES ($1)', [name]);
      }
      console.log('Seeded plants table with default plants');
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
