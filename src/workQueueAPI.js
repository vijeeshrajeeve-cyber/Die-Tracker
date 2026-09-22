import { logout } from './api';

const BASE = `${import.meta.env?.VITE_API_URL || '/api'}/work-queue`;

async function request(path, options = {}) {
  const token = localStorage.getItem('token');
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.detail || data.error || `The request could not be completed (${response.status}). Please try again.`);
    error.status = response.status;
    error.data = data;
    if (response.status === 401) { logout(); window.location.reload(); }
    throw error;
  }
  return data;
}

const query = values => {
  const params = new URLSearchParams();
  Object.entries(values || {}).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) params.set(key, String(value));
  });
  return params.toString();
};

export const workQueueAPI = {
  list: (filters, signal) => request(`/items?${query(filters)}`, { signal }),
  detail: (id, signal) => request(`/items/${encodeURIComponent(id)}`, { signal }),
  source: (id, signal) => request(`/items/${encodeURIComponent(id)}/source`, { signal }),
  assignees: (id, signal) => request(`/assignees?${query({ itemId: id })}`, { signal }),
  mutate: (id, action, payload) => request(`/items/${encodeURIComponent(id)}/${action}`, {
    method: 'POST', body: JSON.stringify({ ...payload, requestId: crypto.randomUUID() }),
  }),
  settings: signal => request('/settings', { signal }),
  inbox: signal => request('/inbox', { signal }),
  readNotification: id => request(`/inbox/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' }),
  saveSettings: (section, payload) => request(`/settings/${section}`, {
    method: 'POST', body: JSON.stringify(payload),
  }),
};
