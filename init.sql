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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- Seed suppliers
INSERT INTO suppliers (name) VALUES 
    ('PDTMC'), ('EKSTEK'), ('PHOENIX'), ('COMPES'), ('PHME'),
    ('ADEX'), ('JIANGSU'), ('COMES'), ('ALMAX'), ('WEFA')
ON CONFLICT (name) DO NOTHING;

-- Seed plants
INSERT INTO plants (name) VALUES 
    ('GEX 1'), ('GEX 2')
ON CONFLICT (name) DO NOTHING;

-- Note: Admin user is created by the application on startup with proper bcrypt hashing
