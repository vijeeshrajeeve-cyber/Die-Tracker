const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

// Get all suppliers (accessible to all authenticated users)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY name');
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        res.status(500).json({ error: 'Failed to fetch suppliers' });
    }
});

// Add new supplier (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { name, shipment_mode } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Supplier name is required' });
        }

        const trimmedName = name.trim().toUpperCase();
        const mode = (shipment_mode || 'LAND').toUpperCase();

        if (!['AIR', 'LAND'].includes(mode)) {
            return res.status(400).json({ error: 'Shipment mode must be AIR or LAND' });
        }

        // Check if supplier already exists
        const existing = await pool.query('SELECT id FROM suppliers WHERE name = $1', [trimmedName]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Supplier already exists' });
        }

        const result = await pool.query(
            'INSERT INTO suppliers (name, shipment_mode) VALUES ($1, $2) RETURNING *',
            [trimmedName, mode]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Error creating supplier:', error);
        res.status(500).json({ error: 'Failed to create supplier' });
    }
});

// Update supplier (admin only)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const { shipment_mode } = req.body;

        const existing = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        const mode = (shipment_mode || 'LAND').toUpperCase();
        if (!['AIR', 'LAND'].includes(mode)) {
            return res.status(400).json({ error: 'Shipment mode must be AIR or LAND' });
        }

        const result = await pool.query(
            'UPDATE suppliers SET shipment_mode = $1 WHERE id = $2 RETURNING *',
            [mode, id]
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error updating supplier:', error);
        res.status(500).json({ error: 'Failed to update supplier' });
    }
});

// Delete supplier (admin only)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { id } = req.params;

        const existing = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'Supplier not found' });
        }

        await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
        res.json({ message: 'Supplier deleted successfully' });
    } catch (error) {
        console.error('Error deleting supplier:', error);
        res.status(500).json({ error: 'Failed to delete supplier' });
    }
});

module.exports = router;
