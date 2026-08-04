const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');
const correctors = require('../services/correctors.cjs');

// Errors thrown by the service carry a .status; anything else is a real fault.
const handle = (res, error, fallback) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(fallback, error);
    res.status(500).json({ error: fallback });
};

// List correctors (any authenticated user — every form needs this)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const rows = await correctors.listCorrectors(pool, {
            plant: req.query.plant,
            includeInactive: req.query.includeInactive === 'true',
        });
        res.json(rows);
    } catch (error) {
        handle(res, error, 'Failed to fetch correctors');
    }
});

// Add a corrector (admin only)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.createCorrector(pool, req.body || {});
        res.status(201).json(row);
    } catch (error) {
        handle(res, error, 'Failed to create corrector');
    }
});

// Rename, move plant, or reactivate (admin only)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.updateCorrector(pool, req.params.id, req.body || {});
        if (!row) return res.status(404).json({ error: 'Corrector not found' });
        res.json(row);
    } catch (error) {
        handle(res, error, 'Failed to update corrector');
    }
});

// Deactivate — never removes the row, because historical dies store the name.
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const row = await correctors.deactivateCorrector(pool, req.params.id);
        if (!row) return res.status(404).json({ error: 'Corrector not found' });
        res.json({ message: 'Corrector deactivated', corrector: row });
    } catch (error) {
        handle(res, error, 'Failed to deactivate corrector');
    }
});

module.exports = router;
