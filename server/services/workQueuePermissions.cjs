'use strict';

const ORDER_PAGES = [
  'dashboard', 'orders', 'analytics', 'flow-pending-order', 'flow-awaiting-design',
  'flow-simulation', 'flow-design-approval', 'flow-pending-pr', 'flow-oracle-entry',
  'flow-design-ems', 'flow-completed', 'flow-sample-followup',
];

function pageAccessOf(user) {
  const value = user.pageAccess !== undefined ? user.pageAccess : user.page_access;
  if (value == null) return null;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function canAccessPage(user, pageIDs) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const access = pageAccessOf(user);
  if (access === null) return true;
  return (Array.isArray(pageIDs) ? pageIDs : [pageIDs]).some(page =>
    typeof page === 'string' && (access.includes(page) || (page.startsWith('flow-') && access.includes('process-flow'))));
}

function canReadSource(user, kind) {
  if (kind === 'order' || kind === 'die_order' || kind === 'die_orders') return canAccessPage(user, ORDER_PAGES);
  if (kind === 'sample' || kind === 'sample_followup' || kind === 'sample_followups' || kind === 'standalone') return canAccessPage(user, 'flow-sample-followup');
  if (kind === 'qd' || kind === 'quality_discrepancy' || kind === 'quality_discrepancies') return canAccessPage(user, 'qd-tracker');
  return false;
}

function sameID(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function itemKind(item) {
  return item?.source_kind || item?.sourceKind || item?.source?.kind;
}

function canManageItem(user, item, grants = []) {
  if (!canReadSource(user, itemKind(item))) return false;
  if (user.role === 'admin') return true;
  const list = Array.isArray(grants) ? grants : grants.work_queue_grants;
  return (list || []).some(grant => sameID(grant.user_id ?? grant.userId, user.id)
    && (grant.plant == null || grant.plant === item.plant) && grant.revoked_at == null);
}

function isMine(item, user, { isQdApprover = false } = {}) {
  if (!user || !canReadSource(user, itemKind(item))) return false;
  const kind = item.task_kind || item.kind || item.stage_key || item.stage;
  const owner = item.owner_id ?? item.assignee_id ?? null;
  if (kind === 'qd_approval') return !!isQdApprover && (owner === null || sameID(owner, user.id));
  // Sent-back ownership is derived by the source adapter from the QD raiser.
  if (kind === 'qd_returned' || kind === 'qd_rework') return sameID(owner, user.id);
  return sameID(owner, user.id);
}

function eligibleOwner(user, item, approverIds = []) {
  if (!user || user.is_active === false || user.active === false || user.disabled === true || user.deleted_at) return false;
  if (!canReadSource(user, itemKind(item))) return false;
  const kind = item.task_kind || item.kind || item.stage_key || item.stage;
  if (kind === 'qd_approval') return user.role === 'admin' || approverIds.some(id => sameID(id, user.id));
  return true;
}

module.exports = { canAccessPage, canReadSource, canManageItem, isMine, eligibleOwner };
