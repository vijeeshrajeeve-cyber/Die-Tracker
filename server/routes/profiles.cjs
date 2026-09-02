const express = require('express');
const router = express.Router();
const { pool } = require('../db.cjs');
const { authMiddleware, adminMiddleware } = require('./auth.cjs');

const normalizeProfile = (raw) => {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).trim().split('-')[0].replace(/^0+/, '');
    return cleaned || null;
};

// GET /api/profiles  → metadata (count + last imported timestamp)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*)::int AS count, MAX(updated_at) AS last_imported FROM profiles'
        );
        res.json(result.rows[0] || { count: 0, last_imported: null });
    } catch (error) {
        console.error('Error fetching profiles meta:', error);
        res.status(500).json({ error: 'Failed to fetch profiles' });
    }
});

// GET /api/profiles/lookup?profile=...   or   /api/profiles/lookup?die=...
router.get('/lookup', authMiddleware, async (req, res) => {
    try {
        const profile = normalizeProfile(req.query.profile || req.query.die);
        if (!profile) return res.status(400).json({ error: 'profile or die query param required' });

        const result = await pool.query(
            'SELECT profile_number, customer_name FROM profiles WHERE profile_number = $1 LIMIT 1',
            [profile]
        );
        if (result.rows.length > 0) {
            return res.json({ ...result.rows[0], source: 'profiles' });
        }

        // The profiles master is nearly empty (4 rows against 20,916 profiles
        // in the die list), so fall back to the customer recorded against the
        // plant's own dies before giving up.
        const fromDieList = await pool.query(
            `SELECT customer FROM existing_die_details
             WHERE regexp_replace(profile_number, '^0+', '') = $1
               AND customer IS NOT NULL AND customer <> ''
             ORDER BY updated_at DESC NULLS LAST
             LIMIT 1`,
            [profile]
        );
        if (fromDieList.rows.length > 0) {
            return res.json({
                profile_number: profile,
                customer_name: fromDieList.rows[0].customer,
                source: 'die list',
            });
        }

        return res.status(404).json({ error: 'Profile not found', profile_number: profile });
    } catch (error) {
        console.error('Error looking up profile:', error);
        res.status(500).json({ error: 'Lookup failed' });
    }
});

// POST /api/profiles  body { profile_number | die, customer_name }   (upsert)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const profile = normalizeProfile(req.body.profile_number || req.body.die);
        const customer = (req.body.customer_name || '').trim();
        if (!profile) return res.status(400).json({ error: 'profile_number is required' });
        if (!customer) return res.status(400).json({ error: 'customer_name is required' });

        const result = await pool.query(
            `INSERT INTO profiles (profile_number, customer_name)
             VALUES ($1, $2)
             ON CONFLICT (profile_number) DO UPDATE
               SET customer_name = EXCLUDED.customer_name,
                   updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [profile, customer]
        );
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Error saving profile:', error);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// POST /api/profiles/import   body { rows: [{ profile, customer }] }
router.post('/import', authMiddleware, adminMiddleware, async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows || rows.length === 0) return res.status(400).json({ error: 'rows array is required' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let inserted = 0;
        let updated = 0;
        let skipped = 0;

        for (const row of rows) {
            const profile = normalizeProfile(row.profile_number || row.profile || row.Profile);
            const customer = ((row.customer_name || row.customer || row.Customer) || '').toString().trim();
            if (!profile || !customer) { skipped++; continue; }

            const result = await client.query(
                `INSERT INTO profiles (profile_number, customer_name)
                 VALUES ($1, $2)
                 ON CONFLICT (profile_number) DO UPDATE
                   SET customer_name = EXCLUDED.customer_name,
                       updated_at = CURRENT_TIMESTAMP
                 RETURNING (xmax = 0) AS inserted`,
                [profile, customer]
            );
            if (result.rows[0].inserted) inserted++; else updated++;
        }

        await client.query('COMMIT');
        res.json({ inserted, updated, skipped, total: rows.length });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error importing profiles:', error);
        res.status(500).json({ error: 'Import failed: ' + error.message });
    } finally {
        client.release();
    }
});

// DELETE /api/profiles  — clear all (admin only)
router.delete('/', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE profiles RESTART IDENTITY');
        res.json({ message: 'All profiles cleared' });
    } catch (error) {
        console.error('Error clearing profiles:', error);
        res.status(500).json({ error: 'Failed to clear profiles' });
    }
});

module.exports = router;
