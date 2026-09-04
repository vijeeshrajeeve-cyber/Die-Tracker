const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const svc = require('../services/sampleTrials.cjs');

const router = express.Router();

const today = () => svc.todayLocal();

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

const idValidation = [param('id').isInt({ min: 1 }).withMessage('Invalid ID')];

const trialValidation = [
    body('trial_date').notEmpty().withMessage('Trial date is required'),
    body('result').isIn(svc.TRIAL_RESULTS).withMessage('Invalid result'),
    body('fail_reason').optional({ nullable: true }),
    body('comments').optional({ nullable: true }).isLength({ max: 2000 }).withMessage('Comment too long'),
];

// Every trial, for the page to group by parent. Sample Followup already fetches
// its standalone rows wholesale; at this volume anything cleverer is not worth
// the complexity.
router.get('/', async (req, res) => {
    try {
        res.json({ sampleTrials: await svc.listTrials(pool) });
    } catch (error) {
        console.error('Get sample trials error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/', trialValidation, handleValidationErrors, async (req, res) => {
    try {
        const out = await svc.createTrial(pool, req.body, req.user.id, today());
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.status(201).json({ trial: out.row, message: 'Trial recorded' });
    } catch (error) {
        console.error('Create sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.put('/:id', idValidation, trialValidation, handleValidationErrors, async (req, res) => {
    try {
        const out = await svc.updateTrial(pool, req.params.id, req.body, today());
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ trial: out.row, message: 'Trial updated' });
    } catch (error) {
        console.error('Update sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin only. A trial is a record of something that happened, so removing one
// should be deliberate — the same reason followup delete is admin-gated.
router.delete('/:id', idValidation, handleValidationErrors, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Only an admin can delete a trial' });
        }
        const gone = await svc.deleteTrial(pool, req.params.id);
        if (!gone) return res.status(404).json({ error: 'Trial not found' });
        res.json({ message: 'Trial deleted' });
    } catch (error) {
        console.error('Delete sample trial error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
