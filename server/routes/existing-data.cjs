const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

const clean = (value, max = 500) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.substring(0, max) : null;
};

const normalizeKey = (key) => String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const getField = (row, aliases) => {
    const normalized = {};
    Object.entries(row || {}).forEach(([key, value]) => {
        normalized[normalizeKey(key)] = value;
    });

    for (const alias of aliases) {
        const value = normalized[normalizeKey(alias)];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            return value;
        }
    }
    return null;
};

const extractProfile = (dieNo) => {
    const text = clean(dieNo);
    if (!text) return null;
    return text.split('-')[0].replace(/^0+/, '') || null;
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
    if (!plant) return res.status(400).json({ error: 'plant is required' });
    if (rows.length === 0) return res.status(400).json({ error: 'rows array is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM existing_die_details WHERE plant = $1', [plant]);

        let imported = 0;
        let skipped = 0;
        for (const row of rows) {
            const dieNo = clean(getField(row, ['die no', 'die_no', 'die', 'die number', 'die number/name', 'die number name']));
            const profile = clean(getField(row, ['profile', 'profile number', 'profile_number'])) || extractProfile(dieNo);
            const customer = clean(getField(row, ['customer', 'customer name', 'customer_name', 'party', 'client']));
            const dieSize = clean(getField(row, ['die size', 'die_size', 'size', 'section size', 'profile size']));
            const press = clean(getField(row, ['press', 'press name', 'press code', 'machine']));

            if (!dieNo && !profile && !customer && !dieSize && !press) {
                skipped++;
                continue;
            }

            await client.query(
                `INSERT INTO existing_die_details
                    (plant, die_no, profile_number, customer, die_size, press, raw_data, source_file)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [plant, dieNo, profile, customer, dieSize, press, JSON.stringify(row), sourceFile]
            );
            imported++;
        }

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
    if (rows.length === 0) return res.status(400).json({ error: 'rows array is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM existing_production_data WHERE plant = $1', [plant]);

        let imported = 0;
        let skipped = 0;
        for (const row of rows) {
            const dieNo = clean(getField(row, ['die no', 'die_no', 'die', 'die number', 'die number/name', 'die number name']));
            const profile = clean(getField(row, ['profile', 'profile number', 'profile_number'])) || extractProfile(dieNo);
            const customer = clean(getField(row, ['customer', 'customer name', 'customer_name', 'party', 'client']));
            const productionDate = clean(getField(row, ['production date', 'production_date', 'date', 'prod date', 'month']));
            const quantity = toInt(getField(row, ['quantity', 'qty', 'production qty', 'production quantity', 'pieces', 'pcs']));
            const press = clean(getField(row, ['press', 'press name', 'press code', 'machine']));

            if (!dieNo && !profile && !customer && !productionDate && quantity === null && !press) {
                skipped++;
                continue;
            }

            await client.query(
                `INSERT INTO existing_production_data
                    (plant, die_no, profile_number, customer, production_date, quantity, press, raw_data, source_file)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
                [plant, dieNo, profile, customer, productionDate, quantity, press, JSON.stringify(row), sourceFile]
            );
            imported++;
        }

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
