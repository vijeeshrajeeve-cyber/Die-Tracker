// API Service for Die Ordering System
// Uses a relative /api path in both dev (via Vite proxy in vite.config.js)
// and production (via the Nginx reverse proxy). Override with VITE_API_URL
// only if hosting the backend on a different origin.
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Get token from localStorage
const getToken = () => localStorage.getItem('token');

// Set token in localStorage
export const setToken = (token) => {
    if (token) {
        localStorage.setItem('token', token);
    } else {
        localStorage.removeItem('token');
    }
};

// Get user from localStorage
export const getUser = () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
};

// Set user in localStorage
export const setUser = (user) => {
    if (user) {
        localStorage.setItem('user', JSON.stringify(user));
    } else {
        localStorage.removeItem('user');
    }
};

// Logout - clear token and user
export const logout = () => {
    setToken(null);
    setUser(null);
};

// Check if logged in
export const isLoggedIn = () => !!getToken();

// API request helper
const apiRequest = async (endpoint, options = {}) => {
    const token = getToken();
    const { isMultipart, ...fetchOptions } = options;
    const headers = {
        // For multipart uploads let the browser set Content-Type (with boundary).
        ...(isMultipart ? {} : { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...fetchOptions,
        headers,
    });

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 401) {
            logout();
            window.location.reload();
        }
        throw new Error(data.detail || data.error || 'API request failed');
    }

    return data;
};

// Auth API
export const authAPI = {
    login: async (username, password) => {
        const data = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        setToken(data.token);
        setUser(data.user);
        return data;
    },

    me: async () => {
        return apiRequest('/auth/me');
    },

    changePassword: async (currentPassword, newPassword) => {
        const data = await apiRequest('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword }),
        });
        // Update token and user after password change
        if (data.token) {
            setToken(data.token);
        }
        if (data.user) {
            setUser(data.user);
        }
        return data;
    },
};

// Users API (admin only)
export const usersAPI = {
    getAll: async () => {
        return apiRequest('/users');
    },

    create: async (username, password, role = 'user', pageAccess = null) => {
        return apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role, page_access: pageAccess }),
        });
    },

    delete: async (id) => {
        return apiRequest(`/users/${id}`, {
            method: 'DELETE',
        });
    },

    updatePageAccess: async (id, pageAccess) => {
        return apiRequest(`/users/${id}/page-access`, {
            method: 'PATCH',
            body: JSON.stringify({ page_access: pageAccess }),
        });
    },

    update: async (id, { username, role, pageAccess } = {}) => {
        const body = {};
        if (username !== undefined) body.username = username;
        if (role !== undefined) body.role = role;
        if (pageAccess !== undefined) body.page_access = pageAccess;
        return apiRequest(`/users/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        });
    },

    resetPassword: async (id, password) => {
        return apiRequest(`/users/${id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ password }),
        });
    },
};

