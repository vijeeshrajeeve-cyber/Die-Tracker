import test from 'node:test';
import assert from 'node:assert/strict';
import { composeDieNo, splitDieNo } from './dieNumber.js';

test('composeDieNo joins the two inputs with a dash', () => {
  assert.equal(composeDieNo('29663', '253'), '29663-253');
  assert.equal(composeDieNo('  29663 ', ' 253 '), '29663-253');
  assert.equal(composeDieNo('013012', '705'), '013012-705');
});

test('composeDieNo returns an empty string when either half is missing', () => {
  assert.equal(composeDieNo('29663', ''), '');
  assert.equal(composeDieNo('', '253'), '');
  assert.equal(composeDieNo(null, undefined), '');
});

// Editing an existing request has to populate both fields from one stored value.
test('splitDieNo divides an existing die number at the first dash', () => {
  assert.deepEqual(splitDieNo('29663-253'), { profile: '29663', suffix: '253' });
  assert.deepEqual(splitDieNo('013012-705'), { profile: '013012', suffix: '705' });
});

test('splitDieNo keeps everything after the first dash together', () => {
  assert.deepEqual(splitDieNo('30491-601 DP'), { profile: '30491', suffix: '601 DP' });
});

test('splitDieNo puts a value with no dash in the profile half', () => {
  assert.deepEqual(splitDieNo('29663'), { profile: '29663', suffix: '' });
  assert.deepEqual(splitDieNo(''), { profile: '', suffix: '' });
  assert.deepEqual(splitDieNo(null), { profile: '', suffix: '' });
});

test('compose and split round-trip', () => {
  const { profile, suffix } = splitDieNo('29663-253');
  assert.equal(composeDieNo(profile, suffix), '29663-253');
});
