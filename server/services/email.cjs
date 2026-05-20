/**
 * Email Service - Direct SMTP/IMAP Integration
 * Handles sending via nodemailer (SMTP) and receiving via ImapFlow (IMAP polling).
 */

const { pool } = require('../db.cjs');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

// ── IMAP polling state ──────────────────────────────────────────────────────
const imapState = {
    lastCheck: null,
    emailsFetched: 0,
    error: null,
    running: false
};

let imapPollInterval = null;

// ── SMTP – send email ───────────────────────────────────────────────────────

async function sendEmail({ to, cc, subject, body, importance = 'normal', orderId = null, sentBy = null }) {
    const config = await getEmailConfig();
    if (!config || !config.send_enabled) {
        throw new Error('SMTP sending is not enabled. Configure it in Email Settings.');
    }
    if (!config.smtp_host || !config.email_user || !config.email_password) {
        throw new Error('SMTP is not fully configured. Please check Email Settings.');
    }

    const transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port || 587,
        secure: (config.smtp_port === 465),
        auth: { user: config.email_user, pass: config.email_password }
    });

    try {
        const info = await transporter.sendMail({
            from: config.mailbox_email || config.email_user,
            to,
            cc: cc || undefined,
            subject,
            html: body,
            priority: importance === 'high' ? 'high' : importance === 'low' ? 'low' : 'normal'
        });

        const logResult = await pool.query(`
            INSERT INTO email_log
                (direction, from_address, to_addresses, cc_addresses, subject,
                 body_preview, body_content, order_id, sent_by, status, importance)
            VALUES ('sent', $1, $2, $3, $4, $5, $6, $7, $8, 'sent', $9)
            RETURNING id
        `, [
            config.mailbox_email || config.email_user,
            JSON.stringify(to.split(',').map(s => s.trim())),
            cc ? JSON.stringify(cc.split(',').map(s => s.trim())) : null,
            subject,
            body.substring(0, 500),
            body,
            orderId,
            sentBy,
            importance
        ]);

        return { success: true, emailLogId: logResult.rows[0].id, messageId: info.messageId };
    } catch (error) {
        await pool.query(`
            INSERT INTO email_log
                (direction, from_address, to_addresses, cc_addresses, subject,
                 body_preview, order_id, sent_by, status, error_message, importance)
            VALUES ('sent', $1, $2, $3, $4, $5, $6, $7, 'failed', $8, $9)
        `, [
            config?.mailbox_email || config?.email_user || 'unknown',
            JSON.stringify(to.split(',').map(s => s.trim())),
            cc ? JSON.stringify(cc.split(',').map(s => s.trim())) : null,
            subject,
            body.substring(0, 500),
            orderId,
            sentBy,
            error.message,
            importance
        ]);
        throw error;
    }
}

// ── SMTP – test connection ──────────────────────────────────────────────────

async function testSmtpConnection(config) {
    const transporter = nodemailer.createTransport({
        host: config.smtp_host,
        port: config.smtp_port || 587,
        secure: (config.smtp_port === 465),
        auth: { user: config.email_user, pass: config.email_password }
    });
    await transporter.verify();
    return { success: true };
}

// ── IMAP – test connection ──────────────────────────────────────────────────

async function testImapConnection(config) {
    const client = new ImapFlow({
        host: config.imap_host,
        port: config.imap_port || 993,
        secure: true,
        auth: { user: config.email_user, pass: config.email_password },
        logger: false
    });
    await client.connect();
    await client.logout();
    return { success: true };
}

// ── IMAP – poll for new emails ──────────────────────────────────────────────

