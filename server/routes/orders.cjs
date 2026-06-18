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

// Normalise any incoming date string to YYYY-MM-DD for PostgreSQL DATE columns.
// Accepts: YYYY-MM-DD (passthrough), DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY.
const sanitizeDate = (value) => {
    if (!value) return null;
    const s = String(value).trim();
    if (!s) return null;
    // Accept YYYY-MM-DD and ISO 8601 datetimes (e.g. "2026-03-01T00:00:00.000Z")
    // by keeping only the date prefix. This is what the GET endpoint returns when
    // pg gives us DATE columns as JS Date objects that JSON-serialize as ISO.
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
    if (iso) return iso[1];
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return null; // unparseable — store as NULL rather than error
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
    body('Cavity').optional().isInt({ min: 0, max: 10000 }).withMessage('Invalid cavity count'),
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
        const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = (page - 1) * limit;

        const [result, countResult] = await Promise.all([
            pool.query(`
                SELECT o.*, COALESCE(c.change_count, 0)::int AS change_count
                FROM die_orders o
                LEFT JOIN (
                    SELECT order_id, COUNT(*) AS change_count
                    FROM order_changes
                    GROUP BY order_id
                ) c ON c.order_id = o.id
                ORDER BY o.created_at DESC
                LIMIT $1 OFFSET $2
            `, [limit, offset]),
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
            'Design to EMS Date': order.design_to_ems_date,
            'Design Revision Count': order.design_revision_count || 0,
            'Last Revision Date': order.last_revision_date,
            'changeCount': order.change_count || 0,
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
                urgency, special_follow_up, design_to_ems_date,
                frozen_design_id, frozen_design_action,
                frozen_design_override_reason, frozen_design_override_note,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42)
            RETURNING id
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeDate(order['Die Requested Date']),
            sanitizeDate(order['Ordered date']),
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeDate(order['Design Received Date']),
            sanitizeDate(order['3D Model Received Date']),
            order['simulationEnabled'] ? 1 : 0,
            sanitizeDate(order['Design Approved Date']),
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
            sanitizeDate(order['Die Received Date']),
            sanitizeDate(order['Submission Date']),
            sanitizeDate(order['Sample Approval Date']),
            Math.round(order['No of Trial'] || 0),
            sanitizeString(order['Corrector']),
            sanitizeString(order['Press']),
            Math.round(order['Cavity'] || 0),
            sanitizeString(order['Ascona Reference']),
            sanitizeString(order['Sample Status']),
            sanitizeString(order['Remark']),
            normalizeUrgencyInput(order['Urgency']),
            parseSpecialFollowUpInput(order.specialFollowUp),
            sanitizeDate(order['Design to EMS Date']),
            order['frozenDesignId'] || null,
            sanitizeString(order['frozenDesignAction']),
            sanitizeString(order['frozenDesignOverrideReason']),
            sanitizeString(order['frozenDesignOverrideNote']),
            req.user.id
        ]);

        await autoUpdateBackupRequests(order['DIE NO'], order['Ordered date']);

        res.status(201).json({
            id: result.rows[0].id,
            message: 'Order created successfully'
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Internal server error', detail: error.message });
    }
});

