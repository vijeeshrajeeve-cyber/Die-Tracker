// API Service for Die Ordering System
// In Docker: uses relative path /api (proxied by Nginx)
// In development: uses localhost:3001
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

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

    create: async (username, password, role = 'user') => {
        return apiRequest('/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role }),
        });
    },

    delete: async (id) => {
        return apiRequest(`/users/${id}`, {
            method: 'DELETE',
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

    create: async (name) => {
        return apiRequest('/suppliers', {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
    },

    delete: async (id) => {
        return apiRequest(`/suppliers/${id}`, {
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
