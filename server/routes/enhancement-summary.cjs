'use strict';
// Analytics -> Enhancements: the design enhancement summary. Read-only.
const express = require('express');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { isIsoDate } = require('../services/designEnhancement.cjs');
const { loadEnhancementSummary } = require('../services/enhancementSummary.cjs');

const router = express.Router();
const MAX_YEARS = 10;

router.get('/', async (req, res) => {
    try {
        const year = todayLocal().slice(0, 4);
        const from = req.query.from === undefined ? `${year}-01-01` : req.query.from;
        const to = req.query.to === undefined ? `${year}-12-31` : req.query.to;
        if (!isIsoDate(from) || !isIsoDate(to)) {
            return res.status(400).json({ error: 'from and to must be dates written YYYY-MM-DD' });
        }
        if (from > to) return res.status(400).json({ error: 'from cannot be after to' });
        if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) >= MAX_YEARS) {
            return res.status(400).json({ error: `The period cannot cover more than ${MAX_YEARS} years` });
        }
        res.json(await loadEnhancementSummary(pool, { from, to }));
    } catch (error) {
        console.error('Get enhancement summary error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
