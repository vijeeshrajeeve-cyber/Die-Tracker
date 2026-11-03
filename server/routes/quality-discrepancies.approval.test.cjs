'use strict';
// auth.cjs warns when this is unset, and email.cjs needs it to verify the token.
process.env.JWT_SECRET = 'qd-approval-test-secret-that-is-at-least-32-characters';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { installFakeDb, listen, request } = require('./testSupport.cjs');

// What the next request finds in the database.
let qdRow;
let qdFiles;
let hasSignature;
let settingsRow;
let writes;
let collideOnApprove;
let staleOnWrite;
installFakeDb(async (sql, params = []) => {
  const q = sql.trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(q)) return { rows: [] };
  if (/^(UPDATE|INSERT)/.test(q)) {
    writes.push(q);
    if (collideOnApprove && /approval_state = 'Approved'/.test(q)) throw Object.assign(new Error('duplicate key'), { code: '23505' });
    if (staleOnWrite && /^UPDATE/.test(q)) return { rows: [], rowCount: 0 };
    // The progress gate (`AND approval_state = 'Approved'`), not approve's own SET.
    const blocked = /AND approval_state = 'Approved'/.test(q) && qdRow.approval_state !== 'Approved';
    return { rows: [], rowCount: blocked ? 0 : 1 };
  }
  if (/FROM user_signatures/.test(q)) {
    return hasSignature ? { rows: [{ mime_type: 'image/png', image: Buffer.from('x') }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }
  if (/FROM quality_discrepancy_files/.test(q)) return { rows: qdFiles, rowCount: qdFiles.length };
  if (/FROM qd_settings/.test(q)) return { rows: settingsRow ? [settingsRow] : [], rowCount: settingsRow ? 1 : 0 };
  if (/FROM qd_billet_parameters/.test(q)) return { rows: [] };
  if (/FROM suppliers/.test(q)) return { rows: [{ name: 'Phoenix', qd_code: 'PH' }] };
  if (/SELECT qd_no FROM quality_discrepancies/.test(q)) return { rows: [] };
  if (/FROM quality_discrepancies/.test(q)) return { rows: [qdRow], rowCount: 1 };
  if (/FROM users/.test(q)) return { rows: [{ id: 1, username: 'admin', role: 'admin', page_access: null }], rowCount: 1 };
  return { rows: [], rowCount: 0 };
});

const qdRouter = require('./quality-discrepancies.cjs');
const emailRouter = require('./email.cjs');

const app = express();
app.use(express.json());
app.use('/api/email', emailRouter);
app.use((req, res, next) => { req.user = { id: 1, username: 'admin', role: 'admin' }; next(); });
app.use('/api/quality-discrepancies', qdRouter);

const COMPLETE = {
  id: 7, qd_no: null, supplier: 'Phoenix', prepared_by: 'admin', created_by: 1, approval_state: 'Draft',
  issue_detail: 'Bearing marks', manufacturing_defect: 'Yes', die_performance: 'No', recommended_action: 'Rework',
};
const PROFILE = { original_name: 'profile.png', category: 'profile_image' };

let base;
let close;
test.before(async () => { ({ base, close } = await listen(app)); });
test.after(() => close());
test.beforeEach(() => {
  qdRow = { ...COMPLETE };
  qdFiles = [PROFILE];
  hasSignature = true;
  settingsRow = null;
  writes = [];
  collideOnApprove = false;
  staleOnWrite = false;
});

const QD = '/api/quality-discrepancies/7';

test('a status change on an unapproved QD answers 409 and records nothing', async () => {
  qdRow.approval_state = 'Pending';
  const { status, body } = await request(base, `${QD}/status`, { method: 'PATCH', body: { status: 'Closed', reason: 'done' } });
  assert.equal(status, 409);
  assert.match(body.error, /must be approved first/);
  assert.equal(writes.some((w) => /quality_discrepancy_activity/.test(w)), false);
});

test('a status change on an approved QD goes through', async () => {
  qdRow.approval_state = 'Approved';
  const { status } = await request(base, `${QD}/status`, { method: 'PATCH', body: { status: 'Closed', reason: 'done' } });
  assert.equal(status, 200);
});

test('submitting an incomplete QD answers 400, names what is missing, and takes no number', async () => {
  qdRow.recommended_action = '';
  const { status, body } = await request(base, `${QD}/submit`, { body: { approverUserId: 1 } });
  assert.equal(status, 400);
  assert.match(body.error, /^Cannot submit yet\. Still needed: Recommended action$/);
  assert.equal(writes.some((w) => /SET qd_no/.test(w)), false);
});

test('submitting a complete QD goes through and never writes a number', async () => {
  const { status, body } = await request(base, `${QD}/submit`, { body: { approverUserId: 1 } });
  assert.equal(status, 200);
  assert.equal(body.approval_state, 'Pending');
  assert.equal(writes.some((w) => /qd_no/.test(w)), false);
});

test('approving an unnumbered QD issues its number', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Pending', submitted_at: new Date() };
  const { status, body } = await request(base, `${QD}/approve`, { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.qd_no, `${new Date().getFullYear()}PH-01`);
  assert.ok(writes.some((w) => /approval_state = 'Approved'/.test(w) && /qd_no = \$1/.test(w)));
});

test('approving a QD that stopped being Pending underneath answers 409', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Pending', submitted_at: new Date() };
  staleOnWrite = true; // the UPDATE finds no Pending row
  const { status, body } = await request(base, `${QD}/approve`, { method: 'POST' });
  assert.equal(status, 409);
  assert.match(body.error, /changed while you were working on it/);
});

