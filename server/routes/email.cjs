/**
 * Email Routes - Direct SMTP/IMAP Integration
 */

const express = require('express');
const { pool } = require('../db.cjs');
const emailService = require('../services/email.cjs');
const qdDocument = require('../services/qdDocument.cjs');
const designReminderService = require('../services/designReminder.cjs');
const focReminderService = require('../services/focReminder.cjs');
const { authMiddleware, pageAccessMiddleware } = require('./auth.cjs');

const router = express.Router();
const emailPageAccess = pageAccessMiddleware('email-inbox');

// ── Send email ──────────────────────────────────────────────────────────────

router.post('/send', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const { to, cc, subject, body: emailBody, importance, orderId, qdId } = req.body;
        if (!to || !subject || !emailBody) {
            return res.status(400).json({ error: 'To, subject, and body are required' });
        }

        // The caller asks for "the QD form for QD 42", never for a file path —
        // the document is rendered here from the record, so a client cannot use
        // this to attach an arbitrary file from the server.
        let attachments = null;
        if (qdId) {
            const { row, bytes } = await qdDocument.buildQdPdfBytes(pool, qdId);
            attachments = [{
                filename: qdDocument.qdPdfFilename(row),
                content: Buffer.from(bytes),
                contentType: 'application/pdf',
            }];
        }

        const result = await emailService.sendEmail({
            to, cc, subject, body: emailBody,
            importance: importance || 'normal',
            orderId: orderId || null,
            attachments,
            sentBy: req.user.id
        });

        res.json({ message: 'Email sent successfully', emailLogId: result.emailLogId });
    } catch (error) {
        console.error('Send email error:', error);
        res.status(500).json({ error: error.message || 'Failed to send email' });
    }
});

// ── Inbox ───────────────────────────────────────────────────────────────────

router.get('/inbox', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const page     = parseInt(req.query.page)     || 1;
        const pageSize = Math.min(parseInt(req.query.pageSize) || 20, 100);
        const direction = req.query.direction || null;

        const result = await emailService.getEmailLog({ direction, page, pageSize });
        res.json(result);
    } catch (error) {
        console.error('Get inbox error:', error);
        res.status(500).json({ error: 'Failed to fetch emails' });
    }
});

// ── Thread ──────────────────────────────────────────────────────────────────

router.get('/thread/:conversationId', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const emails = await emailService.getEmailThread(req.params.conversationId);
        res.json({ emails });
    } catch (error) {
        console.error('Get thread error:', error);
        res.status(500).json({ error: 'Failed to fetch email thread' });
    }
});

// ── Order emails ─────────────────────────────────────────────────────────────

router.get('/order/:orderId', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const orderId = parseInt(req.params.orderId);
        if (!orderId || orderId < 1) {
            return res.status(400).json({ error: 'Invalid order ID' });
        }
        const result = await emailService.getEmailLog({ orderId, page: 1, pageSize: 100 });
        res.json(result);
    } catch (error) {
        console.error('Get order emails error:', error);
        res.status(500).json({ error: 'Failed to fetch order emails' });
    }
});

// ── Link email to order ───────────────────────────────────────────────────────

router.post('/link', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const { emailId, orderId } = req.body;
        if (!emailId || !orderId) {
            return res.status(400).json({ error: 'Email ID and Order ID are required' });
        }
        await emailService.linkEmailToOrder(emailId, orderId);
        res.json({ message: 'Email linked to order' });
    } catch (error) {
        console.error('Link email error:', error);
        res.status(500).json({ error: 'Failed to link email to order' });
    }
});

// ── Templates ─────────────────────────────────────────────────────────────────

router.get('/templates', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const templates = await emailService.getEmailTemplates();
        res.json({ templates });
    } catch (error) {
        console.error('Get templates error:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

router.put('/templates/:id/recipients', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const id = parseInt(req.params.id, 10);
        if (!id || id < 1) {
            return res.status(400).json({ error: 'Invalid template ID' });
        }

        const defaultTo = typeof req.body.default_to === 'string' ? req.body.default_to.trim().substring(0, 1000) : '';
        const defaultCc = typeof req.body.default_cc === 'string' ? req.body.default_cc.trim().substring(0, 1000) : '';
        const template = await emailService.updateEmailTemplateRecipients(id, { defaultTo, defaultCc });
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        res.json({ template });
    } catch (error) {
        console.error('Update template recipients error:', error);
        res.status(500).json({ error: 'Failed to update template recipients' });
    }
});

// ── Config (admin only) ───────────────────────────────────────────────────────

router.get('/config', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const config = await emailService.getEmailConfig();
        if (config) {
            // Mask password
            config.email_password = config.email_password ? '••••••••' : '';
        }
        res.json({ config: config || {} });
    } catch (error) {
        console.error('Get config error:', error);
        res.status(500).json({ error: 'Failed to fetch email config' });
    }
});

router.put('/config', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const {
            smtp_host, smtp_port, imap_host, imap_port,
            email_user, email_password, mailbox_email,
            send_enabled, receive_enabled
        } = req.body;

        // Don't overwrite password if client sent back the masked placeholder
        const passwordToSave = email_password === '••••••••' ? undefined : email_password;

        await emailService.updateEmailConfig({
            smtp_host, smtp_port, imap_host, imap_port,
            email_user, email_password: passwordToSave, mailbox_email,
            send_enabled, receive_enabled
        });

        res.json({ message: 'Email configuration updated' });
    } catch (error) {
        console.error('Update config error:', error);
        res.status(500).json({ error: 'Failed to update email config' });
    }
});

// ── Design reminder settings (admin only) ─────────────────────────────────────

