const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const { generateBackupOrderPdf, VALUE_KEYS } = require('../services/dieOrderTemplate.cjs');

const router = express.Router();

const PDF_GEN_MAX_BYTES = 20 * 1024 * 1024;

const VALID_STATUSES = ['Pending', 'Completed', 'HOLD', 'Not required'];

const sanitizeString = (value) => {
    if (typeof value !== 'string') return value;
    return value.trim().substring(0, 500);
};

const sanitizeDate = (value) => {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null;
};

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

const requestValidation = [
    body('Plant').optional().customSanitizer(sanitizeString),
    body('DIE NO').optional().customSanitizer(sanitizeString),
    body('Customer').optional().customSanitizer(sanitizeString),
    body('Press').optional().customSanitizer(sanitizeString),
    body('Requested Date').optional().customSanitizer(sanitizeString),
    body('Die Available').optional().customSanitizer(sanitizeString),
    body('Drawing Requested').optional().customSanitizer(sanitizeString),
    body('Ordered Date').optional().customSanitizer(sanitizeString),
    body('Status').optional().customSanitizer(sanitizeString),
    body('Reason').optional().customSanitizer(sanitizeString),
    body('Order Received Last Year').optional().customSanitizer(sanitizeString),
    body('Remarks').optional().customSanitizer(sanitizeString),
];

const requestIdValidation = [
    param('id').isInt({ min: 1 }).withMessage('Invalid request ID')
];

// Get all backup requests
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM backup_die_requests ORDER BY created_at DESC');

        const formattedRequests = result.rows.map(row => ({
            id: row.id,
            'Plant': row.plant,
            'DIE NO': row.die_no,
            'Customer': row.customer,
            'Press': row.press,
            'Requested Date': row.requested_date,
            'Die Available': row.die_available,
            'Drawing Requested': row.drawing_requested,
            'Ordered Date': row.ordered_date,
            'Status': row.status,
            'Reason': row.reason,
            'Order Received Last Year': row.order_received_last_year,
            'Remarks': row.remarks,
        }));

        res.json({ requests: formattedRequests });
    } catch (error) {
        console.error('Get backup requests error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create backup request
router.post('/', requestValidation, handleValidationErrors, async (req, res) => {
    try {
        const data = req.body;

        const result = await pool.query(`
            INSERT INTO backup_die_requests (
                plant, die_no, customer, press, requested_date,
                die_available, drawing_requested, ordered_date, status,
                reason, order_received_last_year, remarks, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING id
        `, [
            sanitizeString(data['Plant']),
            sanitizeString(data['DIE NO']),
            sanitizeString(data['Customer']),
            sanitizeString(data['Press']),
            sanitizeDate(data['Requested Date']),
            sanitizeDate(data['Die Available']),
            sanitizeDate(data['Drawing Requested']),
            sanitizeDate(data['Ordered Date']),
            'Pending',
            sanitizeString(data['Reason']),
            sanitizeString(data['Order Received Last Year']),
            sanitizeString(data['Remarks']),
            req.user.id
        ]);

        res.status(201).json({
            id: result.rows[0].id,
            message: 'Backup request created successfully'
        });
    } catch (error) {
        console.error('Create backup request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update backup request
router.put('/:id', requestIdValidation, requestValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        const status = sanitizeString(data['Status']);
        if (status && !VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        const result = await pool.query(`
            UPDATE backup_die_requests SET
                plant = $1, die_no = $2, customer = $3, press = $4,
                requested_date = $5, die_available = $6, drawing_requested = $7,
                ordered_date = $8, status = $9, reason = $10,
                order_received_last_year = $11, remarks = $12,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $13
        `, [
            sanitizeString(data['Plant']),
            sanitizeString(data['DIE NO']),
            sanitizeString(data['Customer']),
            sanitizeString(data['Press']),
            sanitizeDate(data['Requested Date']),
            sanitizeDate(data['Die Available']),
            sanitizeDate(data['Drawing Requested']),
            sanitizeDate(data['Ordered Date']),
            status || 'Pending',
            sanitizeString(data['Reason']),
            sanitizeString(data['Order Received Last Year']),
            sanitizeString(data['Remarks']),
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Backup request not found' });
        }

        res.json({ message: 'Backup request updated successfully' });
    } catch (error) {
        console.error('Update backup request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete backup request
router.delete('/:id', requestIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query('DELETE FROM backup_die_requests WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Backup request not found' });
        }

        res.json({ message: 'Backup request deleted successfully' });
    } catch (error) {
        console.error('Delete backup request error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const ALLOWED_VALUE_KEYS = new Set(VALUE_KEYS);

const sanitizeValues = (raw) => {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (!ALLOWED_VALUE_KEYS.has(key)) continue;
        if (typeof value === 'boolean') {
            out[key] = value;
        } else if (value == null) {
            out[key] = '';
        } else {
            out[key] = String(value).slice(0, 200);
        }
    }
    return out;
};

// Generate filled die-order overlay PDF from a backup request.
// Body: raw PDF bytes (application/pdf). Form values arrive as JSON in
// the `X-Form-Values` request header (URL-encoded). Response: the
// resulting PDF as application/pdf.
router.post(
    '/:id/generate-order-pdf',
    requestIdValidation,
    handleValidationErrors,
    express.raw({ type: 'application/pdf', limit: PDF_GEN_MAX_BYTES }),
    async (req, res) => {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ error: 'Expected application/pdf body with the profile drawing' });
        }

        let values = {};
        try {
            const header = req.get('X-Form-Values');
            if (header) {
                values = sanitizeValues(JSON.parse(decodeURIComponent(header)));
            }
        } catch (err) {
            return res.status(400).json({ error: 'Invalid X-Form-Values header (must be URL-encoded JSON)' });
        }

        const { id } = req.params;
        const existsResult = await pool.query('SELECT 1 FROM backup_die_requests WHERE id = $1', [id]);
        if (existsResult.rowCount === 0) {
            return res.status(404).json({ error: 'Backup request not found' });
        }

        try {
            const pdfBuffer = await generateBackupOrderPdf(req.body, values);
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Length', pdfBuffer.length);
            res.setHeader('Content-Disposition', `attachment; filename="backup-die-order-${id}.pdf"`);
            res.send(pdfBuffer);
        } catch (error) {
            console.error('Generate order PDF error:', error);
            res.status(500).json({ error: 'Failed to generate die order PDF', detail: error.message });
        }
    }
);

module.exports = router;
