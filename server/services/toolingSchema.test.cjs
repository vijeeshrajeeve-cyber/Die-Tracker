'use strict';
// init.sql serves fresh installs, db.cjs migrates existing ones; the tooling
// tables must be defined identically in both or the test server and a fresh
// install drift apart.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const initSql = fs.readFileSync(path.join(__dirname, '..', '..', 'init.sql'), 'utf8');
const dbCjs = fs.readFileSync(path.join(__dirname, '..', 'db.cjs'), 'utf8');

const columnsOf = (text, table) => {
  const m = text.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\s*\\);`));
  assert.ok(m, `${table} is defined`);
  return m[1].split('\n').map((l) => l.replace(/--.*$/, '').trim()).filter(Boolean)
    .map((l) => l.replace(/,$/, '').replace(/\s+/g, ' '));
};

for (const table of ['toolings', 'tooling_drawings', 'tooling_openings', 'tooling_combinations', 'die_tooling_links']) {
  test(`${table} has the same columns in init.sql and db.cjs`, () => {
    assert.deepEqual(columnsOf(dbCjs, table), columnsOf(initSql, table));
  });
}

test('toolings.status and die_tooling_links.kind are constrained', () => {
  const cols = columnsOf(initSql, 'toolings');
  assert.ok(cols.some((c) => c.startsWith('status TEXT NOT NULL DEFAULT \'active\' CHECK')));
  assert.ok(columnsOf(initSql, 'die_tooling_links').some((c) => c.includes("CHECK (kind IN ('insert', 'bolster', 'unknown'))")));
});

test('tooling_openings carries drawing_id and extraction_note in both files and as ALTERs', () => {
  for (const text of [initSql, dbCjs]) {
    const cols = columnsOf(text, 'tooling_openings');
    assert.ok(cols.some((c) => c.startsWith('drawing_id INTEGER REFERENCES tooling_drawings(id)')));
    assert.ok(cols.includes('extraction_note TEXT'));
  }
  assert.ok(dbCjs.includes('ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS drawing_id'));
  assert.ok(dbCjs.includes('ALTER TABLE tooling_openings ADD COLUMN IF NOT EXISTS extraction_note'));
});

test('tooling_drawings is created before tooling_openings in both files', () => {
  for (const text of [initSql, dbCjs]) {
    const a = text.indexOf('CREATE TABLE IF NOT EXISTS tooling_drawings');
    const b = text.indexOf('CREATE TABLE IF NOT EXISTS tooling_openings');
    assert.ok(a >= 0 && b >= 0 && a < b);
  }
});
