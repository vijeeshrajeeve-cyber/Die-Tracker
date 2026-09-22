import { apiRequest } from './api.js';

const request = (path, options) => apiRequest(`/work-queue${path}`, options);

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
