'use strict';
// Who may mark, edit or remove a Design enhancement. Order editors may act
// while the order is before DIE RECEIVED; after that only an admin may, and
// must give a reason. Pure -- no database access.
const { canEditOrderDetails } = require('./orderDetailEdits.cjs');

// Marking an order in one of these statuses also switches Simulation on.
// Later statuses keep their simulation setting and their status untouched.
const SIMULATION_STATUSES = Object.freeze(['PENDING FOR ORDERING', 'AWAITING FOR DESIGN', 'UNDER SIMULATION']);

const isAdmin = (user) => !!user && user.role === 'admin';
const refuse = (status, error, code) => ({ ok: false, status, error, code });

function adminPath(user, reason, forbidden) {
  if (!isAdmin(user)) return refuse(403, forbidden, 'ENHANCEMENT_ADMIN_ONLY');
  if (typeof reason !== 'string' || !reason.trim()) return refuse(400, 'Give a reason for this change', 'REASON_REQUIRED');
  return { ok: true, adminPath: true };
}

// Mark an order, or edit its baseline: editors before DIE RECEIVED, admins after.
function markAccess(user, orderStatus, reason) {
  if (!canEditOrderDetails(user)) return refuse(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
  const status = String(orderStatus || '').toUpperCase();
  if (status === 'CANCELLED') return refuse(400, 'A cancelled order cannot be a Design enhancement', 'ORDER_CANCELLED');
  if (status !== 'DIE RECEIVED') return { ok: true, adminPath: false };
  return adminPath(user, reason, 'Only an admin can change the enhancement once the die is received');
}

// Remove the flag: editors while the order has no trial, admins after.
function removeAccess(user, hasTrial, reason) {
  if (!canEditOrderDetails(user)) return refuse(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
  if (!hasTrial) return { ok: true, adminPath: false };
  return adminPath(user, reason, 'Only an admin can remove the enhancement once a trial is logged');
}

module.exports = { SIMULATION_STATUSES, markAccess, removeAccess };
