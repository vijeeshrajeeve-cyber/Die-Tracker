const { presentOrder } = require('../services/orderPresentation.cjs');
const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const { RECEIVED_FIELDS, planReceivedDate } = require('../services/stageCompletion.cjs');
const { todayLocal } = require('../services/dates.cjs');
const { planEtaChange, insertEtaEvent, DeliveryRuleError } = require('../services/deliveryFollowup.cjs');
const {
    EDITABLE_FIELDS, OrderEditError, planChanges, needsReason, changeNeedsReason,
    displayValue, validateReason, canEditOrderDetails, fromRow, columnValue,
} = require('../services/orderDetailEdits.cjs');
const orderFiles = require('../services/orderFiles.cjs');

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
        const today = orderedDate || todayLocal();
        await pool.query(`
            UPDATE backup_die_requests
            SET status = 'Completed', ordered_date = $1, updated_at = CURRENT_TIMESTAMP
            WHERE LOWER(die_no) = LOWER($2) AND status = 'Pending'
        `, [today, dieNo.trim()]);
    } catch (error) {
        console.error('Auto-update backup requests error:', error);
    }
};

// Reads the stored ETA under a row lock and decides what the incoming one
// means. { plan: null } when the body leaves ETA alone or nothing changes;
// null when the order does not exist. Throws DeliveryRuleError for a move
// without a cause.
async function lockEtaPlan(client, id, body) {
    if (!Object.prototype.hasOwnProperty.call(body, 'ETA')) return { plan: null };
    const { rows } = await client.query('SELECT eta FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) return null;
    return { plan: planEtaChange(rows[0].eta, body['ETA'], body['ETA Change']) };
}

// The client-written change entries both update routes accept.
async function insertChangeLog(db, id, entries, user) {
    for (const entry of Array.isArray(entries) ? entries : []) {
        if (!entry || !entry.field) continue;
        const changedAt = entry.date ? new Date(entry.date) : new Date();
        await db.query(
            `INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
                id,
                user?.id || null,
                user?.username || entry.changedBy || null,
                isNaN(changedAt) ? new Date() : changedAt,
                String(entry.field),
                entry.oldValue != null ? String(entry.oldValue) : null,
                entry.newValue != null ? String(entry.newValue) : null,
                entry.reason || null,
                entry.stage || null,
            ]
        );
    }
}

// Runs one order update in a transaction with its ETA event and change log.
// Resolves to null on success, or to the HTTP answer to send instead, so each
// route keeps its own success message.
async function updateWithEta(id, body, user, runUpdate) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const eta = await lockEtaPlan(client, id, body);
        if (!eta) {
            await client.query('ROLLBACK');
            return { status: 404, json: { error: 'Order not found' } };
        }
        const result = await runUpdate(client);
        if (result.rowCount === 0) {
            await client.query('ROLLBACK');
            return { status: 404, json: { error: 'Order not found' } };
        }
        if (eta.plan) await insertEtaEvent(client, id, eta.plan, user);
        await insertChangeLog(client, id, body['Change Log'], user);
        await client.query('COMMIT');
        return null;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof DeliveryRuleError) return { status: 400, json: { error: error.message, code: error.code } };
        throw error;
    } finally {
        client.release();
    }
}

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

// Only admins, and the people an admin switched on, may edit an order's
// values directly. The step-by-step pages use PATCH /:id and stay open.
const requireOrderEditor = (req, res, next) => {
    if (!canEditOrderDetails(req.user)) {
        return res.status(403).json({ error: 'You do not have permission to edit order details', code: 'ORDER_EDIT_FORBIDDEN' });
    }
    next();
};

// Keep the temp dir on the same filesystem as the final storage so moving the
// file into place is an intra-device rename (avoids EXDEV across the Docker volume).
const orderFileUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = orderFiles.getTmpDir();
            fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
        },
    }),
    limits: { fileSize: orderFiles.MAX_FILE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (orderFiles.isAllowedExtension(file.originalname)) return cb(null, true);
        cb(new Error('Attach the file as a PDF'));
    },
});

// Multer surfaces rejections (wrong type, oversize) as errors. These are client
// mistakes, so answer 400 with a message the drawer can show.
const acceptOrderFile = (req, res, next) => {
    orderFileUpload.single('file')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? `File too large (max ${Math.round(orderFiles.MAX_FILE_BYTES / 1024 / 1024)} MB)`
            : err.message;
        return res.status(400).json({ error: message });
    });
};

// Answers before multer runs, so a bad slot never reaches the disk.
const knownFileSlot = (req, res, next) => {
    if (!Object.prototype.hasOwnProperty.call(orderFiles.SLOTS, req.params.slot)) {
        return res.status(404).json({ error: 'Unknown attachment' });
    }
    next();
};

async function moveIntoPlace(src, dest) {
    try {
        await fsp.rename(src, dest);
    } catch (e) {
        if (e.code === 'EXDEV') {
            await fsp.copyFile(src, dest);
            await fsp.unlink(src);
        } else {
            throw e;
        }
    }
}

// Absolute path of a stored order file, or null when the stored path points
// outside the storage root.
function orderFilePath(storedPath) {
    const root = path.resolve(orderFiles.getRoot());
    const abs = path.resolve(root, storedPath);
    return orderFiles.isInsideRoot(root, abs) ? abs : null;
}

// The saved row carries no change count, so the client adds `logged` to its own.
const presentSaved = (row) => {
    const order = presentOrder(row);
    delete order.changeCount;
    return order;
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
    body('Sample Remark').optional().customSanitizer(sanitizeString),
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

        const formattedOrders = result.rows.map(presentOrder);

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
                press, cavity, ascona_reference, sample_status, remark, sample_remark,
                urgency, special_follow_up, design_to_ems_date,
                frozen_design_id, frozen_design_action,
                frozen_design_override_reason, frozen_design_override_note,
                created_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43)
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
            sanitizeString(order['Sample Remark']),
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
            'Sample Remark':          { col: 'sample_remark',               fn: sanitizeString },
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
        const refused = await updateWithEta(id, body, req.user, (client) => client.query(
            `UPDATE die_orders SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
        ));
        if (refused) return res.status(refused.status).json(refused.json);

        await autoUpdateBackupRequests(body['DIE NO'], body['Ordered date']);

        res.json({ message: 'Order updated' });
    } catch (error) {
        console.error('Patch order error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Save from the Order Details drawer. Editors only. The server diffs the
// incoming fields against the locked row, asks for a reason when an existing
// value is changed or cleared, and logs every changed field with the old value
// read from the database, never from the client.
router.patch('/:id/details', requireOrderEditor, orderIdValidation, handleValidationErrors, async (req, res) => {
    const { id } = req.params;
    const { fields, etaChange } = req.body || {};
    if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'Nothing to save' });
    }
    let reason;
    try {
        reason = validateReason(req.body.reason);
    } catch (error) {
        return res.status(400).json({ error: error.message, code: error.code });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }
        const stored = rows[0];
        const changes = planChanges(fromRow(stored), fields);
        if (changes.length === 0) {
            await client.query('ROLLBACK');
            return res.json({ order: presentSaved(stored), logged: 0 });
        }
        if (needsReason(changes) && !reason) {
            throw new OrderEditError('Give a reason for changing existing values', 'REASON_REQUIRED',
                changes.filter(changeNeedsReason).map((c) => c.field));
        }
        const eta = changes.find((c) => c.field === 'ETA');
        const etaPlan = eta ? planEtaChange(stored.eta, eta.after, etaChange) : null;

        const sets = changes.map((c, i) => `${EDITABLE_FIELDS[c.field].col} = $${i + 1}`);
        const values = [...changes.map((c) => columnValue(c.field, c.after)), id];
        const updated = await client.query(
            `UPDATE die_orders SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (etaPlan) await insertEtaEvent(client, id, etaPlan, req.user);
        await insertChangeLog(client, id, changes.map((c) => ({
            field: c.field,
            oldValue: displayValue(c.field, c.before),
            newValue: displayValue(c.field, c.after),
            reason,
            stage: stored.status,
        })), req.user);
        await client.query('COMMIT');

        const ordered = changes.find((c) => c.field === 'Ordered date' && c.after);
        if (ordered) await autoUpdateBackupRequests(stored.die_no, ordered.after);

        res.json({ order: presentSaved(updated.rows[0]), logged: changes.length });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error instanceof OrderEditError || error instanceof DeliveryRuleError) {
            return res.status(400).json({ error: error.message, code: error.code, ...(error.fields && { fields: error.fields }) });
        }
        console.error('Save order details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// The drawer's current attachments. Anyone who can open the order may see them.
router.get('/:id/files', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT f.id, f.slot, f.original_name, f.size_bytes, f.uploaded_at, u.username AS uploaded_by
            FROM die_order_files f
            LEFT JOIN users u ON u.id = f.uploaded_by
            WHERE f.order_id = $1 AND f.replaced_at IS NULL
            ORDER BY f.slot
        `, [req.params.id]);
        res.json({ files: result.rows });
    } catch (error) {
        console.error('List order files error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Attach a PDF to one of the drawer's slots (multipart, field "file", optional
// "reason"). Editors only, checked before multer so a refused upload never
// reaches the disk. Replacing a file needs a reason, like changing a value; the
// old file is kept and marked replaced, and the change is logged.
router.post('/:id/files/:slot', requireOrderEditor, orderIdValidation, handleValidationErrors, knownFileSlot, acceptOrderFile, async (req, res) => {
    const { id, slot } = req.params;
    const file = req.file;
    const discardTemp = () => (file ? fsp.unlink(file.path).catch(() => {}) : null);
    if (!file) return res.status(400).json({ error: 'Choose a PDF to upload' });
    let reason;
    try {
        reason = validateReason(req.body?.reason);
    } catch (error) {
        await discardTemp();
        return res.status(400).json({ error: error.message, code: error.code });
    }

    const client = await pool.connect();
    let dest = null;
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT id, die_no, status FROM die_orders WHERE id = $1 FOR UPDATE', [id]);
        if (rows.length === 0) {
            await client.query('ROLLBACK');
            await discardTemp();
            return res.status(404).json({ error: 'Order not found' });
        }
        const order = rows[0];
        const existing = await client.query(
            'SELECT id, original_name FROM die_order_files WHERE order_id = $1 AND slot = $2 AND replaced_at IS NULL FOR UPDATE',
            [id, slot]
        );
        const current = existing.rows[0] || null;
        const entry = orderFiles.planUpload({ slot, current, fileName: file.originalname, reason });

        const root = orderFiles.getRoot();
        dest = orderFiles.buildStoredPath(root, {
            dieNo: order.die_no, orderId: order.id, slot, stamp: Date.now(), fileName: file.originalname,
        });
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await moveIntoPlace(file.path, dest);

        if (current) await client.query('UPDATE die_order_files SET replaced_at = CURRENT_TIMESTAMP WHERE id = $1', [current.id]);
        const inserted = await client.query(
            `INSERT INTO die_order_files (order_id, slot, original_name, stored_path, mime_type, size_bytes, uploaded_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id, slot, original_name, size_bytes, uploaded_at`,
            [id, slot, file.originalname, path.relative(root, dest), file.mimetype, file.size, req.user?.id || null]
        );
        await insertChangeLog(client, id, [{ ...entry, stage: order.status }], req.user);
        await client.query('COMMIT');
        res.status(201).json({ file: { ...inserted.rows[0], uploaded_by: req.user?.username || null } });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        // A refused upload leaves nothing on disk: neither the moved file nor the temp one.
        if (dest) await fsp.unlink(dest).catch(() => {});
        await discardTemp();
        if (error instanceof OrderEditError) {
            return res.status(400).json({ error: error.message, code: error.code, ...(error.fields && { fields: error.fields }) });
        }
        console.error('Upload order file error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

// Download one stored file, only through the order it belongs to.
router.get('/:id/files/:fileId', orderIdValidation, param('fileId').isInt({ min: 1 }).withMessage('Invalid file ID'),
    handleValidationErrors, async (req, res) => {
        try {
            const result = await pool.query(
                'SELECT stored_path, original_name FROM die_order_files WHERE id = $1 AND order_id = $2',
                [req.params.fileId, req.params.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'File not found' });
            const abs = orderFilePath(result.rows[0].stored_path);
            if (!abs) return res.status(400).json({ error: 'Invalid path' });
            if (!fs.existsSync(abs)) return res.status(404).json({ error: 'File missing on disk' });
            res.download(abs, result.rows[0].original_name);
        } catch (error) {
            console.error('Download order file error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

// Update order (full replace — used by Order Detail Modal save)
router.put('/:id', requireOrderEditor, orderIdValidation, orderValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const order = req.body;

        const refused = await updateWithEta(id, order, req.user, (client) => client.query(`
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
                sample_remark = $35,
                urgency = $36, special_follow_up = $37,
                design_to_ems_date = $38,
                frozen_design_id = $39, frozen_design_action = $40,
                frozen_design_override_reason = $41, frozen_design_override_note = $42,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $43
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
            sanitizeString(order['Sample Remark']),
            normalizeUrgencyInput(order['Urgency']),
            parseSpecialFollowUpInput(order.specialFollowUp),
            sanitizeDate(order['Design to EMS Date']),
            order['frozenDesignId'] || null,
            sanitizeString(order['frozenDesignAction']),
            sanitizeString(order['frozenDesignOverrideReason']),
            sanitizeString(order['frozenDesignOverrideNote']),
            id,
        ]));
        if (refused) return res.status(refused.status).json(refused.json);

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

        const files = await pool.query('SELECT stored_path FROM die_order_files WHERE order_id = $1', [id]);
        const result = await pool.query('DELETE FROM die_orders WHERE id = $1', [id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // The file rows went with the order (ON DELETE CASCADE); their files go
        // only now the rows are gone for good.
        for (const { stored_path: storedPath } of files.rows) {
            const abs = orderFilePath(storedPath);
            if (abs) await fsp.unlink(abs).catch(() => {});
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
                   r.notes, r.revision_date, r.revision_pdf,
                   r.design_received_date, r.model_received_date, r.created_at,
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
        const revDate = revisionDate || todayLocal();

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

// Complete a design/simulation stage: advances status and records the received
// date. Preserves the first received date on the order; logs re-receipts (after a
// revision) on the latest open revision row so history is never overwritten.
const completeStageValidation = [
    body('field').isString().custom((v) => {
        if (!RECEIVED_FIELDS[v]) throw new Error('Invalid field');
        return true;
    }),
    body('nextStatus').isString().custom((v) => {
        if (!VALID_STATUSES.includes(v)) throw new Error('Invalid next status');
        return true;
    }),
    body('date').optional({ nullable: true }).customSanitizer(sanitizeString),
];

router.patch('/:id/complete-stage', orderIdValidation, completeStageValidation, handleValidationErrors, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { field, nextStatus } = req.body;
        const date = sanitizeDate(req.body.date) || todayLocal();
        const mapping = RECEIVED_FIELDS[field];

        await client.query('BEGIN');

        const orderRes = await client.query(
            `SELECT status, ${mapping.orderCol} AS existing FROM die_orders WHERE id = $1 FOR UPDATE`,
            [id]
        );
        if (orderRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Order not found' });
        }

        const fromStatus = orderRes.rows[0].status;
        const plan = planReceivedDate({ field, existingValue: orderRes.rows[0].existing });
        let target = 'order';

        if (plan.writeTo === 'order') {
            await client.query(
                `UPDATE die_orders SET ${mapping.orderCol} = $1, status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
                [date, nextStatus, id]
            );
        } else {
            // Record the re-received date on the most recent revision still missing it.
            const revRes = await client.query(
                `UPDATE order_revisions SET ${mapping.revisionCol} = $1
                 WHERE id = (
                   SELECT id FROM order_revisions
                   WHERE order_id = $2 AND ${mapping.revisionCol} IS NULL
                   ORDER BY revision_number DESC LIMIT 1
                 )`,
                [date, id]
            );
            if (revRes.rowCount === 0) {
                // Defensive fallback: no open revision row → keep the date on the order.
                await client.query(
                    `UPDATE die_orders SET ${mapping.orderCol} = $1 WHERE id = $2`,
                    [date, id]
                );
            } else {
                target = 'revision';
            }
            await client.query(
                `UPDATE die_orders SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
                [nextStatus, id]
            );
        }

        // Audit entry in the change log.
        await client.query(`
            INSERT INTO order_changes
              (order_id, user_id, changed_by_name, changed_at, field_name, old_value, new_value, reason, stage)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            id,
            req.user?.id || null,
            req.user?.username || null,
            new Date(),
            'STATUS',
            fromStatus,
            nextStatus,
            null,
            fromStatus,
        ]);

        await client.query('COMMIT');
        res.json({ message: 'Stage completed', target, status: nextStatus, date });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Complete stage error:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
