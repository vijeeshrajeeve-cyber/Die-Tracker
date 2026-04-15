require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');

const router = express.Router();

// JWT configuration from environment
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// Validate JWT_SECRET is set
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set!');
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

// Account lockout configuration
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

// Strict rate limiting for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 5, // 5 attempts per window
    message: { error: 'Too many login attempts, please try again after 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts
});

// Input validation rules
const loginValidation = [
    body('username')
        .trim()
        .notEmpty().withMessage('Username is required')
        .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
        .matches(/^[a-zA-Z0-9_]+$/).withMessage('Username can only contain letters, numbers, and underscores'),
    body('password')
        .notEmpty().withMessage('Password is required')
        .isLength({ min: 6, max: 100 }).withMessage('Password must be 6-100 characters'),
];

const changePasswordValidation = [
    body('currentPassword')
        .notEmpty().withMessage('Current password is required'),
    body('newPassword')
        .notEmpty().withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
        .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
        .matches(/[0-9]/).withMessage('Password must contain a number'),
];

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

// Check if account is locked
const checkAccountLock = async (user) => {
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remainingMinutes = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return {
            locked: true,
            message: `Account is locked. Try again in ${remainingMinutes} minute(s)`
        };
    }
    return { locked: false };
};

// Update failed login attempts
const recordFailedAttempt = async (userId) => {
    const result = await pool.query(
        `UPDATE users SET
            failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
                WHEN failed_login_attempts + 1 >= $1
                THEN CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute')
                ELSE locked_until
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING failed_login_attempts`,
        [MAX_FAILED_ATTEMPTS, userId, LOCKOUT_DURATION_MINUTES]
    );
    return result.rows[0]?.failed_login_attempts || 0;
};

// Reset failed attempts on successful login
const resetFailedAttempts = async (userId) => {
    await pool.query(
        'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [userId]
    );
};

// Login with rate limiting and validation
router.post('/login', authLimiter, loginValidation, handleValidationErrors, async (req, res) => {
    try {
        const { username, password } = req.body;

        const result = await pool.query(
            'SELECT id, username, password_hash, role, password_must_change, failed_login_attempts, locked_until, page_access FROM users WHERE username = $1',
            [username]
        );
        const user = result.rows[0];

        if (!user) {
            // Use same response for user not found to prevent enumeration
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check account lock
        const lockStatus = await checkAccountLock(user);
        if (lockStatus.locked) {
            return res.status(423).json({ error: lockStatus.message });
        }

        const validPassword = bcrypt.compareSync(password, user.password_hash);
        if (!validPassword) {
            const attempts = await recordFailedAttempt(user.id);
            const remaining = MAX_FAILED_ATTEMPTS - attempts;

            if (remaining <= 0) {
                return res.status(423).json({
                    error: `Account locked due to too many failed attempts. Try again in ${LOCKOUT_DURATION_MINUTES} minutes`
                });
            }

            return res.status(401).json({
                error: `Invalid credentials. ${remaining} attempt(s) remaining`
            });
        }

        // Reset failed attempts on successful login
        await resetFailedAttempts(user.id);

        const pageAccess = user.page_access ? JSON.parse(user.page_access) : null;

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role,
                passwordMustChange: user.password_must_change,
                pageAccess
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                passwordMustChange: user.password_must_change,
                pageAccess
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Change password endpoint
router.post('/change-password', changePasswordValidation, handleValidationErrors, async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        const { currentPassword, newPassword } = req.body;

        // Get user from database
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Verify current password
        const validPassword = bcrypt.compareSync(currentPassword, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Ensure new password is different from old
        if (bcrypt.compareSync(newPassword, user.password_hash)) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        // Hash new password and update
        const newPasswordHash = bcrypt.hashSync(newPassword, 12);
        await pool.query(
            'UPDATE users SET password_hash = $1, password_must_change = false, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [newPasswordHash, decoded.id]
        );

        // Generate new token without passwordMustChange flag
        const cpPageAccess = user.page_access ? JSON.parse(user.page_access) : null;
        const newToken = jwt.sign(
            {
                id: user.id,
                username: user.username,
                role: user.role,
                passwordMustChange: false,
                pageAccess: cpPageAccess
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            message: 'Password changed successfully',
            token: newToken,
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                passwordMustChange: false,
                pageAccess: cpPageAccess
            }
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get current user
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const result = await pool.query(
            'SELECT id, username, role, password_must_change, page_access, created_at FROM users WHERE id = $1',
            [decoded.id]
        );
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        res.json({
            user: {
                id: user.id,
                username: user.username,
                role: user.role,
                passwordMustChange: user.password_must_change,
                pageAccess: user.page_access ? JSON.parse(user.page_access) : null,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Middleware to verify token
const authMiddleware = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
};

module.exports = { router, authMiddleware, adminMiddleware };
