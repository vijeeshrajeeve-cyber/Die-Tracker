const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db.cjs');

const router = express.Router();

// All available fields and their DB column mappings
const FIELD_MAP = {
    'plant': 'plant',
    'order_no': 'order_no',
    'die_no': 'die_no',
    'type': 'type',
    'die_size': 'die_size',
    'die_requested_date': 'die_requested_date',
    'ordered_date': 'ordered_date',
    'shipment_type': 'shipment_type',
    'mandrels_per_cavity': 'mandrels_per_cavity',
    'total_mandrels': 'total_mandrels',
    'design_received_date': 'design_received_date',
    'three_d_model_received_date': 'three_d_model_received_date',
    'simulation_enabled': 'simulation_enabled',
    'design_approved_date': 'design_approved_date',
    'delay': 'delay',
    'pr_entry': 'pr_entry',
    'pr_number': 'pr_number',
    'customer_name': 'customer_name',
    'oracle_entry': 'oracle_entry',
    'supplier': 'supplier',
    'status': 'status',
    'overall_delay': 'overall_delay',
    'eta': 'eta',
    'month': 'month',
    'die_received_date': 'die_received_date',
    'submission_date': 'submission_date',
    'sample_approval_date': 'sample_approval_date',
    'no_of_trial': 'no_of_trial',
    'corrector': 'corrector',
    'press': 'press',
    'ascona_reference': 'ascona_reference',
    'sample_status': 'sample_status',
    'remark': 'remark',
    'sample_remark': 'sample_remark',
    'urgency': 'urgency',
    'special_follow_up': 'special_follow_up'
};

// Display-friendly column headers
const DISPLAY_NAMES = {
    'plant': 'Plant',
    'order_no': 'Order No',
    'die_no': 'DIE NO',
    'type': 'TYPE',
    'die_size': 'Die Size',
    'die_requested_date': 'Die Requested Date',
    'ordered_date': 'Ordered Date',
    'shipment_type': 'Type of Shipment',
    'mandrels_per_cavity': 'Mandrels per Cavity',
    'total_mandrels': 'Total Mandrels',
    'design_received_date': 'Design Received Date',
    'three_d_model_received_date': '3D Model Received Date',
    'simulation_enabled': 'Simulation Enabled',
    'design_approved_date': 'Design Approved Date',
    'delay': 'Delay',
    'pr_entry': 'PR Entry',
    'pr_number': 'PR Number',
    'customer_name': 'Customer Name',
    'oracle_entry': 'Oracle Entry',
    'supplier': 'Supplier',
    'status': 'STATUS',
    'overall_delay': 'OVERALL DELAY',
    'eta': 'ETA',
    'month': 'Month',
    'die_received_date': 'Die Received Date',
    'submission_date': 'Submission Date',
    'sample_approval_date': 'Sample Approval Date',
    'no_of_trial': 'No of Trial',
    'corrector': 'Corrector',
    'press': 'Press',
    'ascona_reference': 'Ascona Reference',
    'sample_status': 'Sample Status',
    'remark': 'Remark',
    'sample_remark': 'Sample Remark',
    'urgency': 'Urgency',
    'special_follow_up': 'Special Follow-Up'
};

// Extract API key from Authorization header, X-API-Key header, or query param (deprecated)
const extractApiKey = (req) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
    if (req.headers['x-api-key']) return req.headers['x-api-key'];
    return req.query.key; // backward compat — query params appear in server logs
};

// Validate API key using async bcrypt to avoid blocking the event loop
const validateApiKey = async (key) => {
    if (!key || typeof key !== 'string' || key.length < 10) return null;

    const result = await pool.query('SELECT * FROM api_keys ORDER BY id');
    for (const row of result.rows) {
        if (await bcrypt.compare(key, row.key_hash)) {
            // Update last_used_at without blocking the response
            pool.query('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1', [row.id])
                .catch(err => console.error('Failed to update last_used_at:', err));
            return row;
        }
    }
    return null;
};

// Normalize date values to a clean ISO date (YYYY-MM-DD) that Excel / Power
// Query reliably recognises as a real date. Postgres returns DATE/TIMESTAMP
// columns as JS Date objects, which would otherwise serialize as noisy full
// timestamps. Non-date values pass through unchanged.
const pad2 = (n) => String(n).padStart(2, '0');
const formatDateValue = (val) => {
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        return `${val.getFullYear()}-${pad2(val.getMonth() + 1)}-${pad2(val.getDate())}`;
    }
    if (typeof val === 'string') {
        const m = val.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
        if (m) return m[1];
    }
    return val;
};

// Escape a value for CSV
const csvEscape = (val) => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
};

// GET /api/export/orders — key via Authorization: Bearer, X-API-Key header, or ?key= (deprecated)
router.get('/orders', async (req, res) => {
    try {
        const { format = 'csv', fields, status, plant, supplier } = req.query;

        // Extract and validate API key
        const key = extractApiKey(req);
        if (!key) {
            return res.status(401).json({ error: 'API key is required. Pass as Authorization: Bearer <key> or X-API-Key header.' });
        }

        const apiKeyRecord = await validateApiKey(key);
        if (!apiKeyRecord) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        // Determine which fields to return
        let selectedFields;
        if (fields) {
            const requested = fields.split(',').map(f => f.trim().toLowerCase());
            selectedFields = requested.filter(f => FIELD_MAP[f]);
            if (selectedFields.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields specified',
                    available_fields: Object.keys(FIELD_MAP)
                });
            }
        } else {
            selectedFields = Object.keys(FIELD_MAP);
        }

        // Build query with optional filters
        const columns = selectedFields.map(f => FIELD_MAP[f]);
        let query = `SELECT ${columns.join(', ')} FROM die_orders`;
        const conditions = [];
        const params = [];

        if (status) {
            params.push(status);
            conditions.push(`UPPER(status) = UPPER($${params.length})`);
        }
        if (plant) {
            params.push(plant);
            conditions.push(`UPPER(plant) = UPPER($${params.length})`);
        }
        if (supplier) {
            params.push(supplier);
            conditions.push(`UPPER(supplier) = UPPER($${params.length})`);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);

        if (format === 'json') {
            // Return JSON with display-friendly keys
            const rows = result.rows.map(row => {
                const obj = {};
                for (const field of selectedFields) {
                    obj[DISPLAY_NAMES[field]] = formatDateValue(row[FIELD_MAP[field]]);
                }
                return obj;
            });
            return res.json({ orders: rows, count: rows.length });
        }

        // Default: CSV
        const headers = selectedFields.map(f => DISPLAY_NAMES[f]);
        let csv = headers.map(csvEscape).join(',') + '\r\n';

        for (const row of result.rows) {
            const values = selectedFields.map(f => csvEscape(formatDateValue(row[FIELD_MAP[f]])));
            csv += values.join(',') + '\r\n';
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'inline; filename="die_orders_export.csv"');
        res.send(csv);
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/export/fields — list available fields (no auth needed, helpful for users)
router.get('/fields', (req, res) => {
    const fields = Object.keys(FIELD_MAP).map(key => ({
        name: key,
        display: DISPLAY_NAMES[key]
    }));
    res.json({ fields });
});

module.exports = router;
