import test from 'node:test';
import assert from 'node:assert/strict';
import { skipTrialAllowed, skipTrialDefault, buildReceivancePatch } from './dieReceivance.js';

const order = {
  id: 7,
  'DIE NO': 'ABC-1',
  TYPE: 'T',
  STATUS: 'DONE',
  Plant: 'GEX 1',
  Press: '',
  'Ascona Reference': '',
  'Sample Status': '',
};
const form = { die_received_date: '2026-09-06', corrector: '  Ravi  ' };

test('skip trial is allowed for Tooling and Backup only', () => {
  assert.equal(skipTrialAllowed('T'), true);
  assert.equal(skipTrialAllowed('B'), true);
  assert.equal(skipTrialAllowed('N'), false);
  assert.equal(skipTrialAllowed(undefined), false);
  assert.equal(skipTrialAllowed(''), false);
});

test('skip trial defaults on for Tooling and off for everything else', () => {
  assert.equal(skipTrialDefault('T'), true);
  assert.equal(skipTrialDefault('B'), false);
  assert.equal(skipTrialDefault('N'), false);
  assert.equal(skipTrialDefault(undefined), false);
});

test('unchecked patch is the plain receipt', () => {
  const { patch, logEntry } = buildReceivancePatch({ order, form, skipTrial: false });
  assert.deepEqual(patch, {
    STATUS: 'DIE RECEIVED',
    'Die Received Date': '2026-09-06',
    'Corrector': 'Ravi',
    'Press': 'GEX 1',
    'Ascona Reference': 'No',
    'Sample Status': 'Pending',
    'Change Log': [logEntry],
  });
  assert.deepEqual(logEntry, {
    date: '2026-09-06',
    field: 'STATUS',
    oldValue: 'DONE',
    newValue: 'DIE RECEIVED',
    stage: 'DONE',
    reason: 'Corrector: Ravi',
  });
});

test('unchecked patch keeps an existing sample status, press and Ascona reference', () => {
  const existing = { ...order, Press: 'P2', 'Ascona Reference': 'Yes', 'Sample Status': 'On hold' };
  const { patch } = buildReceivancePatch({ order: existing, form, skipTrial: false });
  assert.equal(patch['Sample Status'], 'On hold');
  assert.equal(patch['Press'], 'P2');
  assert.equal(patch['Ascona Reference'], 'Yes');
  assert.equal('Submission Date' in patch, false);
  assert.equal('Sample Approval Date' in patch, false);
  assert.equal('No of Trial' in patch, false);
});

test('checked patch stamps the sample fields at the received date', () => {
  const { patch, logEntry } = buildReceivancePatch({ order, form, skipTrial: true });
  assert.equal(patch['Submission Date'], '2026-09-06');
  assert.equal(patch['Sample Approval Date'], '2026-09-06');
  assert.equal(patch['No of Trial'], 0);
  assert.equal(patch['Sample Status'], 'Approved');
  assert.equal(patch['Die Received Date'], '2026-09-06');
  assert.equal(patch.STATUS, 'DIE RECEIVED');
  assert.equal(logEntry.reason, 'Corrector: Ravi · Trial skipped (Tooling)');
  assert.deepEqual(patch['Change Log'], [logEntry]);
});

test('checked patch names Backup in the reason for a B die', () => {
  const { logEntry } = buildReceivancePatch({ order: { ...order, TYPE: 'B' }, form, skipTrial: true });
  assert.equal(logEntry.reason, 'Corrector: Ravi · Trial skipped (Backup)');
});

test('checked patch overrides an existing sample status', () => {
  const held = { ...order, 'Sample Status': 'On hold' };
  const { patch } = buildReceivancePatch({ order: held, form, skipTrial: true });
  assert.equal(patch['Sample Status'], 'Approved');
});

test('skip is ignored for a New die even if asked for', () => {
  const { patch, logEntry } = buildReceivancePatch({ order: { ...order, TYPE: 'N' }, form, skipTrial: true });
  assert.equal('Submission Date' in patch, false);
  assert.equal(patch['Sample Status'], 'Pending');
  assert.equal(logEntry.reason, 'Corrector: Ravi');
});
