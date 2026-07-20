require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import database pool and initialization
const { pool, initializeDatabase } = require('./db.cjs');

// Import routes
const { router: authRouter, authMiddleware, adminMiddleware, pageAccessMiddleware } = require('./routes/auth.cjs');
const usersRouter = require('./routes/users.cjs');
const ordersRouter = require('./routes/orders.cjs');
const suppliersRouter = require('./routes/suppliers.cjs');
const plantsRouter = require('./routes/plants.cjs');
const pressesRouter = require('./routes/presses.cjs');
const profilesRouter = require('./routes/profiles.cjs');
const backupRequestsRouter = require('./routes/backup-requests.cjs');
const exportRouter = require('./routes/export.cjs');
const apiKeysRouter = require('./routes/api-keys.cjs');
const emailRouter = require('./routes/email.cjs');
const emailService = require('./services/email.cjs');
const designReminderService = require('./services/designReminder.cjs');
const sampleFollowupsRouter = require('./routes/sample-followups.cjs');
const plantBudgetsRouter = require('./routes/plant-budgets.cjs');
const existingDataRouter = require('./routes/existing-data.cjs');
const autoBackupsRouter = require('./routes/auto-backups.cjs');
const autoBackupService = require('./services/autoBackup.cjs');
const frozenDesignsRouter = require('./routes/frozen-designs.cjs');
const qualityDiscrepanciesRouter = require('./routes/quality-discrepancies.cjs');


const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

// Trust exactly one proxy hop (the Nginx frontend container).
// Lets express-rate-limit key on the real client IP via X-Forwarded-For.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: isProduction ? undefined : false, // Disable CSP in development for hot reload
    crossOriginEmbedderPolicy: false
}));

// General rate limiting
const generalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);

// CORS configuration
app.use(cors({
    origin: isProduction
        ? process.env.ALLOWED_ORIGINS?.split(',') || false
        : true,
    credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Limit payload size

// Public routes
app.use('/api/auth', authRouter);
app.use('/api/export', exportRouter);

// Email routes - webhook is public (auth via secret), other routes check JWT internally
app.use('/api/email', emailRouter);

// Protected routes
app.use('/api/users', authMiddleware, adminMiddleware, usersRouter);
app.use('/api/orders', authMiddleware, pageAccessMiddleware([
    'dashboard',
    'orders',
    'analytics',
    'flow-pending-order',
    'flow-awaiting-design',
    'flow-simulation',
    'flow-design-approval',
    'flow-pending-pr',
    'flow-oracle-entry',
    'flow-design-ems',
    'flow-completed',
    'flow-sample-followup'
]), ordersRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/plants', plantsRouter);
app.use('/api/presses', pressesRouter);
app.use('/api/profiles', profilesRouter);
app.use('/api/backup-requests', authMiddleware, pageAccessMiddleware('backup-requests'), backupRequestsRouter);
app.use('/api/frozen-designs', authMiddleware, pageAccessMiddleware('frozen-designs'), frozenDesignsRouter);
app.use('/api/quality-discrepancies', authMiddleware, pageAccessMiddleware('qd-tracker'), qualityDiscrepanciesRouter);
app.use('/api/api-keys', authMiddleware, adminMiddleware, apiKeysRouter);
app.use('/api/sample-followups', authMiddleware, pageAccessMiddleware('flow-sample-followup'), sampleFollowupsRouter);
app.use('/api/plant-budgets', plantBudgetsRouter);
app.use('/api/existing-data', existingDataRouter);
app.use('/api/auto-backups', authMiddleware, adminMiddleware, autoBackupsRouter);


// Health check
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            status: 'ok',
            database: 'connected',
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (error) {
        console.error('Health check DB error:', error);
        res.status(500).json({ status: 'error', database: 'disconnected' });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        error: isProduction ? 'Internal server error' : err.message
    });
});

// Initialize database and start server
const startServer = async () => {
    try {
        // Validate required environment variables in production.
        if (isProduction) {
            const requiredEnvVars = ['JWT_SECRET', 'PGPASSWORD', 'DEFAULT_ADMIN_PASSWORD'];
            const missing = requiredEnvVars.filter(v => !process.env[v]);
            if (missing.length > 0) {
                throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
            }
            if (process.env.JWT_SECRET.length < 32) {
                throw new Error('JWT_SECRET must be at least 32 characters long in production');
            }
        }

        try {
            await initializeDatabase();
        } catch (dbErr) {
            // 28P01 = password authentication failed. This means the password
            // stored in the postgres_data volume has diverged from .env. Print
            // the real cause and the exact fix instead of a bare stack trace.
            if (dbErr && dbErr.code === '28P01') {
                const db = process.env.PGDATABASE || 'die_ordering';
                console.error([
                    '',
                    '  Database rejected the password (28P01: password authentication failed).',
                    '  The password stored in the postgres_data volume does not match .env.',
                    '  POSTGRES_PASSWORD only applies when the volume is FIRST created; changing',
                    '  it in .env afterwards does not update the running database.',
                    '',
                    '  Fix it (this touches no data — only the login password):',
                    '',
                    `    docker exec -i die-ordering-db psql -U postgres -d ${db} \\`,
                    "      -v pw=\"$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)\" <<'SQL'",
                    "    ALTER USER postgres WITH PASSWORD :'pw';",
                    '    SQL',
                    '',
                    '  Do NOT run "docker compose down -v" — that deletes the database.',
                    '',
                ].join('\n'));
            }
            throw dbErr;
        }

        // Start scheduled Excel backup every 5 hours (configurable via BACKUP_INTERVAL_HOURS)
        autoBackupService.scheduleAutoBackup();

        // Start daily design reminder scheduler (runs when enabled in settings)
        designReminderService.scheduleDesignReminders();

        // Start IMAP poller if receive is enabled in config
        emailService.getEmailConfig().then(config => {
            if (config?.receive_enabled) {
                emailService.startImapPoller();
            }
        }).catch(() => {});

        app.listen(PORT, HOST, () => {
            console.log(`Die Ordering API Server running at http://${HOST}:${PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`Health check: http://localhost:${PORT}/api/health`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();
