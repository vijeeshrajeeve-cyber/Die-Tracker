const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');

const router = express.Router();

// Valid status values
const VALID_STATUSES = [
    'AWAITING FOR DESIGN',
    'PENDING FOR DESIGN APPROVAL',
    'UNDER SIMULATION',
    'PENDING FOR DESIGN TO EMS',
    'PENDING FOR PR',
    'PENDING FOR ORACLE ENTRY',
    'PENDING FOR ORDERING',
    'DONE',
    'CANCELLED',
    'HOLD'
];

// Valid order types
const VALID_TYPES = ['N', 'B', 'T', 'C', 'H'];

// Valid shipment types
const VALID_SHIPMENT_TYPES = ['AIR', 'LAND'];

// Sanitize string input
const sanitizeString = (value) => {
    if (typeof value !== 'string') return value;
    return value.trim().substring(0, 500); // Limit string length
};

// NORMAL | URGENT | TOP_URGENT — accepts "TOP URGENT", "top_urgent", etc.
const normalizeUrgencyInput = (value) => {
    if (value == null || value === '') return 'NORMAL';
    const s = String(value).trim().toUpperCase().replace(/\s+/g, '_');
    if (s === 'TOP_URGENT' || s === 'TOPURGENT') return 'TOP_URGENT';
    if (s === 'URGENT') return 'URGENT';
    return 'NORMAL';
};

const parseSpecialFollowUpInput = (value) => {
    if (value === true || value === 1) return true;
    if (value === false || value === 0 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
        const t = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(t)) return true;
        if (['false', '0', 'no', 'n'].includes(t)) return false;
    }
    return false;
};


