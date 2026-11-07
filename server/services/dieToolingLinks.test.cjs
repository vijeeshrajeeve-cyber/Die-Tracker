'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('./dieToolingLinks.cjs');

const known = { inserts: new Set(['I-12495', 'I-15109']), bolsters: new Set(['BOL-4-6-A', 'BOL-15109', 'BOL-302']) };

test('die list values become typed links, plant normalised, blanks dropped', () => {
  const links = m.linksFromDieList([
    { dieNo: '22413_401', plant: 'GEX 01', bolsterNo: 'I-12495' },
    { dieNo: '27324_401', plant: 'GEX 01', bolsterNo: 'BOL-4-6-A' },
    { dieNo: '19882_601', plant: 'GEX 01', bolsterNo: 'B-6-1-C' },
    { dieNo: '17940_601', plant: 'GEX 01', bolsterNo: '302' },
    { dieNo: '10772_404', plant: 'GEX 01', bolsterNo: '2(=)' },
    { dieNo: '12555_101', plant: 'GEX 01', bolsterNo: null },
  ], known);
  assert.equal(links.length, 5);
  assert.deepEqual(links[0], { die_no: '22413_401', plant: 'GEX 1', tooling_number: 'I-12495', kind: 'insert', raw_value: 'I-12495', source: 'die-list' });
  assert.equal(links[1].tooling_number, 'BOL-4-6-A');
  assert.equal(links[2].tooling_number, 'BOL-6-1-C', 'a bolster the master does not list is still a typed link');
  assert.deepEqual(links[3], { die_no: '17940_601', plant: 'GEX 1', tooling_number: 'BOL-302', kind: 'bolster', raw_value: '302', source: 'die-list' });
  assert.deepEqual(links[4], { die_no: '10772_404', plant: 'GEX 1', tooling_number: null, kind: 'unknown', raw_value: '2(=)', source: 'die-list' });
});

test('resolves a bare number to unknown when both kinds exist', () => {
  const [link] = m.linksFromDieList([{ dieNo: '14516_202', plant: 'GEX 1', bolsterNo: '15109' }], known);
  assert.equal(link.kind, 'unknown');
  assert.equal(link.tooling_number, null);
  assert.equal(link.raw_value, '15109');
});

test('replaceDieListLinks deletes only this plant and source, then inserts', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: params?.length ? 1 : 0, rows: [] }; } };
  const n = await m.replaceDieListLinks(client, 'GEX 1', [
    { die_no: 'a', plant: 'GEX 1', tooling_number: 'I-12495', kind: 'insert', raw_value: 'I-12495', source: 'die-list' },
  ]);
  assert.match(calls[0].sql, /DELETE FROM die_tooling_links WHERE source = 'die-list' AND plant = \$1/);
  assert.deepEqual(calls[0].params, ['GEX 1']);
  assert.match(calls[1].sql, /INSERT INTO die_tooling_links/);
  assert.equal(n, 1);
});

test('no links means delete only, insert count zero', async () => {
  const calls = [];
  const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 0, rows: [] }; } };
  assert.equal(await m.replaceDieListLinks(client, 'GEX 2', []), 0);
  assert.equal(calls.length, 1);
});
