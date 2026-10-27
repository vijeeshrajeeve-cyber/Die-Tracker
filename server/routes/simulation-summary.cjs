'use strict';
// Analytics -> Simulation: the simulation process summary. Read-only.
const express = require('express');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { loadSimulationSummary } = require('../services/simulationSummary.cjs');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        res.json(await loadSimulationSummary(pool, todayLocal()));
    } catch (error) {
        console.error('Get simulation summary error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