// Auto-update matching backup die requests when a die order is created/updated
const autoUpdateBackupRequests = async (dieNo, orderedDate) => {
    if (!dieNo) return;
    try {
        const today = orderedDate || new Date().toISOString().split('T')[0];
        await pool.query(`
            UPDATE backup_die_requests
            SET status = 'Completed', ordered_date = $1, updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(die_no) = LOWER($2) AND status = 'Pending'
        `, [today, dieNo.trim()]);
    } catch (error) {
        console.error('Auto-update backup requests error:', error);
    }
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

// Order validation rules
const orderValidation = [
    body('Plant').optional().customSanitizer(sanitizeString),
    body('Order No').optional().customSanitizer(sanitizeString),
    body('DIE NO').optional().customSanitizer(sanitizeString),
    body('TYPE').optional().customSanitizer(sanitizeString),
    body('Die Size').optional().customSanitizer(sanitizeString),
    body('Die Requested Date').optional().customSanitizer(sanitizeString),
    body('Ordered date').optional().customSanitizer(sanitizeString),
    body('Type of shipment').optional().customSanitizer(sanitizeString),
    body('Mandrels per Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid mandrels per cavity'),
    body('Total Mandrels').optional().isInt({ min: 0, max: 100000 }).withMessage('Invalid total mandrels'),
    body('Design Received Date').optional().customSanitizer(sanitizeString),
    body('3D Model Received Date').optional().customSanitizer(sanitizeString),
    body('simulationEnabled').optional().toBoolean(),
    body('Design Approved Date').optional().customSanitizer(sanitizeString),
    body('Delay').optional().isInt({ min: -10000, max: 10000 }).withMessage('Invalid delay value'),
    body('PR Entry').optional().customSanitizer(sanitizeString),
    body('PR Number').optional().customSanitizer(sanitizeString),
    body('Customer Name').optional().customSanitizer(sanitizeString),
    body('Oracle Entry').optional().customSanitizer(sanitizeString),
    body('Die Received Date').optional().customSanitizer(sanitizeString),
    body('Submission Date').optional().customSanitizer(sanitizeString),
    body('Sample Approval Date').optional().customSanitizer(sanitizeString),
    body('No of Trial').optional().isInt({ min: 0, max: 1000 }).withMessage('Invalid No of Trial'),
    body('Corrector').optional().customSanitizer(sanitizeString),
    body('Supplier').optional().customSanitizer(sanitizeString),
    body('STATUS').optional().customSanitizer(sanitizeString),
    body('OVERALL DELAY').optional().isInt({ min: -10000, max: 10000 }).withMessage('Invalid overall delay'),
    body('ETA').optional().customSanitizer(sanitizeString),
    body('month').optional().customSanitizer(sanitizeString),
    body('Press').optional().customSanitizer(sanitizeString),
    body('Ascona Reference').optional().customSanitizer(sanitizeString),
    body('Sample Status').optional().customSanitizer(sanitizeString),
    body('Remark').optional().customSanitizer(sanitizeString),
    body('Urgency').optional().trim().custom((value) => {
        const n = normalizeUrgencyInput(value);
        if (!['NORMAL', 'URGENT', 'TOP_URGENT'].includes(n)) {
            throw new Error('Invalid urgency');
        }
        return true;
    }),
    body('specialFollowUp').optional().isBoolean(),
    body('Change Log').optional({ nullable: true }).isArray().withMessage('Change Log must be an array'),
];

const orderIdValidation = [
    param('id').isInt({ min: 1 }).withMessage('Invalid order ID')
];

// Get all orders (paginated)
router.get('/', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const [result, countResult] = await Promise.all([
            pool.query('SELECT * FROM die_orders ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
            pool.query('SELECT COUNT(*)::int AS total FROM die_orders'),
        ]);

        const total = countResult.rows[0].total;

        const formattedOrders = result.rows.map(order => ({
            id: order.id,
            'Plant': order.plant,
            'Order No': order.order_no,
            'DIE NO': order.die_no,
            'TYPE': order.type,
            'Die Size': order.die_size,
            'Die Requested Date': order.die_requested_date,
            'Ordered date': order.ordered_date,
            'Type of shipment': order.shipment_type,
            'Mandrels per Cavity': order.mandrels_per_cavity,
            'Total Mandrels': order.total_mandrels,
            'Design Received Date': order.design_received_date,
            '3D Model Received Date': order.three_d_model_received_date,
            'simulationEnabled': !!order.simulation_enabled,
            'Design Approved Date': order.design_approved_date,
            'Delay': order.delay,
            'PR Entry': order.pr_entry,
            'PR Number': order.pr_number,
            'Customer Name': order.customer_name,
            'Oracle Entry': order.oracle_entry,
            'Supplier': order.supplier,
            'STATUS': order.status,
            'OVERALL DELAY': order.overall_delay,
            'ETA': order.eta,
            'month': order.month,
            'Die Received Date': order.die_received_date,
            'Submission Date': order.submission_date,
            'Sample Approval Date': order.sample_approval_date,
            'No of Trial': order.no_of_trial,
            'Corrector': order.corrector,
            'Press': order.press,
            'Cavity': order.cavity,
            'Ascona Reference': order.ascona_reference,
            'Sample Status': order.sample_status,
            'Remark': order.remark,
            'Urgency': order.urgency || 'NORMAL',
            'specialFollowUp': !!order.special_follow_up,
        }));

        res.json({
            orders: formattedOrders,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new order
router.post('/', orderValidation, handleValidationErrors, async (req, res) => {
    try {
        const order = req.body;

        const result = await pool.query(`
            INSERT INTO die_orders (
                plant, order_no, die_no, type, die_size, die_requested_date,
                ordered_date, shipment_type, mandrels_per_cavity, total_mandrels,
                design_received_date, three_d_model_received_date, simulation_enabled,
                design_approved_date, delay, pr_entry, pr_number, customer_name,
                oracle_entry, supplier, status, overall_delay, eta, month,
                die_received_date, submission_date, sample_approval_date, no_of_trial, corrector,
                press, cavity, ascona_reference, sample_status, remark,
                urgency, special_follow_up,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37)
            RETURNING id
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeString(order['Die Requested Date']) || null,
            sanitizeString(order['Ordered date']) || null,
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeString(order['Design Received Date']) || null,
            sanitizeString(order['3D Model Received Date']) || null,
            order['simulationEnabled'] ? 1 : 0,
            sanitizeString(order['Design Approved Date']) || null,
            Math.round(order['Delay'] || 0),
            sanitizeString(order['PR Entry']),
            sanitizeString(order['PR Number']),
            sanitizeString(order['Customer Name']),
            sanitizeString(order['Oracle Entry']),
            sanitizeString(order['Supplier']),
            sanitizeString(order['STATUS']),
            Math.round(order['OVERALL DELAY'] || 0),
            sanitizeString(order['ETA']),
            sanitizeString(order['month']),
            sanitizeString(order['Die Received Date']) || null,
            sanitizeString(order['Submission Date']) || null,
            sanitizeString(order['Sample Approval Date']) || null,
            Math.round(order['No of Trial'] || 0),
            sanitizeString(order['Corrector']),
            sanitizeString(order['Press']),
            Math.round(order['Cavity'] || 0),
            sanitizeString(order['Ascona Reference']),
            sanitizeString(order['Sample Status']),
            sanitizeString(order['Remark']),
            normalizeUrgencyInput(order['Urgency']),
            parseSpecialFollowUpInput(order.specialFollowUp),
            req.user.id
        ]);

        await autoUpdateBackupRequests(order['DIE NO'], order['Ordered date']);

        res.status(201).json({
            id: result.rows[0].id,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update order
router.put('/:id', orderIdValidation, orderValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const order = req.body;

        const result = await pool.query(`
            UPDATE die_orders SET
                plant = $1, order_no = $2, die_no = $3, type = $4, die_size = $5,
                die_requested_date = $6, ordered_date = $7, shipment_type = $8,
                mandrels_per_cavity = $9, total_mandrels = $10, design_received_date = $11,
                three_d_model_received_date = $12, simulation_enabled = $13,
                design_approved_date = $14, delay = $15, pr_entry = $16, pr_number = $17,
                customer_name = $18, oracle_entry = $19, supplier = $20, status = $21,
                overall_delay = $22, eta = $23, month = $24,
                die_received_date = $25, submission_date = $26, sample_approval_date = $27,
                no_of_trial = $28, corrector = $29,
                press = $30, cavity = $31, ascona_reference = $32, sample_status = $33, remark = $34,
                urgency = $35, special_follow_up = $36,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $37
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeString(order['Die Requested Date']) || null,
            sanitizeString(order['Ordered date']) || null,
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeString(order['Design Received Date']) || null,
            sanitizeString(order['3D Model Received Date']) || null,
            order['simulationEnabled'] ? 1 : 0,
            sanitizeString(order['Design Approved Date']) || null,
            Math.round(order['Delay'] || 0),
            sanitizeString(order['PR Entry']),
            sanitizeString(order['PR Number']),
            sanitizeString(order['Customer Name']),
            sanitizeString(order['Oracle Entry']),
            sanitizeString(order['Supplier']),
            sanitizeString(order['STATUS']),
            Math.round(order['OVERALL DELAY'] || 0),
            sanitizeString(order['ETA']),
            sanitizeString(order['month']),
            sanitizeString(order['Die Received Date']) || null,
            sanitizeString(order['Submission Date']) || null,
            sanitizeString(order['Sample Approval Date']) || null,
            Math.round(order['No of Trial'] || 0),
            sanitizeString(order['Corrector']),
            sanitizeString(order['Press']),
            Math.round(order['Cavity'] || 0),
            sanitizeString(order['Ascona Reference']),
            sanitizeString(order['Sample Status']),
            sanitizeString(order['Remark']),
            normalizeUrgencyInput(order['Urgency']),
            parseSpecialFollowUpInput(order.specialFollowUp),
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Insert new change entries into order_changes
        const newEntries = Array.isArray(order['Change Log']) ? order['Change Log'] : [];
        for (const entry of newEntries) {
            if (!entry || !entry.field) continue;
            const changedAt = entry.date ? new Date(entry.date) : new Date();
            await pool.query(
                `INSERT INTO order_changes
                  (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    id,
                    req.user?.id || null,
                    req.user?.username || entry.changedBy || null,
                    isNaN(changedAt) ? new Date() : changedAt,
                    String(entry.field),
                    entry.oldValue != null ? String(entry.oldValue) : null,
                    entry.newValue != null ? String(entry.newValue) : null,
                    entry.reason || null,
                    entry.stage || null,
                ]
            );
        }

        await autoUpdateBackupRequests(order['DIE NO'], order['Ordered date']);

        res.json({ message: 'Order updated successfully' });
    } catch (error) {
        console.error('Update order error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete order
router.delete('/:id', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query('DELETE FROM die_orders WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        console.error('Delete order error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get change log for a specific order
router.get('/:id/change-log', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT oc.id, oc.field_name, oc.old_value, oc.new_value,
                   oc.changed_at, oc.reason, oc.stage,
                   COALESCE(u.username, oc.changed_by_name, 'Unknown') AS changed_by
            FROM order_changes oc
            LEFT JOIN users u ON u.id = oc.user_id
            WHERE oc.order_id = $1
            ORDER BY oc.changed_at DESC
        `, [id]);
        res.json({ changes: result.rows });
    } catch (error) {
        console.error('Get change log error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
