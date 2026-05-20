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
    const headers = {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    const data = await response.json();

    if (!response.ok) {
        if (response.status === 401) {
            logout();
            window.location.reload();
        }
        throw new Error(data.error || 'API request failed');
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
    getAll: async () => {
        return apiRequest('/orders');
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

    create: async (name, shipment_mode = 'LAND', region = null) => {
        return apiRequest('/suppliers', {
            method: 'POST',
            body: JSON.stringify({ name, shipment_mode, region }),
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

