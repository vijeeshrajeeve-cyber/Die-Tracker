'use strict';
// One-off importer for the historical Sample Followup Excel sheet.
//   node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run] [--report <path>]
// The sheet path must come first. Updates only the five sample fields on
// matching die_orders; never creates orders, never deletes, never clears a
// value the sheet leaves blank.
// Design: docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');
const imp = require('../services/sampleFollowupImport.cjs');

const ORDER_QUERY = `
  SELECT id, die_no, plant, supplier, status,
         die_received_date::text    AS die_received_date,
         submission_date::text      AS submission_date,
         sample_approval_date::text AS sample_approval_date,
         no_of_trial, corrector, sample_status
    FROM die_orders
`;

function describe(entry) {
  const before = entry.before;
  return Object.entries(entry.updates)
    .map(([col, next]) => {
      const current = before[col];
      const shown = current == null || String(current).trim() === '' ? '(empty)' : current;
      return `      ${col}: ${shown} → ${next}`;
    })
    .join('\n');
}

function renderReport(plan, { file, dryRun }) {
  const out = [];
  out.push(`Sample Followup import ${dryRun ? '(DRY RUN — nothing written)' : '(LIVE)'}`);
  out.push(`Sheet: ${file}`);
  out.push(`Run:   ${new Date().toISOString()}`);
  out.push('');

  out.push(`== 1. Matched and changing (${plan.updates.length}) ==`);
  for (const e of plan.updates) {
    out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);
    out.push(describe(e));
  }

  const fieldCounts = {};
  for (const e of plan.updates) {
    for (const col of Object.keys(e.updates)) fieldCounts[col] = (fieldCounts[col] || 0) + 1;
  }
  out.push('');
  out.push('  changes per field:');
  for (const [col, n] of Object.entries(fieldCounts).sort()) out.push(`    ${col}: ${n}`);

  out.push('');
  out.push(`== 2. Matched, already correct (${plan.noop.length}) ==`);
  for (const e of plan.noop) out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);

  out.push('');
  out.push(`== 3. Not found in the app — SKIPPED (${plan.notFound.length}) ==`);
  for (const e of plan.notFound) out.push(`  row ${e.sheetRow}  ${e.die}`);

  out.push('');
  out.push(`== 4. Ambiguous — SKIPPED (${plan.ambiguous.length}) ==`);
  for (const e of plan.ambiguous) out.push(`  row ${e.sheetRow}  ${e.die}  ${e.reason}  orders: ${e.orderIds.join(', ')}`);

  out.push('');
  out.push(`== 5. Data warnings (${plan.warnings.length}) ==`);
  for (const w of plan.warnings) out.push(`  ${w}`);

  out.push('');
  out.push(`Totals: ${plan.updates.length} to update, ${plan.noop.length} unchanged, `
         + `${plan.notFound.length} not found, ${plan.ambiguous.length} ambiguous, `
         + `${plan.warnings.length} warnings.`);
  return out.join('\n');
}

async function apply(plan) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const entry of plan.updates) {
      const cols = Object.keys(entry.updates).filter((c) => imp.WRITABLE_COLUMNS.has(c));
      if (cols.length === 0) continue;
      const sets = cols.map((c, i) => `${c} = $${i + 1}`);
      const params = cols.map((c) => entry.updates[c]);
      params.push(entry.orderId);
      await client.query(
        `UPDATE die_orders SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${params.length}`,
        params,
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  const reportFlag = process.argv.indexOf('--report');
  const explicitReport = reportFlag > -1 ? process.argv[reportFlag + 1] : null;
  if (!file || file.startsWith('--')) {
    console.error('Usage: node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run] [--report <path>]');
    console.error('The sheet path must be the first argument.');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(file));
  const sheetName = wb.SheetNames.includes('Sample Followup') ? 'Sample Followup' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });

  const orders = (await pool.query(ORDER_QUERY)).rows;
  const plan = imp.buildImportPlan({ rows, orders });

  const report = renderReport(plan, { file, dryRun });
  console.log(report);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.resolve(
    explicitReport || `sample-followup-import-${dryRun ? 'dryrun-' : ''}${stamp}.txt`,
  );
  fs.writeFileSync(reportPath, report + '\n', 'utf8');
  console.log(`\nReport written to ${reportPath}`);

  if (dryRun) {
    console.log('Dry run — no changes were written.');
  } else {
    await apply(plan);
    console.log(`Applied ${plan.updates.length} updates.`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
