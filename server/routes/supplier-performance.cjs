const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');
const settings = require('../services/supplierPerformanceSettings.cjs');
const model = require('../services/supplierPerformance.cjs');
const data = require('../services/supplierPerformanceData.cjs');
const dieLife = require('../services/supplierDieLife.cjs');
const { generateSupplierReportPdf } = require('../services/supplierReportPdf.cjs');

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
        const year = Number(req.query.year) || new Date().getFullYear();
        res.json(await settings.getSettings(pool, year));
    } catch (error) { handle(res, error, 'Failed to fetch scoring settings'); }
});

router.put('/settings', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const year = Number(req.body && req.body.year) || new Date().getFullYear();
        await settings.saveSettings(pool, year, req.body && req.body.metrics);
        res.json(await settings.getSettings(pool, year));
    } catch (error) { handle(res, error, 'Failed to save scoring settings'); }
});

// Manual monthly die life capture. Readable and writable by any authenticated
// user, not admin-only: this is a routine monthly task, and making one person
// the bottleneck guarantees months get skipped. updated_by is the control.
router.get('/die-life', authMiddleware, async (req, res) => {
    try {
        const year = Number(req.query.year) || new Date().getFullYear();
        const month = Number(req.query.month) || (new Date().getMonth() + 1);
        res.json(await dieLife.listDieLife(pool, { year, month }));
    } catch (error) { handle(res, error, 'Failed to fetch die life data'); }
});

router.put('/die-life', authMiddleware, async (req, res) => {
    try {
        const { year, month, entries } = req.body || {};
        res.json(await dieLife.saveDieLife(pool, { year, month, entries }, req.user && req.user.id));
    } catch (error) { handle(res, error, 'Failed to save die life data'); }
});

// One builder for both the screen and the document. The PDF must never be
// rendered from a client-supplied snapshot: the figures a supplier receives
// come from the database, not from whatever the browser was holding.
async function buildReport({ supplier, year, month, frequency }) {
    // The report's own year, so a sent report keeps the score it was given.
    const metrics = await settings.getSettings(pool, year);
    const { from, to } = data.periodRange({ year, month, frequency });
    const snapshot = await data.getSnapshot(pool, { supplier, from, to });
    const trend = await data.getMonthlyTrend(pool, { supplier, year, throughMonth: month });

    // The month-by-month figures behind the two die life metrics. Sent with
    // the report so the on-screen matrix and the PDF render one source.
    const dieMonths = [];
    for (let i = 1; i <= data.MONTHS.indexOf(month) + 1; i += 1) dieMonths.push(i);
    const dieLifeRows = await dieLife.getDieLifeRows(pool, { supplier, year, months: dieMonths });

    const scores = {};
    for (const m of metrics) scores[m.key] = model.scoreMetric(m, snapshot[m.key]);
    const overall = model.overallRating(metrics, snapshot);

    return {
        supplier,
        period: { from, to, frequency, year, month },
        metrics, snapshot, scores, trend, dieLifeRows,
        rating: overall ? { ...overall, band: model.ratingBand(overall.score) } : null,
    };
}

// Reads the query or body shared by both endpoints.
function readParams(src) {
    const supplier = String(src.supplier || '').trim();
    if (!supplier) throw Object.assign(new Error('A supplier is required'), { status: 400 });
    return {
        supplier,
        year: Number(src.year) || new Date().getFullYear(),
        month: String(src.month || data.MONTHS[new Date().getMonth()]),
        frequency: ['Monthly', 'Quarterly', 'YTD'].includes(src.frequency) ? src.frequency : 'Monthly',
    };
}

// POST rather than GET: comments are free text of unbounded length and have no
// business in a query string.
router.post('/pdf', authMiddleware, async (req, res) => {
    try {
        const params = readParams(req.body || {});
        const report = await buildReport(params);

        // server/assets, not public/. Dockerfile.backend copies only server/,
        // so a path into public/ resolves in dev and silently yields an
        // unbranded PDF in the container -- which is where the real reports are
        // generated. Same home as the QD form template, for the same reason.
        let logoBytes = null;
        try {
            logoBytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
        } catch { logoBytes = null; } // a report without a logo is still a report

        const bytes = await generateSupplierReportPdf(report, {
            comments: String((req.body && req.body.comments) || ''),
            preparedBy: (req.user && req.user.username) || '',
            logoBytes,
        });

        const safe = params.supplier.replace(/[^A-Za-z0-9._-]+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename="Supplier-Performance-${safe}-${params.month}-${params.year}.pdf"`);
        res.send(Buffer.from(bytes));
    } catch (error) { handle(res, error, 'Failed to generate the report PDF'); }
});

router.get('/', authMiddleware, async (req, res) => {
    try {
        res.json(await buildReport(readParams(req.query)));
    } catch (error) { handle(res, error, 'Failed to build the supplier report'); }
});

module.exports = router;
