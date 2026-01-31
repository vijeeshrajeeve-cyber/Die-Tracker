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
        .isIn(['admin', 'user']).withMessage('Role must be either "admin" or "user"'),
];

const userIdValidation = [
    param('id')
        .isInt({ min: 1 }).withMessage('Invalid user ID')
];

// Get all users (admin only)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
        );
        res.json({ users: result.rows });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create new user (admin only)
router.post('/', createUserValidation, handleValidationErrors, async (req, res) => {
    try {
        const { username, password, role = 'user' } = req.body;

        // Check for existing user
        const existingResult = await pool.query(
            'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
            [username]
        );
        if (existingResult.rows.length > 0) {
            return res.status(409).json({ error: 'Username already exists' });
        }

        const passwordHash = bcrypt.hashSync(password, 12);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, role, password_must_change) VALUES ($1, $2, $3, $4) RETURNING id',
            [username, passwordHash, role, false]
        );

        res.status(201).json({
            user: {
                id: result.rows[0].id,
                username,
                role
            }
        });
    } catch (error) {
        console.error('Create user error:', error);
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
