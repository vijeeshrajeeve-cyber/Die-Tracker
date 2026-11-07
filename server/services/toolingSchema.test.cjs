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

for (const table of ['toolings', 'tooling_openings', 'tooling_combinations', 'die_tooling_links']) {
  test(`${table} has the same columns in init.sql and db.cjs`, () => {
    assert.deepEqual(columnsOf(dbCjs, table), columnsOf(initSql, table));
  });
}

test('toolings.status and die_tooling_links.kind are constrained', () => {
  const cols = columnsOf(initSql, 'toolings');
  assert.ok(cols.some((c) => c.startsWith('status TEXT NOT NULL DEFAULT \'active\' CHECK')));
  assert.ok(columnsOf(initSql, 'die_tooling_links').some((c) => c.includes("CHECK (kind IN ('insert', 'bolster', 'unknown'))")));
});
