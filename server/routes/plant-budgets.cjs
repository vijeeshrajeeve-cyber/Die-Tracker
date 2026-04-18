const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

// GET /api/plant-budgets - get all budget rows (all authenticated users)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM plant_budgets ORDER BY year, plant_name, type'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching plant budgets:', error);
        res.status(500).json({ error: 'Failed to fetch plant budgets' });
    }
});

// POST /api/plant-budgets - upsert single plant/year/type row (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { plant_name, year, type, values } = req.body;
        if (
            !plant_name ||
            !year ||
            !['backup', 'new'].includes(type) ||
            !Array.isArray(values) ||
            values.length !== 12
        ) {
            return res.status(400).json({
                error: 'plant_name, year, type, and values (array of 12) are required',
            });
        }
        const yearInt = parseInt(year, 10);
        const numeric = values.map(v => parseInt(v, 10) || 0);

        await pool.query(
            `INSERT INTO plant_budgets (plant_name, year, type, values)
             VALUES ($1, $2, $3, $4::jsonb)
             ON CONFLICT (plant_name, year, type) DO UPDATE
             SET values = $4::jsonb, updated_at = CURRENT_TIMESTAMP`,
            [plant_name, yearInt, type, JSON.stringify(numeric)]
        );

        const result = await pool.query(
            'SELECT * FROM plant_budgets WHERE plant_name=$1 AND year=$2 AND type=$3',
            [plant_name, yearInt, type]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error saving plant budget:', error);
        res.status(500).json({ error: 'Failed to save plant budget' });
    }
});

// POST /api/plant-budgets/import - bulk upsert from parsed CSV rows (admin only)
router.post('/import', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { rows } = req.body; // [{ plant_name, year, type, values: [12] }]
        if (!Array.isArray(rows) || rows.length === 0) {
            return res.status(400).json({ error: 'rows array is required' });
        }

        let imported = 0;
        for (const row of rows) {
            const { plant_name, year, type, values } = row;
            if (
                !plant_name ||
                !year ||
                !['backup', 'new'].includes(type) ||
                !Array.isArray(values) ||
                values.length !== 12
            ) {
                return res.status(400).json({ error: `Invalid row: ${JSON.stringify(row)}` });
            }
            const yearInt = parseInt(year, 10);
            const numeric = values.map(v => parseInt(v, 10) || 0);
            await pool.query(
                `INSERT INTO plant_budgets (plant_name, year, type, values)
                 VALUES ($1, $2, $3, $4::jsonb)
                 ON CONFLICT (plant_name, year, type) DO UPDATE
                 SET values = $4::jsonb, updated_at = CURRENT_TIMESTAMP`,
                [plant_name, yearInt, type, JSON.stringify(numeric)]
            );
            imported++;
        }

        res.json({ message: `Imported ${imported} budget rows successfully` });
    } catch (error) {
        console.error('Error importing plant budgets:', error);
        res.status(500).json({ error: 'Failed to import plant budgets' });
    }
});

module.exports = router;
