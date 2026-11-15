'use strict';
// Who may mark, edit or remove a Design enhancement. Order editors may act
// while the order is before DIE RECEIVED; after that only an admin may, and
// must give a reason. Pure -- no database access.
const { canEditOrderDetails } = require('./orderDetailEdits.cjs');

// Marking an order in one of these statuses also switches Simulation on.
// Later statuses keep their simulation setting and their status untouched.
const SIMULATION_STATUSES = Object.freeze(['PENDING FOR ORDERING', 'AWAITING FOR DESIGN', 'UNDER SIMULATION']);

// Marking switches Simulation on in those statuses, and for an order on HOLD
// that has not yet got its design approved (it is still before simulation ends).
function marksSimulationOn(orderStatus, designApprovedDate) {
  const status = String(orderStatus || '').toUpperCase();
  if (SIMULATION_STATUSES.includes(status)) return true;
  return status === 'HOLD' && !String(designApprovedDate ?? '').trim();
}

const isAdmin = (user) => !!user && user.role === 'admin';
const refuse = (status, error, code) => ({ ok: false, status, error, code });

function adminPath(user, reason, forbidden) {
  if (!isAdmin(user)) return refuse(403, forbidden, 'ENHANCEMENT_ADMIN_ONLY');
  if (typeof reason !== 'string' || !reason.trim()) return refuse(400, 'Give a reason for this change', 'REASON_REQUIRED');
  return { ok: true, adminPath: true };
}

// Once the die is received or has been trialled the baseline is locked: only an
// admin may change it, and must say why. Status text alone is not enough (a
// received die can be on HOLD or DONE), so any received date, trial row or
// trial verdict also locks it. `facts`: { receivedDate, hasTrial, trialVerdict }.
function isLocked(orderStatus, facts) {
  const f = facts || {};
  if (String(orderStatus || '').toUpperCase() === 'DIE RECEIVED') return true;
  return Boolean(String(f.receivedDate ?? '').trim()) || Boolean(f.hasTrial) || Boolean(f.trialVerdict);
}

// Mark an order, or edit its baseline: editors until the baseline locks, admins after.
function markAccess(user, orderStatus, reason, facts) {
  if (!canEditOrderDetails(user)) return refuse(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
  const status = String(orderStatus || '').toUpperCase();
  if (status === 'CANCELLED') return refuse(400, 'A cancelled order cannot be a Design enhancement', 'ORDER_CANCELLED');
  if (!isLocked(status, facts)) return { ok: true, adminPath: false };
  return adminPath(user, reason, 'Only an admin can change the enhancement once the die is received or a trial is logged');
}

// Remove the flag: editors while the order has no trial, admins after.
function removeAccess(user, hasTrial, reason) {
  if (!canEditOrderDetails(user)) return refuse(403, 'You do not have permission to edit order details', 'ORDER_EDIT_FORBIDDEN');
  if (!hasTrial) return { ok: true, adminPath: false };
  return adminPath(user, reason, 'Only an admin can remove the enhancement once a trial is logged');
}

// Record a trial verdict or a life review: anyone with Sample Followup access
// (checked by the route) the first time; once one exists, only an admin, with a reason.
function verdictAccess(user, alreadyRecorded, reason) {
  if (!alreadyRecorded) return { ok: true, adminPath: false };
  return adminPath(user, reason, 'Only an admin can redo a verdict that is already recorded');
}

module.exports = { SIMULATION_STATUSES, isLocked, marksSimulationOn, markAccess, removeAccess, verdictAccess };
