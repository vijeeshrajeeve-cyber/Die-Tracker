'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canAccessPage, canReadSource, canManageItem, isMine, eligibleOwner } = require('./workQueuePermissions.cjs');

const user = { id: 7, role: 'user', pageAccess: ['orders', 'flow-sample-followup'] };
const order = { source_kind: 'order', task_kind: 'order_stage', owner_id: 7, plant: 'GEX 1' };
const qd = { source_kind: 'qd', task_kind: 'qd_approval', owner_id: 7, plant: 'GEX 1' };
const approver = { ...user, pageAccess: ['qd-tracker'] };

test('page access preserves admin, unrestricted users, explicit empty grants and legacy process-flow', () => {
  assert.equal(canAccessPage(null, 'orders'), false);
  assert.equal(canAccessPage({ ...user, role: 'admin', pageAccess: [] }, 'orders'), true);
  assert.equal(canAccessPage({ ...user, pageAccess: null }, 'qd-tracker'), true);
  assert.equal(canAccessPage({ ...user, pageAccess: [] }, 'orders'), false);
  assert.equal(canAccessPage({ ...user, pageAccess: ['process-flow'] }, 'flow-sample-followup'), true);
  assert.equal(canAccessPage({ ...user, pageAccess: ['process-flow'] }, 'qd-tracker'), false);
  assert.equal(canAccessPage({ id: 7, page_access: '["orders"]' }, 'orders'), true);
  assert.equal(canAccessPage({ id: 7, page_access: 'invalid' }, 'orders'), false);
});

test('source access matches the existing mounted order, sample and QD page requirements', () => {
  assert.equal(canReadSource({ ...user, pageAccess: ['analytics'] }, 'order'), true);
  assert.equal(canReadSource({ ...user, pageAccess: ['flow-simulation'] }, 'order'), true);
  assert.equal(canReadSource({ ...user, pageAccess: ['orders'] }, 'sample'), false);
  assert.equal(canReadSource(user, 'sample'), true);
  assert.equal(canReadSource(user, 'qd'), false);
  assert.equal(canReadSource(approver, 'qd'), true);
  assert.equal(canReadSource({ ...user, role: 'admin' }, 'unknown'), false);
});

test('ownership never bypasses source permissions for reading personal work', () => {
  assert.equal(isMine(order, user), true);
  assert.equal(isMine(order, { ...user, pageAccess: ['work-queue'] }), false);
  assert.equal(isMine(qd, user, { isQdApprover: true }), false);
});

test('management grants are explicitly scoped to both user and plant and require source access', () => {
  const grants = [{ user_id: 7, plant: 'GEX 1' }];
  assert.equal(canManageItem(user, order, grants), true);
  assert.equal(canManageItem(user, { ...order, plant: 'GEX 2' }, grants), false);
  assert.equal(canManageItem({ ...user, id: 8 }, order, grants), false);
  assert.equal(canManageItem(user, qd, grants), false);
  assert.equal(canManageItem(user, order, [{ ...grants[0], revoked_at: '2026-09-21' }]), false);
  assert.equal(canManageItem({ ...user, role: 'admin' }, order, []), true);
  assert.equal(canManageItem(user, order, []), false);
  assert.equal(canManageItem(user, { ...order, plant: 'GEX 2' }, [{ user_id: 7, plant: null }]), true);
});

test('QD personal approvals preserve named-approver and legacy-unassigned membership', () => {
  assert.equal(isMine(qd, approver, { isQdApprover: true }), true);
  assert.equal(isMine(qd, approver), false);
  assert.equal(isMine({ ...qd, owner_id: 8 }, approver, { isQdApprover: true }), false);
  assert.equal(isMine({ ...qd, owner_id: null }, approver, { isQdApprover: true }), true);
  assert.equal(isMine({ ...qd, owner_id: null }, approver), false);
});

test('administrator authority does not put somebody else\'s QD in My work', () => {
  const admin = { id: 99, role: 'admin', pageAccess: null };
  assert.equal(canManageItem(admin, qd), true);
  assert.equal(isMine(qd, admin, { isQdApprover: true }), false);
  assert.equal(isMine({ ...qd, owner_id: null }, admin, { isQdApprover: true }), true);
  assert.equal(isMine({ ...qd, task_kind: 'qd_returned' }, admin, { isQdApprover: true }), false);
});

test('returned QDs belong only to the source-derived raiser', () => {
  const returned = { ...qd, task_kind: 'qd_returned' };
  assert.equal(isMine(returned, approver), true);
  assert.equal(isMine({ ...returned, owner_id: 8 }, approver), false);
  assert.equal(isMine({ ...returned, owner_id: null }, approver), false);
});

test('eligible owners need source access and QD approvers need configured eligibility', () => {
  assert.equal(eligibleOwner(user, order), true);
  assert.equal(eligibleOwner(user, qd, [7]), false);
  assert.equal(eligibleOwner(approver, qd, [7]), true);
  assert.equal(eligibleOwner(approver, qd, [8]), false);
  assert.equal(eligibleOwner({ ...approver, role: 'admin' }, qd), true);
  assert.equal(eligibleOwner({ ...user, is_active: false }, order), false);
  assert.equal(eligibleOwner({ ...user, pageAccess: [] }, order), false);
});
