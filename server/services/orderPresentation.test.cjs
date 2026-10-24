'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { presentOrder } = require('./orderPresentation.cjs');

test('an order carries its die type under "Die Type"', () => {
  assert.equal(presentOrder({ die_type: 'HOLLOW' })['Die Type'], 'HOLLOW');
  assert.equal(presentOrder({ die_type: null })['Die Type'], null);
});
