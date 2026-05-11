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

// Delete plant (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query('SELECT * FROM plants WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Plant not found' });
        }

        await pool.query('DELETE FROM plants WHERE id = $1', [id]);
        res.json({ message: 'Plant deleted successfully' });
    } catch (error) {
        console.error('Error deleting plant:', error);
        res.status(500).json({ error: 'Failed to delete plant' });
    }
});

module.exports = router;