// Orders API
export const ordersAPI = {
    // Load all orders (high limit) — used by dashboard, analytics, flow pages
    getAll: async ({ page = 1, limit = 5000 } = {}) => {
        return apiRequest(`/orders?page=${page}&limit=${limit}`);
    },

    // Load a single page — used by OrdersPage
    getPage: async (page = 1, limit = 50) => {
        return apiRequest(`/orders?page=${page}&limit=${limit}`);
    },

    getChangeLog: async (orderId) => {
        return apiRequest(`/orders/${orderId}/change-log`);
    },

    // Global change log across all orders (admin Settings view)
    getAllChangeLogs: async ({ limit = 1000 } = {}) => {
        return apiRequest(`/orders/change-log/all?limit=${limit}`);
    },

    // Revision history for a single order
    getRevisions: async (orderId) => {
        return apiRequest(`/orders/${orderId}/revisions`);
    },

    // Record a new revision (increments the counter on the order + stores history)
    createRevision: async (orderId, { targetStatus, notes, revisionDate, revisionPdf } = {}) => {
        return apiRequest(`/orders/${orderId}/revisions`, {
            method: 'POST',
            body: JSON.stringify({ targetStatus, notes, revisionDate, revisionPdf }),
        });
    },

    // Complete a design/simulation stage. Preserves the first received date on the
    // order and records re-receipts (after a revision) on the latest revision row.
    completeStage: async (id, { field, date, nextStatus } = {}) => {
        return apiRequest(`/orders/${id}/complete-stage`, {
            method: 'PATCH',
            body: JSON.stringify({ field, date, nextStatus }),
        });
    },

    create: async (order) => {
        return apiRequest('/orders', {
            method: 'POST',
            body: JSON.stringify(order),
        });
    },

    update: async (id, order) => {
        return apiRequest(`/orders/${id}`, {
            method: 'PUT',
            body: JSON.stringify(order),
        });
    },

    // Partial update — only sends the fields you want to change.
    // Safe to call without the full order object; unspecified fields are left unchanged.
    patch: async (id, fields) => {
        return apiRequest(`/orders/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(fields),
        });
    },

    delete: async (id) => {
        return apiRequest(`/orders/${id}`, {
            method: 'DELETE',
        });
    },
};
// Suppliers API
export const suppliersAPI = {
    getAll: async () => {
        return apiRequest('/suppliers');
    },

    create: async (name, shipment_mode = 'LAND', region = null, contact_email = null) => {
        return apiRequest('/suppliers', {
            method: 'POST',
            body: JSON.stringify({ name, shipment_mode, region, contact_email }),
        });
    },

    update: async (id, data) => {
        return apiRequest(`/suppliers/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id) => {
        return apiRequest(`/suppliers/${id}`, {
            method: 'DELETE',
        });
    },
};

// Presses API
export const pressesAPI = {
    getAll: async () => apiRequest('/presses'),
};

// Plants API
export const plantsAPI = {
    getAll: async () => {
        return apiRequest('/plants');
    },

    create: async (name) => {
        return apiRequest('/plants', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    },

    delete: async (id) => {
        return apiRequest(`/plants/${id}`, {
            method: 'DELETE',
        });
    },
};

// Helper: extract profile number from a die_no — part before "-", leading zeros stripped
export const extractProfileFromDie = (dieNo) => {
    if (dieNo === null || dieNo === undefined) return null;
    const cleaned = String(dieNo).trim().split('-')[0].replace(/^0+/, '');
    return cleaned || null;
};

// Profiles API (Profile master)
export const profilesAPI = {
    getMeta: async () => {
        return apiRequest('/profiles');
    },

    lookup: async (profileOrDie) => {
        const profile = extractProfileFromDie(profileOrDie);
        if (!profile) return null;
        try {
            return await apiRequest(`/profiles/lookup?profile=${encodeURIComponent(profile)}`);
        } catch (err) {
            if (/not found/i.test(err.message)) return null;
            throw err;
        }
    },

    save: async (profileOrDie, customer_name) => {
        const profile = extractProfileFromDie(profileOrDie);
        return apiRequest('/profiles', {
            method: 'POST',
            body: JSON.stringify({ profile_number: profile, customer_name }),
        });
    },

    importBulk: async (rows) => {
        return apiRequest('/profiles/import', {
            method: 'POST',
            body: JSON.stringify({ rows }),
        });
    },

    clearAll: async () => {
        return apiRequest('/profiles', { method: 'DELETE' });
    },
};

// Existing Data API
export const existingDataAPI = {
    getMeta: async () => {
        return apiRequest('/existing-data/meta');
    },

    importDieDetails: async ({ plant, rows, sourceFile }) => {
        return apiRequest('/existing-data/die-details/import', {
            method: 'POST',
            body: JSON.stringify({ plant, rows, sourceFile }),
        });
    },

    importProduction: async ({ plant, rows, sourceFile }) => {
        return apiRequest('/existing-data/production/import', {
            method: 'POST',
            body: JSON.stringify({ plant, rows, sourceFile }),
        });
    },
};

// Convert a base64 string to a Blob (used for J-file and order PDF download)
const base64ToBlob = (b64, mimeType) => {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
};

// Backup Requests API
export const backupRequestsAPI = {
    getAll: async () => {
        return apiRequest('/backup-requests');
    },

    create: async (request) => {
        return apiRequest('/backup-requests', {
            method: 'POST',
            body: JSON.stringify(request),
        });
    },

    update: async (id, request) => {
        return apiRequest(`/backup-requests/${id}`, {
            method: 'PUT',
            body: JSON.stringify(request),
        });
    },

    delete: async (id) => {
        return apiRequest(`/backup-requests/${id}`, {
            method: 'DELETE',
        });
    },

    // Send a profile-drawing PDF + filled-in template values to the backend.
    // Returns { orderPdfBlob, jFilePdfBlob, jFileName, jFileError } where
    // jFilePdfBlob is null and jFileError is set if J-file generation failed.
    generateOrderPdf: async (id, pdfFileOrBlob, values) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/backup-requests/${id}/generate-order-pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/pdf',
                'X-Form-Values': encodeURIComponent(JSON.stringify(values || {})),
                ...(token && { Authorization: `Bearer ${token}` }),
            },
            body: pdfFileOrBlob,
        });
        if (!response.ok) {
            if (response.status === 401) {
                logout();
                window.location.reload();
            }
            let errMsg = `PDF generation failed (HTTP ${response.status})`;
            try {
                const j = await response.json();
                if (j?.error) errMsg = j.error;
                if (j?.detail) errMsg += `: ${j.detail}`;
            } catch (_) { /* response wasn't JSON */ }
            throw new Error(errMsg);
        }
        const data = await response.json();
        return {
            orderPdfBlob: base64ToBlob(data.orderPdf, 'application/pdf'),
            jFilePdfBlob: data.jFilePdf ? base64ToBlob(data.jFilePdf, 'application/pdf') : null,
            jFileName: data.jFileName,
            jFileError: data.jFileError,
            frozenMerged: data.frozenMerged || 0,
        };
    },
};

