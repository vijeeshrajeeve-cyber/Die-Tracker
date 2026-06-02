const express = require('express');
const fs = require('fs');
const path = require('path');
const { runBackup, BACKUP_DIR } = require('../services/autoBackup.cjs');

const router = express.Router();

// GET /api/auto-backups — list available backup files
router.get('/', (req, res) => {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return res.json({ backups: [] });
        }
        const backups = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('die_orders_backup_') && f.endsWith('.xlsx'))
            .map(f => {
                const stat = fs.statSync(path.join(BACKUP_DIR, f));
                return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
            })
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ backups });
    } catch (err) {
        console.error('List auto-backups error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auto-backups/download/:filename — download a specific backup
router.get('/download/:filename', (req, res) => {
    const { filename } = req.params;
    // Strict allowlist pattern — no path traversal possible
    if (!/^die_orders_backup_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.xlsx$/.test(filename)) {
        return res.status(400).json({ error: 'Invalid filename' });
    }
    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
        return res.status(404).json({ error: 'Backup not found' });
    }
    res.download(filepath, filename);
});

// POST /api/auto-backups/run — trigger an immediate backup (admin only)
router.post('/run', async (req, res) => {
    try {
        const filename = await runBackup();
        res.json({ message: 'Backup created successfully', filename });
    } catch (err) {
        console.error('Manual backup error:', err);
        res.status(500).json({ error: 'Backup failed', detail: err.message });
    }
});

module.exports = router;
