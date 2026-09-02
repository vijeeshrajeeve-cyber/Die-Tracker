const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

const {
    clean, getField, extractProfile, composeDieSize,
    DIE_NO_ALIASES, PROFILE_ALIASES, CUSTOMER_ALIASES, PRESS_ALIASES,
} = require('../services/dieListImport.cjs');

// Rows per INSERT statement. Postgres caps a statement at 65535 bound
// parameters; at 9 columns this leaves a wide margin however many rows the
// client sends in one request.
const INSERT_BATCH = 1000;

// One multi-row INSERT per batch instead of a query per row. A 45,000-row die
// list is thousands of sequential round-trips otherwise, which runs past the
// proxy's 60s read timeout and rolls the whole transaction back.
const insertRows = async (client, table, columns, values) => {
    const colList = columns.map((c) => c.name).join(', ');
    for (let start = 0; start < values.length; start += INSERT_BATCH) {
        const batch = values.slice(start, start + INSERT_BATCH);
        const placeholders = batch.map((_, i) => {
            const base = i * columns.length;
            return `(${columns.map((c, j) => `$${base + j + 1}${c.cast || ''}`).join(', ')})`;
        }).join(', ');
        await client.query(
            `INSERT INTO ${table} (${colList}) VALUES ${placeholders}`,
            batch.flat()
        );
    }
};

const toInt = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = parseInt(String(value).replace(/,/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const getMeta = async () => {
    const dieDetails = await pool.query(`
        SELECT plant, COUNT(*)::int AS count, MAX(updated_at) AS last_imported
        FROM existing_die_details
        GROUP BY plant
        ORDER BY plant
    `);
    const productionData = await pool.query(`
        SELECT plant, COUNT(*)::int AS count, MAX(updated_at) AS last_imported
        FROM existing_production_data
        GROUP BY plant
        ORDER BY plant
    `);
    return {
        dieDetails: dieDetails.rows,
        productionData: productionData.rows,
    };
};

router.get('/meta', authMiddleware, async (req, res) => {
    try {
        res.json(await getMeta());
    } catch (error) {
        console.error('Existing data meta error:', error);
        res.status(500).json({ error: 'Failed to fetch existing data metadata' });
    }
});

router.post('/die-details/import', authMiddleware, adminMiddleware, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const plant = clean(req.body?.plant, 100);
    const sourceFile = clean(req.body?.sourceFile, 255);
    // A large sheet arrives as several chunks: only the first clears the
    // plant's existing rows, the rest append. Omitting the flag keeps the
    // original replace-everything behaviour for single-request imports.
    const replace = req.body?.replace !== false;
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    if (rows.length === 0) return res.status(400).json({ error: 'rows array is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (replace) {
            await client.query('DELETE FROM existing_die_details WHERE plant = $1', [plant]);
        }

        const values = [];
        let skipped = 0;
        for (const row of rows) {
            const dieNo = clean(getField(row, DIE_NO_ALIASES));
            const profile = clean(getField(row, PROFILE_ALIASES)) || extractProfile(dieNo);
            const customer = clean(getField(row, CUSTOMER_ALIASES));
            const dieSize = composeDieSize(row);
            const press = clean(getField(row, PRESS_ALIASES));

            if (!dieNo && !profile && !customer && !dieSize && !press) {
                skipped++;
                continue;
            }

            values.push([plant, dieNo, profile, customer, dieSize, press, JSON.stringify(row), sourceFile]);
        }

        await insertRows(client, 'existing_die_details', [
            { name: 'plant' }, { name: 'die_no' }, { name: 'profile_number' },
            { name: 'customer' }, { name: 'die_size' }, { name: 'press' },
            { name: 'raw_data', cast: '::jsonb' }, { name: 'source_file' },
        ], values);
        const imported = values.length;

        await client.query('COMMIT');
        res.json({ imported, skipped, total: rows.length, meta: await getMeta() });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Existing die details import error:', error);
        res.status(500).json({ error: 'Import failed: ' + error.message });
    } finally {
        client.release();
    }
});

router.post('/production/import', authMiddleware, adminMiddleware, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const plant = clean(req.body?.plant, 100);
    const sourceFile = clean(req.body?.sourceFile, 255);
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    const replace = req.body?.replace !== false;
    if (rows.length === 0) return res.status(400).json({ error: 'rows array is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (replace) {
            await client.query('DELETE FROM existing_production_data WHERE plant = $1', [plant]);
        }

        const values = [];
        let skipped = 0;
        for (const row of rows) {
            const dieNo = clean(getField(row, DIE_NO_ALIASES));
            const profile = clean(getField(row, PROFILE_ALIASES)) || extractProfile(dieNo);
            const customer = clean(getField(row, CUSTOMER_ALIASES));
            const productionDate = clean(getField(row, ['production date', 'production_date', 'date', 'prod date', 'month']));
            const quantity = toInt(getField(row, ['quantity', 'qty', 'production qty', 'production quantity', 'pieces', 'pcs']));
            const press = clean(getField(row, PRESS_ALIASES));

            if (!dieNo && !profile && !customer && !productionDate && quantity === null && !press) {
                skipped++;
                continue;
            }

            values.push([plant, dieNo, profile, customer, productionDate, quantity, press, JSON.stringify(row), sourceFile]);
        }

        await insertRows(client, 'existing_production_data', [
            { name: 'plant' }, { name: 'die_no' }, { name: 'profile_number' },
            { name: 'customer' }, { name: 'production_date' }, { name: 'quantity' },
            { name: 'press' }, { name: 'raw_data', cast: '::jsonb' }, { name: 'source_file' },
        ], values);
        const imported = values.length;

        await client.query('COMMIT');
        res.json({ imported, skipped, total: rows.length, meta: await getMeta() });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Existing production data import error:', error);
        res.status(500).json({ error: 'Import failed: ' + error.message });
    } finally {
        client.release();
    }
});

module.exports = router;