async function pollImap() {
    if (imapState.running) return; // Prevent concurrent polls

    const config = await getEmailConfig();
    if (!config || !config.receive_enabled || !config.imap_host || !config.email_user || !config.email_password) {
        return;
    }

    imapState.running = true;
    const client = new ImapFlow({
        host: config.imap_host,
        port: config.imap_port || 993,
        secure: true,
        auth: { user: config.email_user, pass: config.email_password },
        logger: false
    });

    try {
        await client.connect();
        let fetched = 0;

        const lock = await client.getMailboxLock('INBOX');
        try {
            // Search for unseen messages
            const uids = await client.search({ seen: false }, { uid: true });

            for (const uid of uids) {
                try {
                    const message = await client.fetchOne(String(uid), {
                        envelope: true,
                        source: true
                    }, { uid: true });

                    if (!message) continue;

                    const envelope = message.envelope || {};
                    const messageId = envelope.messageId || null;

                    // Dedup check
                    if (messageId) {
                        const exists = await pool.query(
                            'SELECT id FROM email_log WHERE message_id = $1', [messageId]
                        );
                        if (exists.rows.length > 0) continue;
                    }

                    const fromAddress = envelope.from?.[0]?.address || '';
                    const toAddresses = (envelope.to || []).map(a => a.address).filter(Boolean);
                    const ccAddresses = (envelope.cc || []).map(a => a.address).filter(Boolean);
                    const subject = envelope.subject || '';
                    const receivedAt = envelope.date || new Date();

                    // Extract body preview from raw source
                    let bodyContent = '';
                    if (message.source) {
                        const raw = message.source.toString('utf-8');
                        const bodyStart = raw.indexOf('\r\n\r\n');
                        const rawBody = bodyStart >= 0 ? raw.substring(bodyStart + 4) : '';
                        // Strip MIME headers and HTML tags for a readable preview
                        bodyContent = rawBody
                            .replace(/<[^>]+>/g, ' ')
                            .replace(/=\r\n/g, '')           // quoted-printable line continuations
                            .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
                            .replace(/\s+/g, ' ')
                            .trim()
                            .substring(0, 2000);
                    }

                    // Auto-link to order
                    const orderId = await autoLinkToOrder(subject, bodyContent.substring(0, 500));

                    await pool.query(`
                        INSERT INTO email_log
                            (direction, message_id, from_address, to_addresses, cc_addresses,
                             subject, body_preview, body_content, order_id, status, received_at)
                        VALUES ('received', $1, $2, $3, $4, $5, $6, $7, $8, 'received', $9)
                    `, [
                        messageId,
                        fromAddress,
                        toAddresses.length ? JSON.stringify(toAddresses) : null,
                        ccAddresses.length ? JSON.stringify(ccAddresses) : null,
                        subject,
                        bodyContent.substring(0, 500),
                        bodyContent,
                        orderId,
                        receivedAt
                    ]);

                    fetched++;
                } catch (msgErr) {
                    console.error('IMAP: error processing message uid', uid, msgErr.message);
                }
            }
        } finally {
            lock.release();
        }

        await client.logout();
        imapState.lastCheck = new Date().toISOString();
        imapState.emailsFetched = fetched;
        imapState.error = null;
        if (fetched > 0) console.log(`IMAP poll: fetched ${fetched} new email(s)`);
    } catch (error) {
        imapState.error = error.message;
        console.error('IMAP poll error:', error.message);
        try { await client.logout(); } catch (_) {}
    } finally {
        imapState.running = false;
    }
}

function startImapPoller() {
    if (imapPollInterval) clearInterval(imapPollInterval);
    pollImap(); // Initial poll immediately
    imapPollInterval = setInterval(pollImap, 5 * 60 * 1000); // Every 5 minutes
    console.log('IMAP poller started (interval: 5 min)');
}

function stopImapPoller() {
    if (imapPollInterval) {
        clearInterval(imapPollInterval);
        imapPollInterval = null;
    }
}

function getImapState() {
    return { ...imapState };
}

// ── Config ──────────────────────────────────────────────────────────────────

async function getEmailConfig() {
    const result = await pool.query('SELECT * FROM email_config ORDER BY id LIMIT 1');
    return result.rows.length > 0 ? result.rows[0] : null;
}

