const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');
const settings = require('../services/supplierPerformanceSettings.cjs');
const model = require('../services/supplierPerformance.cjs');
const data = require('../services/supplierPerformanceData.cjs');

const handle = (res, error, fallback) => {
    if (error.status) return res.status(error.status).json({ error: error.message });
    console.error(fallback, error);
    res.status(500).json({ error: fallback });
};

router.get('/suppliers', authMiddleware, async (req, res) => {
    try {
        res.json(await data.listSuppliers(pool));
    } catch (error) { handle(res, error, 'Failed to fetch suppliers'); }
});

router.get('/settings', authMiddleware, async (req, res) => {
    try {
        res.json(await settings.getSettings(pool));
    } catch (error) { handle(res, error, 'Failed to fetch scoring settings'); }
});

router.put('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await settings.saveSettings(pool, req.body && req.body.metrics);
        res.json(await settings.getSettings(pool));
    } catch (error) { handle(res, error, 'Failed to save scoring settings'); }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        const supplier = String(req.query.supplier || '').trim();
        if (!supplier) return res.status(400).json({ error: 'A supplier is required' });
        const year = Number(req.query.year) || new Date().getFullYear();
        const month = String(req.query.month || data.MONTHS[new Date().getMonth()]);
        const frequency = ['Monthly', 'Quarterly', 'YTD'].includes(req.query.frequency)
            ? req.query.frequency : 'Monthly';

        const metrics = await settings.getSettings(pool);
        const { from, to } = data.periodRange({ year, month, frequency });
        const snapshot = await data.getSnapshot(pool, { supplier, from, to });
        const trend = await data.getMonthlyTrend(pool, { supplier, year, throughMonth: month });

        const scores = {};
        for (const m of metrics) scores[m.key] = model.scoreMetric(m, snapshot[m.key]);
        const overall = model.overallRating(metrics, snapshot);

        res.json({
            supplier,
            period: { from, to, frequency, year, month },
            metrics,
            snapshot,
            scores,
            trend,
            rating: overall ? { ...overall, band: model.ratingBand(overall.score) } : null,
        });
    } catch (error) { handle(res, error, 'Failed to build the supplier report'); }
});

module.exports = router;
