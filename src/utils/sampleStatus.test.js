import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceStatus } from './sampleStatus.js';

test('Pending advances to either stage', () => {
  assert.equal(advanceStatus('Pending', 'Sample Submitted'), 'Sample Submitted');
  assert.equal(advanceStatus('Pending', 'Approved'), 'Approved');
});

test('Sample Submitted advances to Approved', () => {
  assert.equal(advanceStatus('Sample Submitted', 'Approved'), 'Approved');
});

test('Approved never falls back to Sample Submitted', () => {
  assert.equal(advanceStatus('Approved', 'Sample Submitted'), null);
});

test('re-stamping a stage with its own target changes nothing', () => {
  assert.equal(advanceStatus('Sample Submitted', 'Sample Submitted'), null);
  assert.equal(advanceStatus('Approved', 'Approved'), null);
});

test('an empty or missing status is treated as Pending and advances', () => {
  assert.equal(advanceStatus('', 'Sample Submitted'), 'Sample Submitted');
  assert.equal(advanceStatus(null, 'Approved'), 'Approved');
  assert.equal(advanceStatus(undefined, 'Sample Submitted'), 'Sample Submitted');
});

test('Rejected is left alone by both buttons', () => {
  assert.equal(advanceStatus('Rejected', 'Sample Submitted'), null);
  assert.equal(advanceStatus('Rejected', 'Approved'), null);
});

test('On hold is left alone by both buttons', () => {
  assert.equal(advanceStatus('On hold', 'Sample Submitted'), null);
  assert.equal(advanceStatus('On hold', 'Approved'), null);
});

test('an unrecognised status is left alone rather than guessed at', () => {
  assert.equal(advanceStatus('Something Else', 'Approved'), null);
});

test('an unrecognised target is refused', () => {
  assert.equal(advanceStatus('Pending', 'Cancelled'), null);
});
