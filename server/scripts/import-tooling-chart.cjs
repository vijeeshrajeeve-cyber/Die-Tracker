'use strict';
// Loads the press combination chart into tooling_combinations.
//   node server/scripts/import-tooling-chart.cjs <workbook.xlsx> [--dry-run]
// Always reads the "14 Inch" sheet (the authoritative chart) and replaces only rows
// carrying this script's own source_sheet; idempotent. A live run that parsed 0 rows
// is refused, so a wrong workbook can never wipe the chart.
const path = require('path');
const XLSX = require('xlsx');
const chart = require('../services/toolingChart.cjs');

const SOURCE_SHEET = '2014/14 Inch';
const EXCLUDE = [9];

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const sheetName = '14 Inch';
  if (!file || file.startsWith('--')) {
    console.error('Usage: node server/scripts/import-tooling-chart.cjs <workbook.xlsx> [--dry-run]');
    process.exit(1);
  }
  const wb = XLSX.readFile(path.resolve(file));
  const ws = wb.Sheets[sheetName];
  if (!ws) { console.error(`Sheet "${sheetName}" not found. Sheets: ${wb.SheetNames.join(', ')}`); process.exit(1); }
  const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const skipped = [];
  const rows = chart.parseChartRows(sheetRows, { sourceSheet: SOURCE_SHEET, excludePresses: EXCLUDE, onSkip: (s) => skipped.push(s) });

  console.log(`Tooling chart import ${dryRun ? '(DRY RUN, nothing written)' : '(LIVE)'}`);
  console.log(`Workbook: ${file}  sheet: ${sheetName}  source_sheet: ${SOURCE_SHEET}`);
  const counts = {};
  for (const r of rows) counts[r.press] = (counts[r.press] || 0) + 1;
  console.log(`\nRows kept: ${rows.length}`);
  for (const p of Object.keys(counts).sort((a, b) => parseInt(a.slice(6), 10) - parseInt(b.slice(6), 10))) console.log(`  ${p}: ${counts[p]}`);
  const byReason = {};
  for (const s of skipped) { const k = `${s.press} (${s.reason})`; byReason[k] = (byReason[k] || 0) + 1; }
  console.log(`\nSkipped rows: ${skipped.length}`);
  for (const [k, n] of Object.entries(byReason)) console.log(`  ${k}: ${n}`);

  if (dryRun) { console.log('\nDry run, no changes were written.'); return; }
  if (rows.length === 0) {
    console.error('\nRefusing to replace the chart: 0 rows were parsed. Nothing was written.');
    process.exit(1);
  }

  const { pool } = require('../db.cjs'); // only opened for a live run
  const { statements } = chart.buildChartReplace(rows, SOURCE_SHEET);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const s of statements) await client.query(s.sql, s.params);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`\nReplaced ${SOURCE_SHEET}: inserted ${rows.length} rows.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
