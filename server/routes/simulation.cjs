'use strict';
// Simulation page: dies in Simulation with their rounds, recording a step,
// and admin undo of the latest step.
const express = require('express');
const { param, validationResult } = require('express-validator');
const { pool } = require('../db.cjs');
const { todayLocal } = require('../services/dates.cjs');
const svc = require('../services/simulation.cjs');

const router = express.Router();

const orderIdValidation = [param('orderId').isInt({ min: 1 }).withMessage('Invalid order ID')];

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: 'Validation failed', details: errors.array().map(e => e.msg) });
    }
    next();
};

// Steps run in a transaction, so they need their own connection.
async function withClient(work) {
    const client = await pool.connect();
    try {
        return await work(client);
    } finally {
        client.release();
    }
}

const send = (res, out) => (out.ok
    ? res.json({ die: out.die, order: out.order })
    : res.status(out.status).json({ error: out.error }));

router.get('/', async (req, res) => {
    try {
        res.json(await svc.listSimulation(pool, todayLocal()));
    } catch (error) {
        console.error('Get simulation error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/:orderId/steps', orderIdValidation, handleValidationErrors, async (req, res) => {
    try {
        const out = await withClient(client =>
            svc.recordStep(client, Number(req.params.orderId), req.body || {}, req.user, todayLocal()));
        send(res, out);
    } catch (error) {
        console.error('Record simulation step error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin only: a step is a record of something that happened, so taking one
// back should be deliberate -- the same reason trial delete is admin-gated.
router.delete('/:orderId/last-step', orderIdValidation, handleValidationErrors, async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can undo a simulation step' });
    try {
        const out = await withClient(client =>
            svc.undoLastStep(client, Number(req.params.orderId), req.user, todayLocal()));
        send(res, out);
    } catch (error) {
        console.error('Undo simulation step error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;