router.get('/reminder-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const settings = await designReminderService.getReminderSettings();
        res.json({ settings, state: designReminderService.getReminderState() });
    } catch (error) {
        console.error('Get reminder settings error:', error);
        res.status(500).json({ error: 'Failed to fetch reminder settings' });
    }
});

router.put('/reminder-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { enabled, days, time } = req.body;

        if (enabled !== undefined && typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be a boolean' });
        }
        let daysValue;
        if (days !== undefined) {
            daysValue = parseInt(days, 10);
            if (isNaN(daysValue) || daysValue < 1 || daysValue > 60) {
                return res.status(400).json({ error: 'days must be a number between 1 and 60' });
            }
        }
        if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            return res.status(400).json({ error: 'time must be in HH:MM (24-hour) format' });
        }

        const settings = await designReminderService.updateReminderSettings({
            enabled, days: daysValue, time
        });
        res.json({ message: 'Reminder settings updated', settings });
    } catch (error) {
        console.error('Update reminder settings error:', error);
        res.status(500).json({ error: 'Failed to update reminder settings' });
    }
});

// Manually trigger a reminder run (for testing the configuration)
router.post('/reminder-settings/run-now', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const summary = await designReminderService.sendDesignReminders();
        res.json({ message: 'Design reminder run completed', summary });
    } catch (error) {
        console.error('Manual reminder run error:', error);
        res.status(500).json({ error: error.message || 'Failed to run design reminders' });
    }
});

// ── FOC reminder settings (admin only) ────────────────────────────────────────
// Two chasers: one out to suppliers about overdue replacements, one in to our
// own owner about replacements that arrived and have not been trialled.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

router.get('/foc-reminder-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const settings = await focReminderService.getFocSettings();
        res.json({ settings, state: focReminderService.getFocReminderState() });
    } catch (error) {
        console.error('Get FOC reminder settings error:', error);
        res.status(500).json({ error: 'Failed to fetch FOC reminder settings' });
    }
});

router.put('/foc-reminder-settings', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const { supplierEnabled, supplierTime, internalEnabled, internalTime, internalTo, idleDays } = req.body;

        for (const [name, value] of [['supplierEnabled', supplierEnabled], ['internalEnabled', internalEnabled]]) {
            if (value !== undefined && typeof value !== 'boolean') {
                return res.status(400).json({ error: `${name} must be a boolean` });
            }
        }
        for (const [name, value] of [['supplierTime', supplierTime], ['internalTime', internalTime]]) {
            if (value !== undefined && !HHMM.test(value)) {
                return res.status(400).json({ error: `${name} must be in HH:MM (24-hour) format` });
            }
        }
        let idleValue;
        if (idleDays !== undefined) {
            idleValue = parseInt(idleDays, 10);
            if (isNaN(idleValue) || idleValue < 0 || idleValue > 60) {
                return res.status(400).json({ error: 'idleDays must be a number between 0 and 60' });
            }
        }
        // Turning the internal chaser on with nobody to send to would fail
        // silently every morning, so it is refused up front.
        const recipient = internalTo === undefined ? undefined : String(internalTo).trim();
        if (internalEnabled === true && recipient !== undefined && !recipient) {
            return res.status(400).json({ error: 'internalTo is required to enable the internal FOC reminder' });
        }

        const settings = await focReminderService.updateFocSettings({
            supplierEnabled, supplierTime, internalEnabled, internalTime,
            internalTo: recipient, idleDays: idleValue,
        });
        res.json({ message: 'FOC reminder settings updated', settings });
    } catch (error) {
        console.error('Update FOC reminder settings error:', error);
        res.status(500).json({ error: 'Failed to update FOC reminder settings' });
    }
});

// Manually trigger either chaser (for testing the configuration)
router.post('/foc-reminder-settings/run-now', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        const which = String(req.body?.which || 'supplier');
        if (!['supplier', 'internal'].includes(which)) {
            return res.status(400).json({ error: 'which must be "supplier" or "internal"' });
        }
        const summary = which === 'supplier'
            ? await focReminderService.sendSupplierFocReminders()
            : await focReminderService.sendInternalFocReminder();
        res.json({ message: `FOC ${which} reminder run completed`, summary });
    } catch (error) {
        console.error('Manual FOC reminder run error:', error);
        res.status(500).json({ error: error.message || 'Failed to run FOC reminders' });
    }
});

// ── IMAP status ───────────────────────────────────────────────────────────────

router.get('/imap-status', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        res.json({ status: emailService.getImapState() });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get IMAP status' });
    }
});

// ── Trigger IMAP poll manually ─────────────────────────────────────────────────

router.post('/imap-poll', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        // Fire-and-forget (non-blocking)
        emailService.pollImap().catch(e => console.error('Manual IMAP poll error:', e));
        res.json({ message: 'IMAP poll triggered' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to trigger IMAP poll' });
    }
});

// ── Test connection ───────────────────────────────────────────────────────────

router.post('/test-connection', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const type = req.query.type || req.body.type || 'smtp'; // 'smtp' | 'imap'
        const config = await emailService.getEmailConfig();

        if (!config) {
            return res.status(400).json({ error: 'Email is not configured yet' });
        }

        if (type === 'imap') {
            if (!config.imap_host || !config.email_user || !config.email_password) {
                return res.status(400).json({ error: 'IMAP is not fully configured' });
            }
            await emailService.testImapConnection(config);
            res.json({ message: 'IMAP connection successful!' });
        } else {
            if (!config.smtp_host || !config.email_user || !config.email_password) {
                return res.status(400).json({ error: 'SMTP is not fully configured' });
            }
            await emailService.testSmtpConnection(config);
            res.json({ message: 'SMTP connection successful!' });
        }
    } catch (error) {
        console.error('Test connection error:', error);
        res.status(400).json({ error: `Connection failed: ${error.message}` });
    }
});

module.exports = router;
