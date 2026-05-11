const express = require('express');
const crypto = require('crypto');
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

// GET /api/api-keys — list all API keys (without the actual key)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT ak.id, ak.name, ak.last_used_at, ak.created_at, u.username AS created_by
       FROM api_keys ak
       LEFT JOIN users u ON ak.created_by = u.id
       ORDER BY ak.created_at DESC`
        );
        res.json({ keys: result.rows });
    } catch (error) {
        console.error('Get API keys error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/api-keys — generate a new API key
router.post('/',
    body('name').trim().notEmpty().withMessage('Key name is required')
        .isLength({ max: 100 }).withMessage('Key name must be under 100 characters'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { name } = req.body;

            // Generate a secure random API key
            const rawKey = 'doa_' + crypto.randomBytes(32).toString('hex');

            // Hash the key for storage
            const keyHash = bcrypt.hashSync(rawKey, 10);

            const result = await pool.query(
                'INSERT INTO api_keys (key_hash, name, created_by) VALUES ($1, $2, $3) RETURNING id, name, created_at',
                [keyHash, name, req.user.id]
            );

            // Return the raw key ONCE — it cannot be retrieved again
            res.status(201).json({
                key: result.rows[0],
                rawKey,
                message: 'API key created. Copy the key now — it will not be shown again.'
            });
        } catch (error) {
            console.error('Create API key error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

// DELETE /api/api-keys/:id — revoke an API key
router.delete('/:id',
    param('id').isInt({ min: 1 }).withMessage('Invalid key ID'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { id } = req.params;
            const result = await pool.query('DELETE FROM api_keys WHERE id = $1', [id]);

            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'API key not found' });
            }

            res.json({ message: 'API key revoked successfully' });
        } catch (error) {
            console.error('Delete API key error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }
);

module.exports = router;
