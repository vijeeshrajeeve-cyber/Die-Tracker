// API Service for Die Ordering System
// Uses a relative /api path in both dev (via Vite proxy in vite.config.js)
// and production (via the Nginx reverse proxy). Override with VITE_API_URL
// only if hosting the backend on a different origin.
// Optional chaining because import.meta.env only exists under Vite — without it
// the module cannot be imported by a plain node test.
const API_BASE_URL = import.meta.env?.VITE_API_URL || '/api';

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

// Not every failure comes from our API. The nginx proxy answers 413/502/504
// with its own HTML page, so there is no { error } to read — this supplies a
// message the user can act on instead of a JSON parse error.
const nonApiErrorMessage = (status) => {
    if (status === 413) return 'Those files are too large to upload in one go. Attach fewer or smaller files and try again.';
    if (status === 502 || status === 503 || status === 504) return 'The server is not responding. Please try again in a moment.';
    return `Request failed (HTTP ${status})`;
};

// Endpoints where a 401 means "the credentials in this request body were wrong",
// not "your session died". Logging out and reloading on these would throw the
// user back to a blank login screen and destroy the message they need to read —
// e.g. "Invalid credentials. 3 attempt(s) remaining" before the account locks,
// or "Current password is incorrect" inside the change-password modal.
const CREDENTIAL_ENDPOINTS = ['/auth/login', '/auth/change-password'];

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

    // Read the body as text first. Calling response.json() straight away turns
    // any non-JSON response (a proxy's HTML error page) into an opaque
    // "Unexpected token '<'" that hides the real status from the user.
    const raw = await response.text();
    let data = null;
    let parsed = false;
    if (raw) {
        try { data = JSON.parse(raw); parsed = true; } catch { /* not JSON — handled below */ }
    }

    if (!response.ok) {
        if (response.status === 401 && !CREDENTIAL_ENDPOINTS.includes(endpoint)) {
            logout();
            window.location.reload();
        }
        throw new Error(data?.detail || data?.error || nonApiErrorMessage(response.status));
    }

    // A body that parsed is returned as-is, including a literal `null` — that is
    // a real answer from endpoints like /frozen-designs/match ("nothing frozen
    // for this key"), and turning it into {} makes every `if (!match)` guard
    // fail. The {} fallback is only for a response with no body to read.
    return parsed ? data : {};
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

    // email is optional but is where QD notifications (e.g. a QD sent back to
    // this user) are delivered — without it they get none.
    create: async (username, password, role = 'user', pageAccess = null, email = null, fullName = null, phone = null) => {
        return apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role, page_access: pageAccess, email, full_name: fullName, phone }),
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

    update: async (id, { username, role, pageAccess, email, fullName, phone } = {}) => {
        const body = {};
        if (username !== undefined) body.username = username;
        if (role !== undefined) body.role = role;
        if (pageAccess !== undefined) body.page_access = pageAccess;
        if (email !== undefined) body.email = email; // '' clears the address
        if (fullName !== undefined) body.full_name = fullName;
        if (phone !== undefined) body.phone = phone;
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

// Supplier performance scorecard
export const supplierPerformanceAPI = {
    getSuppliers: async () => apiRequest('/supplier-performance/suppliers'),

    getReport: async ({ supplier, year, month, frequency }) => {
        const qs = new URLSearchParams({ supplier, year: String(year), month, frequency });
        return apiRequest(`/supplier-performance?${qs}`);
    },

    // Returns a Blob. The report is rebuilt server-side, so what downloads is
    // what the database says, not what this page happens to be showing.
    exportPdf: async ({ supplier, year, month, frequency, comments }) => {
        const response = await fetch(`${API_BASE_URL}/supplier-performance/pdf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify({ supplier, year, month, frequency, comments }),
        });
        if (!response.ok) {
            let message = nonApiErrorMessage(response.status);
            try { message = (await response.json()).error || message; } catch { /* not JSON */ }
            throw new Error(message);
        }
        return response.blob();
    },

    getDieLife: async ({ year, month }) => {
        const qs = new URLSearchParams({ year: String(year), month: String(month) });
        return apiRequest(`/supplier-performance/die-life?${qs}`);
    },

    saveDieLife: async ({ year, month, entries }) => apiRequest('/supplier-performance/die-life', {
        method: 'PUT',
        body: JSON.stringify({ year, month, entries }),
    }),

    getSettings: async (year) => {
        const qs = new URLSearchParams(year ? { year: String(year) } : {});
        return apiRequest(`/supplier-performance/settings${qs.toString() ? `?${qs}` : ''}`);
    },

    saveSettings: async (year, metrics) => apiRequest('/supplier-performance/settings', {
        method: 'PUT',
        body: JSON.stringify({ year, metrics }),
    }),
};

// Correctors API — master list behind the Corrector dropdowns
export const correctorsAPI = {
    getAll: async ({ plant, includeInactive } = {}) => {
        const qs = new URLSearchParams();
        if (plant) qs.set('plant', plant);
        if (includeInactive) qs.set('includeInactive', 'true');
        const suffix = qs.toString() ? `?${qs}` : '';
        return apiRequest(`/correctors${suffix}`);
    },

    create: async (name, plant = null) => {
        return apiRequest('/correctors', {
            method: 'POST',
            body: JSON.stringify({ name, plant }),
        });
    },

    update: async (id, data) => {
        return apiRequest(`/correctors/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    },

    delete: async (id) => {
        return apiRequest(`/correctors/${id}`, {
            method: 'DELETE',
        });
    },
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
    // qdId (optional): the server renders that QD's form and attaches it. The
    // client never names a file — it names the record.
    sendEmail: async ({ to, cc, subject, body, importance, orderId, qdId }) => {
        return apiRequest('/email/send', {
            method: 'POST',
            body: JSON.stringify({ to, cc, subject, body, importance, orderId, qdId }),
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

    // The two FOC chasers: 'supplier' (replacements they promised and have not
    // delivered) and 'internal' (replacements that arrived and sit untrialled).
    getFocReminderSettings: async () => {
        return apiRequest('/email/foc-reminder-settings');
    },

    updateFocReminderSettings: async (settings) => {
        return apiRequest('/email/foc-reminder-settings', {
            method: 'PUT',
            body: JSON.stringify(settings),
        });
    },

    runFocRemindersNow: async (which) => {
        return apiRequest('/email/foc-reminder-settings/run-now', {
            method: 'POST',
            body: JSON.stringify({ which }),
        });
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

    // payload.qdRequestedDate (YYYY-MM-DD) is required — the server answers 400 without it.
    create: async (payload) =>
        apiRequest('/quality-discrepancies', { method: 'POST', body: JSON.stringify(payload) }),

    // Approval workflow: Draft/SentBack --submit--> Pending --approve--> Approved
    // (emails Purchase), or --sendBack--> SentBack (reason required).
    // approverUserId is required — the server answers 400 without it. The QD is
    // routed to that person and only they (or an admin) can then act on it.
    submit: async (id, approverUserId) =>
        apiRequest(`/quality-discrepancies/${id}/submit`, {
            method: 'POST',
            body: JSON.stringify({ approverUserId }),
        }),

    // Users eligible to approve — the admin-ticked approvers plus admins.
    // Readable by any QD user, since the raiser has to pick one when submitting.
    listApprovers: async () => apiRequest('/quality-discrepancies/approvers'),

    // What this user personally owes: QDs awaiting their approval, and QDs of
    // theirs that were sent back. Both buckets come back empty rather than
    // erroring for a user with neither, so callers need no role check.
    myQueue: async () =>
        apiRequest('/quality-discrepancies/my-queue'),

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

    // fields: { outcome?, input_at_failure?, eta_date?, corrector?, supplier_acceptance?,
    // action_taken?, supplier_comments?, received_by_supplier?, ... } — '' clears each field.
    // supplier_acceptance must be exactly 'Yes' | 'No' | '' — the server rejects anything else.
    update: async (id, fields) =>
        apiRequest(`/quality-discrepancies/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),

    // Full "Edit QD" save (Part-A, discrepancy text, billets). Body reuses the
    // raise form's camelCase keys plus billets:{ first:{…}, last:{…} }. The
    // server allows this only while the QD is a Draft or has been sent back.
    updateDetails: async (id, payload) =>
        apiRequest(`/quality-discrepancies/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),

    // reason is mandatory; etaDate is mandatory when status is 'FOC Accepted',
    // receivedDate when it is 'FOC Received'.
    setStatus: async (id, status, reason, etaDate, receivedDate) =>
        apiRequest(`/quality-discrepancies/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status, reason, etaDate, receivedDate }),
        }),

    // Verdict on the open FOC round. A 'Fail' must carry nextStatus + reason —
    // the server refuses it otherwise, so a failed replacement can never leave
    // the QD parked with nothing left to receive. etaDate applies only when the
    // chosen nextStatus is 'FOC Accepted' (the supplier promised another one).
    recordFocTrial: async (id, { trialDate, result, notes, nextStatus, reason, etaDate }) =>
        apiRequest(`/quality-discrepancies/${id}/foc-trial`, {
            method: 'POST',
            body: JSON.stringify({ trialDate, result, notes, nextStatus, reason, etaDate }),
        }),

    // kind: 'note' (default) | 'email' | 'reminder' — the server decides the
    // timeline icon/tone from the kind.
    addNote: async (id, note, kind = 'note') =>
        apiRequest(`/quality-discrepancies/${id}/notes`, { method: 'POST', body: JSON.stringify({ note, kind }) }),

    // category (optional): 'profile_image' | 'approved_design' | 'trial_photo' | 'general'.
    // Applies to every file in this call — the server reads one category per request.
    uploadFiles: async (id, fileList, category) => {
        const form = new FormData();
        Array.from(fileList).forEach((f) => form.append('files', f));
        if (category) form.append('category', category);
        return apiRequest(`/quality-discrepancies/${id}/files`, { method: 'POST', body: form, isMultipart: true });
    },

    // Removes one already-attached image. Server-gated to Draft/SentBack.
    deleteFile: async (id, fileId) =>
        apiRequest(`/quality-discrepancies/${id}/files/${fileId}`, { method: 'DELETE' }),

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

    // One authenticated fetch of the rendered QD form, shared by the download and
    // the in-app preview so the two can never show different bytes. The route is
    // behind authMiddleware and needs this Bearer header — which is exactly why
    // the preview cannot point an <iframe> straight at the API.
    documentBlob: async (id) => {
        const token = getToken();
        const response = await fetch(`${API_BASE_URL}/quality-discrepancies/${id}/document`, {
            headers: { ...(token && { Authorization: `Bearer ${token}` }) },
        });
        if (!response.ok) throw new Error(`Document failed (HTTP ${response.status})`);
        return response.blob();
    },

    // Object URL for the preview iframe. The caller owns it and MUST call
    // URL.revokeObjectURL on it — otherwise every re-open strands another copy
    // of the PDF in memory for the life of the tab.
    documentUrl: async (id) =>
        URL.createObjectURL(await qualityDiscrepanciesAPI.documentBlob(id)),

    // Streams the rendered QD form as a PDF and triggers a browser download.
    downloadDocument: async (id, qdNo) => {
        const blob = await qualityDiscrepanciesAPI.documentBlob(id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `QD-${qdNo || id}.pdf`;
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


// Your own scanned signature, printed in the Signature column of the QD form.
// Self-service only — the API has no path to set someone else's.
export const signaturesAPI = {
    // { dataUrl, updatedAt } — both null when nothing has been uploaded.
    getMine: async () => apiRequest('/signatures/me'),

    upload: async (file) => {
        const form = new FormData();
        form.append('signature', file);
        return apiRequest('/signatures/me', { method: 'PUT', body: form, isMultipart: true });
    },

    remove: async () => apiRequest('/signatures/me', { method: 'DELETE' }),
};
