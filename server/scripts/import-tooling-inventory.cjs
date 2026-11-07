'use strict';
// Loads the die shop's tooling inventory workbooks into the toolings table.
//   node server/scripts/import-tooling-inventory.cjs --gex2 <Tooling Inventory-2025.xlsx>
//        --gex1-inserts <Tooling inventory-27.12 2024.xlsx> --gex1-bolsters <Bolster Inventory(P2-P6).xlsx> [--dry-run]
// Any subset of the three file flags may be given. Upserts by canonical number in one
// transaction; never deletes and never changes the status of an existing row.
const path = require('path');
const XLSX = require('xlsx');
const inv = require('../services/toolingInventory.cjs');

const GEX2_SHEETS = ['35MN PRESS ', '25MN PRESS'];
const GEX1_INSERT_SHEET = 'Tooling inventoy 27.12.2024'; // sic
const GEX1_BOLSTER_SHEET = 'ALL BOLSTER';

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

function sheetRows(wb, name, file) {
  const ws = wb.Sheets[name];
  if (!ws) { console.error(`Sheet "${name}" not found in ${file}. Sheets: ${wb.SheetNames.join(', ')}`); process.exit(1); }
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const gex2 = flag('--gex2');
  const gex1Inserts = flag('--gex1-inserts');
  const gex1Bolsters = flag('--gex1-bolsters');
  if (!gex2 && !gex1Inserts && !gex1Bolsters) {
    console.error('Usage: node server/scripts/import-tooling-inventory.cjs [--gex2 <file>] [--gex1-inserts <file>] [--gex1-bolsters <file>] [--dry-run]');
    process.exit(1);
  }

  const sources = []; // { label, rows, skipped }
  if (gex2) {
    const wb = XLSX.readFile(path.resolve(gex2));
    const skipped = [];
    const rows = inv.mergeToolingRows(GEX2_SHEETS.flatMap((name) =>
      inv.parseGex2InventorySheet(sheetRows(wb, name, gex2), { sheetName: name, onSkip: (s) => skipped.push(s) })));
    sources.push({ label: 'GEX-2 inventory-2025', rows, skipped });
  }
  if (gex1Inserts) {
    const wb = XLSX.readFile(path.resolve(gex1Inserts));
    const skipped = [];
    const rows = inv.parseGex1InsertSheet(sheetRows(wb, GEX1_INSERT_SHEET, gex1Inserts), { onSkip: (s) => skipped.push(s) });
    sources.push({ label: 'GEX-1 inserts inventory-2024-12', rows, skipped });
  }
  if (gex1Bolsters) {
    const wb = XLSX.readFile(path.resolve(gex1Bolsters));
    const skipped = [];
    const rows = inv.parseGex1BolsterSheet(sheetRows(wb, GEX1_BOLSTER_SHEET, gex1Bolsters), { onSkip: (s) => skipped.push(s) });
    sources.push({ label: 'GEX-1 bolsters P2-P6', rows, skipped });
  }

  console.log(`Tooling inventory import ${dryRun ? '(DRY RUN, nothing written)' : '(LIVE)'}`);

  let pool = null;
  let existing = new Set();
  if (!dryRun) {
    ({ pool } = require('../db.cjs')); // only opened for a live run
    const res = await pool.query('SELECT number FROM toolings');
    existing = new Set(res.rows.map((r) => r.number));
  }

  const seen = new Set(existing);
  for (const s of sources) {
    const counts = {};
    let fresh = 0;
    for (const r of s.rows) {
      const k = `${r.plant} ${r.kind}`;
      counts[k] = (counts[k] || 0) + 1;
      if (!seen.has(r.number)) { fresh++; seen.add(r.number); }
    }
    console.log(`\n${s.label}: parsed ${s.rows.length}` + (dryRun ? '' : `, new ${fresh}, updated ${s.rows.length - fresh}`));
    for (const [k, n] of Object.entries(counts)) console.log(`  ${k}: ${n}`);
    console.log(`  skipped: ${s.skipped.length}`);
    for (const k of s.skipped) console.log(`    ${k.sheet} row ${k.row}: "${k.raw}" (${k.reason})`);
  }

  if (dryRun) { console.log('\nDry run, no changes were written.'); return; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of sources) {
      for (const r of s.rows) {
        const { sql, params } = inv.buildToolingUpsert(r);
        await client.query(sql, params);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log('\nImport committed.');
}

main().catch((e) => { console.error(e); process.exit(1); });
