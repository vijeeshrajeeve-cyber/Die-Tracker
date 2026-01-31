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
    body('Design Approved Date').optional().customSanitizer(sanitizeString),
    body('Delay').optional().isInt({ min: -10000, max: 10000 }).withMessage('Invalid delay value'),
    body('PR Entry').optional().customSanitizer(sanitizeString),
    body('Oracle Entry').optional().customSanitizer(sanitizeString),
    body('Supplier').optional().customSanitizer(sanitizeString),
    body('STATUS').optional().customSanitizer(sanitizeString),
    body('OVERALL DELAY').optional().isInt({ min: -10000, max: 10000 }).withMessage('Invalid overall delay'),
    body('ETA').optional().customSanitizer(sanitizeString),
    body('month').optional().customSanitizer(sanitizeString),
];

const orderIdValidation = [
    param('id').isInt({ min: 1 }).withMessage('Invalid order ID')
];

// Get all orders
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM die_orders ORDER BY created_at DESC');

        // Convert from snake_case to the format frontend expects
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
            'Design Approved Date': order.design_approved_date,
            'Delay': order.delay,
            'PR Entry': order.pr_entry,
            'Oracle Entry': order.oracle_entry,
            'Supplier': order.supplier,
            'STATUS': order.status,
            'OVERALL DELAY': order.overall_delay,
            'ETA': order.eta,
            'month': order.month
        }));

        res.json({ orders: formattedOrders });
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
                design_received_date, design_approved_date, delay, pr_entry,
                oracle_entry, supplier, status, overall_delay, eta, month, created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
            RETURNING id
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeString(order['Die Requested Date']),
            sanitizeString(order['Ordered date']),
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeString(order['Design Received Date']),
            sanitizeString(order['Design Approved Date']),
            Math.round(order['Delay'] || 0),
            sanitizeString(order['PR Entry']),
            sanitizeString(order['Oracle Entry']),
            sanitizeString(order['Supplier']),
            sanitizeString(order['STATUS']),
            Math.round(order['OVERALL DELAY'] || 0),
            sanitizeString(order['ETA']),
            sanitizeString(order['month']),
            req.user.id
        ]);

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
        // Debug logging removed

        const result = await pool.query(`
            UPDATE die_orders SET
                plant = $1, order_no = $2, die_no = $3, type = $4, die_size = $5,
                die_requested_date = $6, ordered_date = $7, shipment_type = $8,
                mandrels_per_cavity = $9, total_mandrels = $10, design_received_date = $11,
                design_approved_date = $12, delay = $13, pr_entry = $14, oracle_entry = $15,
                supplier = $16, status = $17, overall_delay = $18, eta = $19, month = $20,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $21
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeString(order['Die Requested Date']),
            sanitizeString(order['Ordered date']),
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeString(order['Design Received Date']),
            sanitizeString(order['Design Approved Date']),
            Math.round(order['Delay'] || 0),
            sanitizeString(order['PR Entry']),
            sanitizeString(order['Oracle Entry']),
            sanitizeString(order['Supplier']),
            sanitizeString(order['STATUS']),
            Math.round(order['OVERALL DELAY'] || 0),
            sanitizeString(order['ETA']),
            sanitizeString(order['month']),
            id
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

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

module.exports = router;
