const express = require('express');
const { pool } = require('../db.cjs');
const svc = require('../services/trialPlans.cjs');
const publishing = require('../services/trialPlanPublish.cjs');
const { todayLocal } = require('../services/dates.cjs');

const router = express.Router();

const today = () => todayLocal();
const isAdmin = (req) => req.user.role === 'admin';

// The day is part of the address, so a bad one is refused before any query.
const withDate = (req, res, next) => {
    if (!svc.isPlanDate(req.params.date)) {
        return res.status(400).json({ error: 'Plan date must be a date (YYYY-MM-DD)' });
    }
    next();
};

const withId = (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });
    next();
};

// Every write here touches more than one row -- the plan and its entry, or the
// entry and the die's trial log -- so each runs on one connection inside a
// transaction. A refusal from the service rolls back as well: it may have
// created the day's draft plan before finding the entry was not valid.
const inTransaction = async (work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const out = await work(client);
        await client.query(out.ok ? 'COMMIT' : 'ROLLBACK');
        return out;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

const fail = (res, label) => (error) => {
    console.error(`${label} error:`, error);
    res.status(500).json({ error: 'Internal server error' });
};

// The fixed lists and the day the page should open on, so the page never keeps
// its own copy of either.
router.get('/meta', (req, res) => {
    const day = today();
    res.json({
        today: day,
        defaultPlanDate: svc.defaultPlanDate(day),
        entryTypes: svc.ENTRY_TYPES,
        outcomes: svc.OUTCOMES,
        failReasons: svc.FAIL_REASONS,
        outOfQueueReasons: svc.OUT_OF_QUEUE_REASONS,
        notRunReasons: svc.NOT_RUN_REASONS,
        resultGraceDays: svc.RESULT_GRACE_DAYS,
        plants: svc.PLANTS,
    });
});

router.get('/summary', async (req, res) => {
    try {
        const out = await svc.rangeSummary(pool, req.query.from, req.query.to, req.query.plant);
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ from: out.from, to: out.to, plant: out.plant, summary: out.summary, byDay: out.byDay });
    } catch (error) {
        fail(res, 'Trial plan summary')(error);
    }
});

router.get('/last-alloy/:dieNo', async (req, res) => {
    try {
        res.json({ alloy: await svc.lastAlloy(pool, req.params.dieNo) });
    } catch (error) {
        fail(res, 'Trial plan last alloy')(error);
    }
});

router.put('/entries/:id', withId, async (req, res) => {
    try {
        const out = await inTransaction(client => svc.updateEntry(client, req.params.id, req.body, today()));
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ entry: out.row, message: 'Plan entry updated' });
    } catch (error) {
        fail(res, 'Update trial plan entry')(error);
    }
});

router.delete('/entries/:id', withId, async (req, res) => {
    try {
        const out = await inTransaction(client => svc.removeEntry(client, req.params.id, today()));
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ message: 'Removed from the plan' });
    } catch (error) {
        fail(res, 'Remove trial plan entry')(error);
    }
});

router.put('/entries/:id/outcome', withId, async (req, res) => {
    try {
        const out = await inTransaction(client => svc.recordOutcome(client, req.params.id, req.body, req.user, today()));
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.json({ entry: out.row, carry: out.carry, message: 'Result recorded' });
    } catch (error) {
        fail(res, 'Record trial plan outcome')(error);
    }
});

// Each plant has its own plan for the day, named by ?plant=.
router.get('/:date', withDate, async (req, res) => {
    try {
        const out = await svc.planView(pool, req.params.date, req.query.plant, today(), { isAdmin: isAdmin(req) });
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        const { ok: _ok, ...view } = out;
        res.json(view);
    } catch (error) {
        fail(res, 'Get trial plan')(error);
    }
});

// The printable schedule, for any plan that has been published.
router.get('/:date/pdf', withDate, async (req, res) => {
    try {
        const view = await svc.planView(pool, req.params.date, req.query.plant, today());
        if (!view.ok) return res.status(view.status).json({ error: view.error });
        if (!view.plan || view.plan.status !== 'published' || !view.entries.length) {
            return res.status(404).json({ error: 'This plan has not been published yet' });
        }
        const bytes = await publishing.renderPlanPdf(pool, view);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${publishing.fileName(view)}"`);
        res.send(Buffer.from(bytes));
    } catch (error) {
        fail(res, 'Trial plan PDF')(error);
    }
});

router.post('/:date/entries', withDate, async (req, res) => {
    try {
        const out = await inTransaction(client => svc.addEntry(client, req.params.date, req.query.plant, req.body, req.user.id, today()));
        if (!out.ok) return res.status(out.status).json({ error: out.error });
        res.status(201).json({ entry: out.row, message: 'Added to the plan' });
    } catch (error) {
        fail(res, 'Add trial plan entry')(error);
    }
});

router.post('/:date/publish', withDate, async (req, res) => {
    try {
        const out = await inTransaction(client => svc.publishPlan(client, req.params.date, req.query.plant, req.user.id, today()));
        if (!out.ok) return res.status(out.status).json({ error: out.error });

        // After the commit: the plan is published whatever the mail server says.
        let email;
        try {
            const view = await svc.planView(pool, req.params.date, req.query.plant, today());
            const bytes = await publishing.renderPlanPdf(pool, view);
            email = await publishing.emailPlan(pool, view, bytes, { sentBy: req.user.id });
        } catch (error) {
            console.error('Trial plan publish email error:', error);
            email = { status: 'failed', message: 'The plan is published but the schedule could not be emailed' };
        }
        res.json({ plan: out.plan, entries: out.entries, email, message: 'Plan published' });
    } catch (error) {
        fail(res, 'Publish trial plan')(error);
    }
});

module.exports = router;
