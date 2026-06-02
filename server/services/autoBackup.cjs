const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const MAX_BACKUPS = 30;
const INTERVAL_MS = (parseFloat(process.env.BACKUP_INTERVAL_HOURS) || 5) * 60 * 60 * 1000;

const FIELDS = [
    'plant', 'order_no', 'die_no', 'type', 'die_size', 'die_requested_date',
    'ordered_date', 'shipment_type', 'mandrels_per_cavity', 'total_mandrels',
    'design_received_date', 'three_d_model_received_date', 'simulation_enabled',
    'design_approved_date', 'delay', 'pr_entry', 'pr_number', 'customer_name',
    'oracle_entry', 'supplier', 'status', 'overall_delay', 'eta', 'month',
    'die_received_date', 'submission_date', 'sample_approval_date', 'no_of_trial',
    'corrector', 'press', 'ascona_reference', 'sample_status', 'remark',
    'urgency', 'special_follow_up'
];

const HEADERS = [
    'Plant', 'Order No', 'DIE NO', 'TYPE', 'Die Size', 'Die Requested Date',
    'Ordered Date', 'Type of Shipment', 'Mandrels per Cavity', 'Total Mandrels',
    'Design Received Date', '3D Model Received Date', 'Simulation Enabled',
    'Design Approved Date', 'Delay', 'PR Entry', 'PR Number', 'Customer Name',
    'Oracle Entry', 'Supplier', 'STATUS', 'OVERALL DELAY', 'ETA', 'Month',
    'Die Received Date', 'Submission Date', 'Sample Approval Date', 'No of Trial',
    'Corrector', 'Press', 'Ascona Reference', 'Sample Status', 'Remark',
    'Urgency', 'Special Follow-Up'
];

const pad2 = (n) => String(n).padStart(2, '0');

const formatValue = (val) => {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) {
        if (isNaN(val.getTime())) return '';
        return `${val.getFullYear()}-${pad2(val.getMonth() + 1)}-${pad2(val.getDate())}`;
    }
    if (typeof val === 'string') {
        const m = val.match(/^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/);
        if (m) return m[1];
    }
    return val;
};

const ensureBackupDir = () => {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
};

const pruneOldBackups = () => {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('die_orders_backup_') && f.endsWith('.xlsx'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

    for (const file of files.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(BACKUP_DIR, file.name));
        console.log(`[AutoBackup] Pruned old backup: ${file.name}`);
    }
};

const runBackup = async () => {
    ensureBackupDir();

    const result = await pool.query(
        `SELECT ${FIELDS.join(', ')} FROM die_orders ORDER BY created_at DESC`
    );

    const dataRows = result.rows.map(row => FIELDS.map(f => formatValue(row[f])));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows]);
    ws['!cols'] = HEADERS.map(() => ({ wch: 20 }));
    XLSX.utils.book_append_sheet(wb, ws, 'Die Orders');

    const now = new Date();
    const ts = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
    const filename = `die_orders_backup_${ts}.xlsx`;
    const filepath = path.join(BACKUP_DIR, filename);

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    fs.writeFileSync(filepath, buf);

    pruneOldBackups();
    console.log(`[AutoBackup] ${result.rows.length} orders → ${filename}`);
    return filename;
};

let backupTimer = null;

const scheduleAutoBackup = () => {
    if (backupTimer) return;

    // First backup 1 minute after startup, then on the fixed interval
    const firstRunDelay = 60_000;
    setTimeout(async () => {
        await runBackup().catch(err => console.error('[AutoBackup] Scheduled backup failed:', err));
        backupTimer = setInterval(
            () => runBackup().catch(err => console.error('[AutoBackup] Scheduled backup failed:', err)),
            INTERVAL_MS
        );
    }, firstRunDelay);

    const hours = INTERVAL_MS / 3_600_000;
    console.log(`[AutoBackup] Scheduled every ${hours}h — first run in 1 min. Saving to: ${BACKUP_DIR}`);
};

module.exports = { scheduleAutoBackup, runBackup, BACKUP_DIR };
