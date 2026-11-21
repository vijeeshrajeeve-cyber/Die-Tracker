const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const sampleStatusService = require('../services/sampleStatusReport.cjs');
const approvalReportService = require('../services/sampleApprovalReport.cjs');
const { isMonth, previousMonth } = require('../services/sampleApprovalReportData.cjs');

const router = express.Router();

// Sanitize string input
const sanitizeString = (value) => {
    if (typeof value !== 'string') return value;
    return value.trim().substring(0, 500);
};

const sanitizeDate = (value) => {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
    if (iso) return iso[1];
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
};

// Validation error handler
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(e => e.msg)
        });
    }
    next();
};

// Validation rules
const followupValidation = [
    body('profile').optional().customSanitizer(sanitizeString),
    body('plant').optional().customSanitizer(sanitizeString),
    body('press').optional().customSanitizer(sanitizeString),
    body('supplier').optional().customSanitizer(sanitizeString),
    body('customer').optional().customSanitizer(sanitizeString),
    body('die_received_date').optional().customSanitizer(sanitizeString),
    body('ascona_reference').optional().customSanitizer(sanitizeString),
    body('submission_date').optional().customSanitizer(sanitizeString),
    body('sample_approval_date').optional().customSanitizer(sanitizeString),
    body('delay_days').optional().isInt({ min: -10000, max: 10000 }).withMessage('Invalid delay days'),
    body('status').optional().customSanitizer(sanitizeString),
    body('no_of_trial').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid trial count'),
    body('remark').optional().customSanitizer(sanitizeString),
    body('corrector').optional().customSanitizer(sanitizeString),
];

const idValidation = [
    param('id').isInt({ min: 1 }).withMessage('Invalid ID')
];

// Sample Status PDF: rendered on demand, records nothing. Declared before the
// /:id routes so "status-report.pdf" is never read as an id.
router.get('/status-report.pdf', async (req, res) => {
    try {
        const date = req.query.date === undefined || req.query.date === '' ? todayLocal() : String(req.query.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
        }
        const rawPlant = String(req.query.plant || '').trim();
        const plant = !rawPlant || rawPlant === 'All' ? 'All' : rawPlant;
        const { report, bytes } = await sampleStatusService.renderPdfFor({ reportDate: date, plant });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${sampleStatusService.fileName(date, report.plantFilter)}"`);
        res.send(Buffer.from(bytes));
    } catch (error) {
        console.error('Sample status PDF error:', error);
        res.status(500).json({ error: 'Failed to generate the sample status PDF' });
    }
});

// Sample Approval Followup downloads: rendered on demand, record nothing.
// Before the /:id routes so "approval-report.pdf" is never read as an id.
for (const kind of ['pdf', 'xlsx']) {
    router.get(`/approval-report.${kind}`, async (req, res) => {
        try {
            const month = req.query.month === undefined || req.query.month === '' ? previousMonth(todayLocal()) : String(req.query.month);
            if (!isMonth(month)) {
                return res.status(400).json({ error: 'month must be YYYY-MM' });
            }
            const { bytes } = await approvalReportService.renderFor({ month, kind });
            res.setHeader('Content-Type', kind === 'xlsx'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${approvalReportService.fileName(month, kind)}"`);
            res.send(Buffer.from(bytes));
        } catch (error) {
            console.error(`Sample approval ${kind} error:`, error);
            res.status(500).json({ error: `Failed to generate the sample approval ${kind === 'xlsx' ? 'Excel file' : 'PDF'}` });
        }
    });
}

// Get all sample followups
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sample_followups ORDER BY created_at DESC');
        res.json({ sampleFollowups: result.rows });
    } catch (error) {
        console.error('Get sample followups error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create sample followup
router.post('/', followupValidation, handleValidationErrors, async (req, res) => {
    try {
        const data = req.body;
        const result = await pool.query(`
            INSERT INTO sample_followups (
                profile, plant, press, supplier, customer, die_received_date,
                ascona_reference, submission_date, sample_approval_date,
                delay_days, status, no_of_trial, remark, corrector, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            RETURNING id
        `, [
            sanitizeString(data.profile),
            sanitizeString(data.plant),
            sanitizeString(data.press),
            sanitizeString(data.supplier),
            sanitizeString(data.customer),
            sanitizeDate(data.die_received_date),
            sanitizeString(data.ascona_reference || 'No'),
            sanitizeDate(data.submission_date),
            sanitizeDate(data.sample_approval_date),
            Math.round(data.delay_days || 0),
            sanitizeString(data.status || 'Pending'),
            Math.round(data.no_of_trial || 0),
            sanitizeString(data.remark),
            sanitizeString(data.corrector),
            req.user.id
        ]);

        res.status(201).json({
            id: result.rows[0].id,
            message: 'Sample followup created successfully'
        });
    } catch (error) {
        console.error('Create sample followup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update sample followup
router.put('/:id', idValidation, followupValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const result = await pool.query(`
            UPDATE sample_followups SET
                profile = $1, plant = $2, press = $3, supplier = $4, customer = $5,
                die_received_date = $6, ascona_reference = $7, submission_date = $8,
                sample_approval_date = $9, delay_days = $10, status = $11,
                no_of_trial = $12, remark = $13, corrector = $14,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $15
        `, [
            sanitizeString(data.profile),
            sanitizeString(data.plant),
            sanitizeString(data.press),
            sanitizeString(data.supplier),
            sanitizeString(data.customer),
            sanitizeDate(data.die_received_date),
            sanitizeString(data.ascona_reference || 'No'),
            sanitizeDate(data.submission_date),
            sanitizeDate(data.sample_approval_date),
            Math.round(data.delay_days || 0),
            sanitizeString(data.status || 'Pending'),
            Math.round(data.no_of_trial || 0),
            sanitizeString(data.remark),
            sanitizeString(data.corrector),
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Sample followup not found' });
        }

        res.json({ message: 'Sample followup updated successfully' });
    } catch (error) {
        console.error('Update sample followup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete sample followup
router.delete('/:id', idValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM sample_followups WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Sample followup not found' });
        }

        res.json({ message: 'Sample followup deleted successfully' });
    } catch (error) {
        console.error('Delete sample followup error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
