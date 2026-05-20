const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware } = require('./auth.cjs');

// Get all presses (name + code + assigned plant)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, press_name, press_code, plant FROM presses ORDER BY press_name'
        );
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching presses:', error);
        res.status(500).json({ error: 'Failed to fetch presses' });
    }
});

module.exports = router;