// Partial update (PATCH) — only touches the fields explicitly included in the request body.
// Used by workflow step completions and inline field saves so that dates/fields not being
// changed are never overwritten with null from stale client state.
router.patch('/:id', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const body = req.body;

        const FIELD_MAP = {
            'Plant':                  { col: 'plant',                       fn: sanitizeString },
            'Order No':               { col: 'order_no',                    fn: sanitizeString },
            'DIE NO':                 { col: 'die_no',                      fn: sanitizeString },
            'TYPE':                   { col: 'type',                        fn: sanitizeString },
            'Die Size':               { col: 'die_size',                    fn: sanitizeString },
            'Die Requested Date':     { col: 'die_requested_date',          fn: sanitizeDate   },
            'Ordered date':           { col: 'ordered_date',                fn: sanitizeDate   },
            'Type of shipment':       { col: 'shipment_type',               fn: sanitizeString },
            'Mandrels per Cavity':    { col: 'mandrels_per_cavity',         fn: (v) => Math.round(v || 0) },
            'Total Mandrels':         { col: 'total_mandrels',              fn: (v) => Math.round(v || 0) },
            'Cavity':                 { col: 'cavity',                      fn: (v) => Math.round(v || 0) },
            'Design Received Date':   { col: 'design_received_date',        fn: sanitizeDate   },
            '3D Model Received Date': { col: 'three_d_model_received_date', fn: sanitizeDate   },
            'simulationEnabled':      { col: 'simulation_enabled',          fn: (v) => v ? 1 : 0 },
            'Design Approved Date':   { col: 'design_approved_date',        fn: sanitizeDate   },
            'Delay':                  { col: 'delay',                       fn: (v) => Math.round(v || 0) },
            'PR Entry':               { col: 'pr_entry',                    fn: sanitizeString },
            'PR Number':              { col: 'pr_number',                   fn: sanitizeString },
            'Customer Name':          { col: 'customer_name',               fn: sanitizeString },
            'Oracle Entry':           { col: 'oracle_entry',                fn: sanitizeString },
            'Supplier':               { col: 'supplier',                    fn: sanitizeString },
            'STATUS':                 { col: 'status',                      fn: sanitizeString },
            'OVERALL DELAY':          { col: 'overall_delay',               fn: (v) => Math.round(v || 0) },
            'ETA':                    { col: 'eta',                         fn: sanitizeString },
            'month':                  { col: 'month',                       fn: sanitizeString },
            'Die Received Date':      { col: 'die_received_date',           fn: sanitizeDate   },
            'Submission Date':        { col: 'submission_date',             fn: sanitizeDate   },
            'Sample Approval Date':   { col: 'sample_approval_date',        fn: sanitizeDate   },
            'No of Trial':            { col: 'no_of_trial',                 fn: (v) => Math.round(v || 0) },
            'Corrector':              { col: 'corrector',                   fn: sanitizeString },
            'Press':                  { col: 'press',                       fn: sanitizeString },
            'Ascona Reference':       { col: 'ascona_reference',            fn: sanitizeString },
            'Sample Status':          { col: 'sample_status',               fn: sanitizeString },
            'Remark':                 { col: 'remark',                      fn: sanitizeString },
            'Urgency':                { col: 'urgency',                     fn: normalizeUrgencyInput },
            'specialFollowUp':        { col: 'special_follow_up',           fn: parseSpecialFollowUpInput },
            'Design to EMS Date':     { col: 'design_to_ems_date',          fn: sanitizeDate   },
        };

        const setClauses = ['updated_at = CURRENT_TIMESTAMP'];
        const params = [];
        let paramIdx = 1;

        for (const [field, { col, fn }] of Object.entries(FIELD_MAP)) {
            if (Object.prototype.hasOwnProperty.call(body, field)) {
                setClauses.push(`${col} = $${paramIdx++}`);
                params.push(fn(body[field]));
            }
        }

        if (paramIdx === 1) {
            return res.status(400).json({ error: 'No updatable fields provided' });
        }

        params.push(id);
        const result = await pool.query(
            `UPDATE die_orders SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const newEntries = Array.isArray(body['Change Log']) ? body['Change Log'] : [];
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

        await autoUpdateBackupRequests(body['DIE NO'], body['Ordered date']);

        res.json({ message: 'Order updated' });
    } catch (error) {
        console.error('Patch order error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update order (full replace — used by Order Detail Modal save)
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
                design_to_ems_date = $37,
                frozen_design_id = $38, frozen_design_action = $39,
                frozen_design_override_reason = $40, frozen_design_override_note = $41,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $42
        `, [
            sanitizeString(order['Plant']),
            sanitizeString(order['Order No']),
            sanitizeString(order['DIE NO']),
            sanitizeString(order['TYPE']),
            sanitizeString(order['Die Size']),
            sanitizeDate(order['Die Requested Date']),
            sanitizeDate(order['Ordered date']),
            sanitizeString(order['Type of shipment']),
            Math.round(order['Mandrels per Cavity'] || 0),
            Math.round(order['Total Mandrels'] || 0),
            sanitizeDate(order['Design Received Date']),
            sanitizeDate(order['3D Model Received Date']),
            order['simulationEnabled'] ? 1 : 0,
            sanitizeDate(order['Design Approved Date']),
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
            sanitizeDate(order['Die Received Date']),
            sanitizeDate(order['Submission Date']),
            sanitizeDate(order['Sample Approval Date']),
            Math.round(order['No of Trial'] || 0),
            sanitizeString(order['Corrector']),
            sanitizeString(order['Press']),
            Math.round(order['Cavity'] || 0),
            sanitizeString(order['Ascona Reference']),
            sanitizeString(order['Sample Status']),
            sanitizeString(order['Remark']),
            normalizeUrgencyInput(order['Urgency']),
            parseSpecialFollowUpInput(order.specialFollowUp),
            sanitizeDate(order['Design to EMS Date']),
            order['frozenDesignId'] || null,
            sanitizeString(order['frozenDesignAction']),
            sanitizeString(order['frozenDesignOverrideReason']),
            sanitizeString(order['frozenDesignOverrideNote']),
            id,
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

// Get the global change log across all orders (admin change-log view)
router.get('/change-log/all', async (req, res) => {
    try {
        const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit) || 1000));
        const result = await pool.query(`
            SELECT oc.id, oc.field_name, oc.old_value, oc.new_value,
                   oc.changed_at, oc.reason, oc.stage,
                   COALESCE(u.username, oc.changed_by_name, 'Unknown') AS changed_by,
                   o.die_no, o.order_no
            FROM order_changes oc
            LEFT JOIN users u ON u.id = oc.user_id
            LEFT JOIN die_orders o ON o.id = oc.order_id
            ORDER BY oc.changed_at DESC
            LIMIT $1
        `, [limit]);
        res.json({ changes: result.rows });
    } catch (error) {
        console.error('Get global change log error:', error);
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

// Get the revision history for an order
router.get('/:id/revisions', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT r.id, r.revision_number, r.from_status, r.to_status,
                   r.notes, r.revision_date, r.revision_pdf, r.created_at,
                   COALESCE(u.username, r.created_by_name, 'Unknown') AS created_by
            FROM order_revisions r
            LEFT JOIN users u ON u.id = r.created_by
            WHERE r.order_id = $1
            ORDER BY r.revision_number DESC
        `, [id]);
        res.json({ revisions: result.rows });
    } catch (error) {
        console.error('Get revisions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create a new revision for an order (records history + increments counter on the order)
const revisionValidation = [
    body('targetStatus').isString().custom((v) => {
        if (!VALID_STATUSES.includes(v)) throw new Error('Invalid target status');
        return true;
    }),
    body('notes').isString().trim().isLength({ min: 1, max: 2000 }).withMessage('Revision notes are required'),
    body('revisionDate').optional({ nullable: true }).customSanitizer(sanitizeString),
    body('revisionPdf').optional({ nullable: true }).customSanitizer(sanitizeString),
];

router.post('/:id/revisions', orderIdValidation, revisionValidation, handleValidationErrors, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { targetStatus, notes, revisionDate, revisionPdf } = req.body;
        const revDate = revisionDate || new Date().toISOString().split('T')[0];

        await client.query('BEGIN');

        const orderRes = await client.query(
            'SELECT status, design_revision_count FROM die_orders WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (orderRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }

        const fromStatus = orderRes.rows[0].status;
        const newRevisionNumber = (orderRes.rows[0].design_revision_count || 0) + 1;

        const revInsert = await client.query(`
            INSERT INTO order_revisions
              (order_id, revision_number, from_status, to_status, notes, revision_date, revision_pdf, created_by, created_by_name)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING id, created_at
        `, [
            id,
            newRevisionNumber,
            fromStatus,
            targetStatus,
            notes,
            revDate,
            revisionPdf || null,
            req.user?.id || null,
            req.user?.username || null,
        ]);

        await client.query(`
            UPDATE die_orders
            SET status = $1, design_revision_count = $2, last_revision_date = $3, updated_at = CURRENT_TIMESTAMP
            WHERE id = $4
        `, [targetStatus, newRevisionNumber, revDate, id]);

        // Audit entry in the change log
        await client.query(`
            INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            id,
            req.user?.id || null,
            req.user?.username || null,
            new Date(),
            'Revision',
            fromStatus,
            `${targetStatus} (Rev #${newRevisionNumber})`,
            notes,
            fromStatus,
        ]);

        await client.query('COMMIT');

        res.status(201).json({
            id: revInsert.rows[0].id,
            revisionNumber: newRevisionNumber,
            status: targetStatus,
            lastRevisionDate: revDate,
            message: 'Revision recorded successfully',
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Create revision error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