test('approving answers 409 when the number collides', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Pending', submitted_at: new Date() };
  collideOnApprove = true;
  const { status, body } = await request(base, `${QD}/approve`, { method: 'POST' });
  assert.equal(status, 409);
  assert.match(body.error, /please retry/);
});

test('the approval check warns about a blank form, a missing signature and no Purchase email', async () => {
  qdRow = { ...COMPLETE, qd_no: '2026PH-01', approval_state: 'Pending', recommended_action: null, submitted_at: new Date() };
  hasSignature = false;
  const { status, body } = await request(base, `${QD}/approval-check`);
  assert.equal(status, 200);
  const byKey = Object.fromEntries(body.checks.map((c) => [c.key, c]));
  assert.equal(byKey.complete.ok, false);
  assert.equal(byKey.preparedSignature.ok, false);
  assert.equal(byKey.approverSignature.ok, false);
  assert.equal(byKey.purchaseEmail.ok, false);
});

test('the approval check passes when everything is in place', async () => {
  qdRow = { ...COMPLETE, qd_no: '2026PH-01', approval_state: 'Pending', submitted_at: new Date() };
  settingsRow = { purchase_email_to: 'buy@example.com', approver_user_ids: '[]' };
  const { body } = await request(base, `${QD}/approval-check`);
  assert.ok(body.checks.every((c) => c.ok), JSON.stringify(body.checks));
});

test('cancelling needs a reason', async () => {
  qdRow.approval_state = 'Pending';
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: '' } });
  assert.equal(status, 400);
  assert.match(body.error, /Reason is required/);
});

test('an approved QD cannot be cancelled', async () => {
  qdRow.approval_state = 'Approved';
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: 'dup' } });
  assert.equal(status, 409);
  assert.match(body.error, /Cannot cancel a QD that is Approved/);
  assert.equal(writes.some((w) => /Cancelled/.test(w)), false);
});

test('a plain user cannot cancel someone else\'s QD', async () => {
  // The main app signs in as admin, so mount the router once more behind a plain user.
  const plain = express();
  plain.use(express.json());
  plain.use((req, _res, next) => { req.user = { id: 9, username: 'sijith', role: 'user' }; next(); });
  plain.use('/api/quality-discrepancies', qdRouter);
  const { base: plainBase, close: closePlain } = await listen(plain);
  try {
    qdRow.approval_state = 'Pending';
    qdRow.created_by = 1;
    settingsRow = { approver_user_ids: '[]' };
    const { status, body } = await request(plainBase, `${QD}/cancel`, { body: { reason: 'dup' } });
    assert.equal(status, 403);
    assert.match(body.error, /cannot cancel/i);
    assert.equal(writes.some((w) => /Cancelled/.test(w)), false);
  } finally { await closePlain(); }
});

test('the raiser can cancel their own pending QD', async () => {
  qdRow.approval_state = 'Pending';
  qdRow.created_by = 1;
  const { status, body } = await request(base, `${QD}/cancel`, { body: { reason: 'Raised twice' } });
  assert.equal(status, 200);
  assert.equal(body.message, 'Cancelled');
  assert.ok(writes.some((w) => /approval_state = 'Cancelled'/.test(w)));
});

test('the register hides cancelled QDs unless asked, and never counts them', async () => {
  qdRow = { ...COMPLETE, approval_state: 'Cancelled', status: 'Open', raised_date: '2026-10-01' };
  assert.equal((await request(base, '/api/quality-discrepancies')).body.qds.length, 0);
  const { body } = await request(base, '/api/quality-discrepancies?cancelled=1');
  assert.equal(body.qds.length, 1);
  assert.equal(body.qds[0].approval_state, 'Cancelled');
  assert.equal(body.kpis.total, 0);
});

test('the supplier email route refuses the form of an unapproved QD', async () => {
  const token = jwt.sign({ id: 1, username: 'admin', role: 'admin' }, process.env.JWT_SECRET);
  for (const state of ['Draft', 'Pending', 'SentBack']) {
    qdRow.approval_state = state;
    const { status, body } = await request(base, '/api/email/send', {
      token, body: { to: 'supplier@example.com', subject: 's', body: 'b', qdId: 7 },
    });
    assert.equal(status, 409, `state ${state}`);
    assert.match(body.error, /has not been approved/);
  }
});
