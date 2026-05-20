/**
 * Email Routes - Direct SMTP/IMAP Integration
 */

const express = require('express');
const emailService = require('../services/email.cjs');
const { authMiddleware, pageAccessMiddleware } = require('./auth.cjs');

const router = express.Router();
const emailPageAccess = pageAccessMiddleware('email-inbox');

// ── Send email ──────────────────────────────────────────────────────────────

router.post('/send', authMiddleware, emailPageAccess, async (req, res) => {
    try {
        const { to, cc, subject, body: emailBody, importance, orderId } = req.body;
        if (!to || !subject || !emailBody) {
            return res.status(400).json({ error: 'To, subject, and body are required' });
        }

        const result = await emailService.sendEmail({
            to, cc, subject, body: emailBody,
            importance: importance || 'normal',
            orderId: orderId || null,
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
