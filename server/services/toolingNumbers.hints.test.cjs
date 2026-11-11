'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { drawingHintsFromNumber } = require('./toolingNumbers.cjs');

test('drawingHintsFromNumber: TALEX insert numbers point at the recess and how many openings it holds', () => {
    assert.deepEqual(drawingHintsFromNumber('25IC2-090454'), { steppedPockets: 2 });
    assert.deepEqual(drawingHintsFromNumber(' 35ic8a '), { steppedPockets: 8 });
    assert.deepEqual(drawingHintsFromNumber('25IC1-G25934'), { steppedPockets: 1 });
    for (const other of ['I-21599', 'BOL-25B1C1A', 'BOL-4-6-B', '25IC0', '', null]) {
        assert.deepEqual(drawingHintsFromNumber(other), { steppedPockets: null }, String(other));
    }
});