async function updateEmailConfig({
    smtp_host, smtp_port, imap_host, imap_port,
    email_user, email_password, mailbox_email,
    send_enabled, receive_enabled
}) {
    const existing = await pool.query('SELECT id FROM email_config ORDER BY id LIMIT 1');

    if (existing.rows.length > 0) {
        await pool.query(`
            UPDATE email_config SET
                smtp_host       = COALESCE($1,  smtp_host),
                smtp_port       = COALESCE($2,  smtp_port),
                imap_host       = COALESCE($3,  imap_host),
                imap_port       = COALESCE($4,  imap_port),
                email_user      = COALESCE($5,  email_user),
                email_password  = COALESCE($6,  email_password),
                mailbox_email   = COALESCE($7,  mailbox_email),
                send_enabled    = COALESCE($8,  send_enabled),
                receive_enabled = COALESCE($9,  receive_enabled),
                updated_at      = CURRENT_TIMESTAMP
            WHERE id = $10
        `, [
            smtp_host, smtp_port, imap_host, imap_port,
            email_user, email_password, mailbox_email,
            send_enabled, receive_enabled, existing.rows[0].id
        ]);
    } else {
        await pool.query(`
            INSERT INTO email_config
                (smtp_host, smtp_port, imap_host, imap_port,
                 email_user, email_password, mailbox_email, send_enabled, receive_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            smtp_host, smtp_port || 587, imap_host, imap_port || 993,
            email_user, email_password, mailbox_email,
            send_enabled ?? false, receive_enabled ?? false
        ]);
    }

    // Restart / stop IMAP poller based on receive_enabled
    if (receive_enabled !== undefined) {
        if (receive_enabled) {
            startImapPoller();
        } else {
            stopImapPoller();
        }
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function autoLinkToOrder(subject, bodyPreview) {
    const combined = `${subject} ${bodyPreview}`;
    const dieNoPattern = /\b(\d{4,6}[_-]\d{1,3}|\d{5,6})\b/g;
    const matches = combined.match(dieNoPattern);
    if (matches) {
        for (const match of matches) {
            const result = await pool.query(
                'SELECT id FROM die_orders WHERE die_no = $1 LIMIT 1', [match]
            );
            if (result.rows.length > 0) return result.rows[0].id;
        }
    }
    return null;
}

async function getEmailLog({ direction, orderId, page = 1, pageSize = 20 }) {
    let query = 'SELECT * FROM email_log WHERE 1=1';
    const params = [];
    let n = 0;

    if (direction) { n++; query += ` AND direction = $${n}`; params.push(direction); }
    if (orderId)   { n++; query += ` AND order_id = $${n}`;  params.push(orderId); }

    const countResult = await pool.query(query.replace('SELECT *', 'SELECT COUNT(*)'), params);
    const total = parseInt(countResult.rows[0].count);

    n++; query += ` ORDER BY created_at DESC LIMIT $${n}`; params.push(pageSize);
    n++; query += ` OFFSET $${n}`; params.push((page - 1) * pageSize);

    const result = await pool.query(query, params);
    return { emails: result.rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

async function getEmailThread(conversationId) {
    const result = await pool.query(
        'SELECT * FROM email_log WHERE conversation_id = $1 ORDER BY created_at ASC',
        [conversationId]
    );
    return result.rows;
}

async function linkEmailToOrder(emailId, orderId) {
    await pool.query('UPDATE email_log SET order_id = $1 WHERE id = $2', [orderId, emailId]);
}

async function getEmailTemplates() {
    const result = await pool.query('SELECT * FROM email_templates ORDER BY category, name');
    return result.rows;
}

async function updateEmailTemplateRecipients(id, { defaultTo = '', defaultCc = '' }) {
    const result = await pool.query(
        `UPDATE email_templates
         SET default_to = $1, default_cc = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [defaultTo, defaultCc, id]
    );
    return result.rows[0] || null;
}

function applyTemplate(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
    }
    return result;
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    sendEmail,
    testSmtpConnection,
    testImapConnection,
    pollImap,
    startImapPoller,
    stopImapPoller,
    getImapState,
    getEmailConfig,
    updateEmailConfig,
    getEmailLog,
    getEmailThread,
    linkEmailToOrder,
    getEmailTemplates,
    updateEmailTemplateRecipients,
    applyTemplate
};
