'use strict';
// Analytics -> Enhancements: the design enhancement summary. Read-only.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { isIsoDate } = require('../services/designEnhancement.cjs');
const { loadEnhancementSummary } = require('../services/enhancementSummary.cjs');
const { generateEnhancementReportPdf } = require('../services/enhancementReportPdf.cjs');

const router = express.Router();
const MAX_YEARS = 10;

// from / to default to the current year; null when the pair is fine, else the message.
function readPeriod(src) {
    const year = todayLocal().slice(0, 4);
    const from = src.from === undefined ? `${year}-01-01` : src.from;
    const to = src.to === undefined ? `${year}-12-31` : src.to;
    if (!isIsoDate(from) || !isIsoDate(to)) return { error: 'from and to must be dates written YYYY-MM-DD' };
    if (from > to) return { error: 'from cannot be after to' };
    if (Number(to.slice(0, 4)) - Number(from.slice(0, 4)) >= MAX_YEARS) {
        return { error: `The period cannot cover more than ${MAX_YEARS} years` };
    }
    return { from, to };
}

router.get('/', async (req, res) => {
    try {
        const period = readPeriod(req.query);
        if (period.error) return res.status(400).json({ error: period.error });
        res.json(await loadEnhancementSummary(pool, period));
    } catch (error) {
        console.error('Get enhancement summary error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// The report is rebuilt here from the validated dates, so what downloads is what
// the database says, built by the same summarise() the tab uses.
router.post('/pdf', async (req, res) => {
    try {
        const period = readPeriod(req.body || {});
        if (period.error) return res.status(400).json({ error: period.error });
        const summary = await loadEnhancementSummary(pool, period);

        // server/assets, not public/: Dockerfile.backend copies only server/.
        let logo = null;
        try {
            logo = fs.readFileSync(path.join(__dirname, '..', 'assets', 'company-logo.png'));
        } catch { logo = null; } // a report without a logo is still a report

        const bytes = await generateEnhancementReportPdf(summary, { ...period, logo });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition',
            `attachment; filename="Enhancement-Report-${period.from}-to-${period.to}.pdf"`);
        res.send(Buffer.from(bytes));
    } catch (error) {
        console.error('Enhancement report PDF error:', error);
        res.status(500).json({ error: 'Failed to generate the enhancement report' });
    }
});

module.exports = router;
