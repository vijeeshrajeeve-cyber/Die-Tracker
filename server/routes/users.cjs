const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');

const router = express.Router();

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
const createUserValidation = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required')
        .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
        .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
        .matches(/[0-9]/).withMessage('Password must contain a number'),
    body('role')
        .optional()
        .isIn(['admin', 'user', 'die_designer', 'simulation_engineer']).withMessage('Role must be "admin", "user", "die_designer", or "simulation_engineer"'),
];

const updateUserValidation = [
    body('username')
        .optional()
        .trim()
        .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
    body('role')
        .optional()
        .isIn(['admin', 'user', 'die_designer', 'simulation_engineer']).withMessage('Role must be "admin", "user", "die_designer", or "simulation_engineer"'),
];

const resetPasswordValidation = [
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
        .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
        .matches(/[0-9]/).withMessage('Password must contain a number'),
];

const userIdValidation = [
    param('id')
        .isInt({ min: 1 }).withMessage('Invalid user ID')
];

// Valid page IDs for validation
const VALID_PAGE_IDS = [
    'dashboard', 'orders', 'backup-requests', 'frozen-designs', 'analytics',
    'process-flow', // backward compat: old users may still have this
    'flow-pending-order', 'flow-awaiting-design', 'flow-simulation',
    'flow-design-approval', 'flow-pending-pr', 'flow-oracle-entry',
    'flow-design-ems', 'flow-completed', 'flow-sample-followup',
    'email-inbox'
];

// Get all users (admin only)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, role, page_access, created_at FROM users ORDER BY created_at DESC'
        );
        res.json({
            users: result.rows.map(u => ({
                ...u,
                page_access: u.page_access ? JSON.parse(u.page_access) : null
            }))
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new user (admin only)
router.post('/', createUserValidation, handleValidationErrors, async (req, res) => {
    try {
        const { username, password, role = 'user', page_access } = req.body;

        // Validate page_access if provided
        if (page_access != null) {
            if (!Array.isArray(page_access) || !page_access.every(p => VALID_PAGE_IDS.includes(p))) {
                return res.status(400).json({ error: 'Invalid page_access. Must be an array of valid page IDs.' });
            }
        }

        // Check for existing user
        const existingResult = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        if (existingResult.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists' });
        }

        // Admins always get full access (null)
        const storedPageAccess = role === 'admin' ? null : (page_access ? JSON.stringify(page_access) : null);

        const passwordHash = bcrypt.hashSync(password, 12);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role, password_must_change, page_access) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, passwordHash, role, true, storedPageAccess]
        );

        res.status(201).json({
            user: {
                id: result.rows[0].id,
                username,
                role,
                page_access: storedPageAccess ? JSON.parse(storedPageAccess) : null
            }
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update page access (admin only)
router.patch('/:id/page-access', userIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const { page_access } = req.body;

        // Validate page_access
        if (page_access != null) {
            if (!Array.isArray(page_access) || !page_access.every(p => VALID_PAGE_IDS.includes(p))) {
                return res.status(400).json({ error: 'Invalid page_access. Must be an array of valid page IDs.' });
            }
        }

        const storedValue = page_access ? JSON.stringify(page_access) : null;
        const result = await pool.query(
            'UPDATE users SET page_access = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, username, role, page_access, created_at',
            [storedValue, parseInt(id, 10)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = result.rows[0];
        res.json({
            user: {
                ...user,
                page_access: user.page_access ? JSON.parse(user.page_access) : null
            }
        });
    } catch (error) {
        console.error('Update page access error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user details (admin only) — username, role, page_access
router.patch('/:id', userIdValidation, updateUserValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id, 10);
        const { username, role, page_access } = req.body;

        if (page_access != null) {
            if (!Array.isArray(page_access) || !page_access.every(p => VALID_PAGE_IDS.includes(p))) {
                return res.status(400).json({ error: 'Invalid page_access. Must be an array of valid page IDs.' });
            }
        }

        const existing = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [userId]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const current = existing.rows[0];

        if (username && username.toLowerCase() !== current.username.toLowerCase()) {
            const dup = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id <> $2', [username, userId]);
            if (dup.rows.length > 0) {
                return res.status(409).json({ error: 'Username already exists' });
            }
        }

        const nextRole = role || current.role;

        // Prevent demoting the last admin
        if (current.role === 'admin' && nextRole !== 'admin') {
            const adminCount = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
            if (parseInt(adminCount.rows[0].count) <= 1) {
                return res.status(400).json({ error: 'Cannot demote the last admin account' });
            }
        }

        // Admins always get full access (null)
        const storedPageAccess = nextRole === 'admin'
            ? null
            : (page_access === undefined ? undefined : (page_access ? JSON.stringify(page_access) : null));

        const fields = [];
        const values = [];
        let idx = 1;
        if (username) { fields.push(`username = $${idx++}`); values.push(username); }
        if (role) { fields.push(`role = $${idx++}`); values.push(role); }
        if (storedPageAccess !== undefined) { fields.push(`page_access = $${idx++}`); values.push(storedPageAccess); }
        // If switching to admin, force page_access null regardless of payload
        if (role === 'admin' && storedPageAccess === undefined) {
            fields.push(`page_access = $${idx++}`); values.push(null);
        }
        fields.push('updated_at = CURRENT_TIMESTAMP');

        if (fields.length === 1) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(userId);
        const result = await pool.query(
            `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, username, role, page_access, created_at`,
            values
        );

        const user = result.rows[0];
        res.json({
            user: {
                ...user,
                page_access: user.page_access ? JSON.parse(user.page_access) : null
            }
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset user password (admin only) — forces password change on next login
router.post('/:id/reset-password', userIdValidation, resetPasswordValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        const userId = parseInt(id, 10);

        const check = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const passwordHash = bcrypt.hashSync(password, 12);
        await pool.query(
            `UPDATE users SET
                password_hash = $1,
                password_must_change = true,
                failed_login_attempts = 0,
                locked_until = NULL,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [passwordHash, userId]
        );

        res.json({ message: 'Password reset successfully. User will be required to change it on next login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete user (admin only)
router.delete('/:id', userIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id, 10);

        // Prevent deleting yourself
        if (userId === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        // Check if user exists
        const checkResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deleting the last admin
        const adminCount = await pool.query(
            "SELECT COUNT(*) as count FROM users WHERE role = 'admin'"
        );
        const targetUser = checkResult.rows[0];
        const isTargetAdmin = (await pool.query('SELECT role FROM users WHERE id = $1', [userId])).rows[0]?.role === 'admin';

        if (isTargetAdmin && parseInt(adminCount.rows[0].count) <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last admin account' });
        }

        const result = await pool.query('DELETE FROM users WHERE id = $1', [userId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
