const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

// Get all plants (accessible to all authenticated users)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM plants ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching plants:', error);
        res.status(500).json({ error: 'Failed to fetch plants' });
    }
});

// Add new plant (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Plant name is required' });
        }

        const trimmedName = name.trim().toUpperCase();

        // Check if plant already exists
        const existing = await pool.query('SELECT id FROM plants WHERE name = $1', [trimmedName]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Plant already exists' });
        }

        const result = await pool.query(
            'INSERT INTO plants (name) VALUES ($1) RETURNING *',
            [trimmedName]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating plant:', error);
        res.status(500).json({ error: 'Failed to create plant' });
    }
});

// Rename a plant (admin only). Die life figures are stored under the plant's
// name, so they move with it in the same transaction; a half-renamed plant
// would strand its figures under a name the plants list no longer has.
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    let client;
    try {
        const { id } = req.params;
        const name = String((req.body && req.body.name) || '').trim().toUpperCase();
        if (!name) return res.status(400).json({ error: 'Plant name is required' });

        const existing = await pool.query('SELECT * FROM plants WHERE id = $1', [id]);
        if (existing.rows.length === 0) return res.status(404).json({ error: 'Plant not found' });
        const oldName = existing.rows[0].name;
        if (name === oldName) return res.json(existing.rows[0]);

        const clash = await pool.query('SELECT id FROM plants WHERE name = $1 AND id <> $2', [name, id]);
        if (clash.rows.length > 0) return res.status(400).json({ error: 'Plant already exists' });

        client = await pool.connect();
        await client.query('BEGIN');
        const updated = await client.query('UPDATE plants SET name = $1 WHERE id = $2 RETURNING *', [name, id]);
        await client.query('UPDATE supplier_die_life SET plant = $1 WHERE plant = $2', [name, oldName]);
        await client.query('COMMIT');
        res.json(updated.rows[0]);
    } catch (error) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        console.error('Error renaming plant:', error);
        res.status(500).json({ error: 'Failed to rename plant' });
    } finally {
        if (client) client.release();
    }
});

// Delete plant (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query('SELECT * FROM plants WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Plant not found' });
        }

        // Deleting the plant would leave its die life figures under a name
        // nothing lists, and out of every plant picker.
        const used = await pool.query('SELECT 1 FROM supplier_die_life WHERE plant = $1 LIMIT 1', [existing.rows[0].name]);
        if (used.rows.length > 0) {
            return res.status(409).json({ error: 'This plant has die life figures and cannot be deleted' });
        }

        await pool.query('DELETE FROM plants WHERE id = $1', [id]);
        res.json({ message: 'Plant deleted successfully' });
    } catch (error) {
        console.error('Error deleting plant:', error);
        res.status(500).json({ error: 'Failed to delete plant' });
    }
});

module.exports = router;