// API Keys API (admin only)
export const apiKeysAPI = {
    getAll: async () => {
        return apiRequest('/api-keys');
    },

    create: async (name) => {
        return apiRequest('/api-keys', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    },

    delete: async (id) => {
        return apiRequest(`/api-keys/${id}`, {
            method: 'DELETE',
        });
    },
};

// Email API
export const emailAPI = {
    sendEmail: async ({ to, cc, subject, body, importance, orderId }) => {
        return apiRequest('/email/send', {
            method: 'POST',
            body: JSON.stringify({ to, cc, subject, body, importance, orderId }),
        });
    },

    getInbox: async (page = 1, pageSize = 20, direction = null) => {
        const params = new URLSearchParams({ page, pageSize });
        if (direction) params.append('direction', direction);
        return apiRequest(`/email/inbox?${params}`);
    },

    getThread: async (conversationId) => {
        return apiRequest(`/email/thread/${conversationId}`);
    },

    getOrderEmails: async (orderId) => {
        return apiRequest(`/email/order/${orderId}`);
    },

    linkToOrder: async (emailId, orderId) => {
        return apiRequest('/email/link', {
            method: 'POST',
            body: JSON.stringify({ emailId, orderId }),
        });
    },

    getTemplates: async () => {
        return apiRequest('/email/templates');
    },

    updateTemplateRecipients: async (id, { default_to, default_cc }) => {
        return apiRequest(`/email/templates/${id}/recipients`, {
            method: 'PUT',
            body: JSON.stringify({ default_to, default_cc }),
        });
    },

    getConfig: async () => {
        return apiRequest('/email/config');
    },

    updateConfig: async (config) => {
        return apiRequest('/email/config', {
            method: 'PUT',
            body: JSON.stringify(config),
        });
    },

    testConnection: async (type = 'smtp') => {
        return apiRequest(`/email/test-connection?type=${type}`, {
            method: 'POST',
        });
    },

    getImapStatus: async () => {
        return apiRequest('/email/imap-status');
    },

    triggerImapPoll: async () => {
        return apiRequest('/email/imap-poll', { method: 'POST' });
    },

    getReminderSettings: async () => {
        return apiRequest('/email/reminder-settings');
    },

    updateReminderSettings: async ({ enabled, days, time }) => {
        return apiRequest('/email/reminder-settings', {
            method: 'PUT',
            body: JSON.stringify({ enabled, days, time }),
        });
    },

    runDesignRemindersNow: async () => {
        return apiRequest('/email/reminder-settings/run-now', { method: 'POST' });
    },
};

// Sample Followups API
export const sampleFollowupsAPI = {
    getAll: async () => {
        return apiRequest('/sample-followups');
    },

    create: async (data) => {
        return apiRequest('/sample-followups', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    },

    update: async (id, data) => {
        return apiRequest(`/sample-followups/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id) => {
        return apiRequest(`/sample-followups/${id}`, {
            method: 'DELETE',
        });
    },
};

// Auto Backups API (admin only)
export const autoBackupsAPI = {
    getAll: async () => {
        return apiRequest('/auto-backups');
    },

    runNow: async () => {
        return apiRequest('/auto-backups/run', { method: 'POST' });
    },

    download: async (filename) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/auto-backups/download/${encodeURIComponent(filename)}`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    },
};

// Frozen / Final Designs API
export const frozenDesignsAPI = {
    list: async (params = {}) => {
        const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
        const qs = new URLSearchParams(clean).toString();
        return apiRequest(`/frozen-designs${qs ? `?${qs}` : ''}`);
    },
    match: async ({ profile, plant, press, cavity }) => {
        const qs = new URLSearchParams({
            profile: profile ?? '', plant: plant ?? '', press: press ?? '', cavity: cavity ?? '',
        }).toString();
        return apiRequest(`/frozen-designs/match?${qs}`);
    },
    matchBulk: async (keys) => {
        return apiRequest('/frozen-designs/match-bulk', { method: 'POST', body: JSON.stringify({ keys }) });
    },
    create: async (payload) => {
        return apiRequest('/frozen-designs', { method: 'POST', body: JSON.stringify(payload) });
    },
    uploadFiles: async (id, fileList) => {
        const form = new FormData();
        Array.from(fileList).forEach((f) => form.append('files', f));
        return apiRequest(`/frozen-designs/${id}/files`, { method: 'POST', body: form, isMultipart: true });
    },
    downloadFile: async (fileId, filename) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/frozen-designs/files/${fileId}`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'design-file';
        a.click();
        URL.revokeObjectURL(url);
    },
    release: async (id) => {
        return apiRequest(`/frozen-designs/${id}/release`, { method: 'POST' });
    },
};

// Quality Discrepancies (QD Tracker) API
export const qualityDiscrepanciesAPI = {
    // year scopes the rows, KPIs and supplier rollup together; omit for all years.
    // { drafts: true } asks the server to return only the caller's own drafts instead.
    list: async (year, { drafts = false } = {}) => {
        const params = new URLSearchParams();
        if (year && year !== 'All') params.set('year', year);
        if (drafts) params.set('drafts', '1');
        const qs = params.toString();
        return apiRequest(`/quality-discrepancies${qs ? `?${qs}` : ''}`);
    },

    create: async (payload) =>
        apiRequest('/quality-discrepancies', { method: 'POST', body: JSON.stringify(payload) }),

    // Approval workflow: Draft/SentBack --submit--> Pending --approve--> Approved
    // (emails Purchase), or --sendBack--> SentBack (reason required).
    submit: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/submit`, { method: 'POST' }),

    approve: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/approve`, { method: 'POST' }),

    sendBack: async (id, reason) =>
        apiRequest(`/quality-discrepancies/${id}/send-back`, { method: 'POST', body: JSON.stringify({ reason }) }),

    resendPurchase: async (id) =>
        apiRequest(`/quality-discrepancies/${id}/resend-purchase`, { method: 'POST' }),

    getSettings: async () =>
        apiRequest('/quality-discrepancies/settings'),

    saveSettings: async (payload) =>
        apiRequest('/quality-discrepancies/settings', { method: 'PUT', body: JSON.stringify(payload) }),

    // fields: { outcome?, input_at_failure?, eta_date?, corrector? } — '' clears
    update: async (id, fields) =>
        apiRequest(`/quality-discrepancies/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),

    // reason is mandatory; etaDate is mandatory when status is 'FOC Accepted'
    setStatus: async (id, status, reason, etaDate) =>
        apiRequest(`/quality-discrepancies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason, etaDate }) }),

    // kind: 'note' (default) | 'email' | 'reminder' — the server decides the
    // timeline icon/tone from the kind.
    addNote: async (id, note, kind = 'note') =>
        apiRequest(`/quality-discrepancies/${id}/notes`, { method: 'POST', body: JSON.stringify({ note, kind }) }),

    uploadFiles: async (id, fileList) => {
        const form = new FormData();
        Array.from(fileList).forEach((f) => form.append('files', f));
        return apiRequest(`/quality-discrepancies/${id}/files`, { method: 'POST', body: form, isMultipart: true });
    },

    downloadFile: async (fileId, filename) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/quality-discrepancies/files/${fileId}`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'qd-file';
        a.click();
        URL.revokeObjectURL(url);
    },
};

// Plant Budgets API
export const plantBudgetsAPI = {
    getAll: async () => {
        return apiRequest('/plant-budgets');
    },

    save: async (plant_name, year, type, values) => {
        return apiRequest('/plant-budgets', {
            method: 'POST',
            body: JSON.stringify({ plant_name, year, type, values }),
        });
    },

    import: async (rows) => {
        return apiRequest('/plant-budgets/import', {
            method: 'POST',
            body: JSON.stringify({ rows }),
        });
    },
};

