'use strict';
// One-off importer for the historical Sample Followup Excel sheet.
//   node server/scripts/import-sample-followup-sheet.cjs <sheet.xlsx> [--dry-run] [--report <path>]
// The sheet path must come first. Fills only blank sample fields on matching
// die_orders and moves sample_status forward; never replaces an existing value,
// creates orders, deletes, or clears a value the sheet leaves blank.
// Design: docs/superpowers/specs/2026-08-03-sample-followup-excel-import-design.md
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');
const imp = require('../services/sampleFollowupImport.cjs');

const ORDER_QUERY = `
  SELECT id, die_no, plant, supplier, status, type,
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

function renderReport(plan, { file, dryRun, missingColumns, ledger, skippedChecks }) {
  const out = [];
  out.push(`Sample Followup import ${dryRun ? '(DRY RUN — nothing written)' : '(LIVE)'}`);
  out.push(`Sheet: ${file}`);
  out.push(`Run:   ${new Date().toISOString()}`);
  if (missingColumns.length) out.push(`COLUMNS NOT FOUND, nothing read for these: ${missingColumns.join(', ')}`);
  for (const check of skippedChecks) out.push(`CHECK NOT RUN, this server has no ${check} table`);
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
  out.push(`== 6. Sheet differs from the app — KEPT THE APP VALUE (${plan.conflicts.length}) ==`);
  for (const e of plan.conflicts) {
    out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);
    for (const c of e.conflicts) out.push(`      ${c.col}: app ${c.current}, sheet ${c.sheet}`);
  }

  out.push('');
  out.push(`== 7. No die received date — saved, but not shown on Sample Followup (${plan.notReceived.length}) ==`);
  for (const e of plan.notReceived) out.push(`  row ${e.sheetRow}  ${e.die}  (order ${e.orderId})`);

  out.push('');
  out.push(`== 8. Corrector names the dropdown would not offer — shown as "not in list" (${plan.unknownCorrectors.length}) ==`);
  for (const c of plan.unknownCorrectors) out.push(`  ${c.name}  (${c.dies.length}): ${c.dies.join(', ')}`);

  out.push('');
  out.push(`== 9. Trials already logged — sheet count NOT saved (${plan.trialsIgnored.length}) ==`);
  for (const e of plan.trialsIgnored) out.push(`  row ${e.sheetRow}  ${e.die}  logged ${e.logged}, sheet ${e.sheet}`);

  out.push('');
  out.push(`== 10. Hand-added Sample Followup records — SKIPPED (${plan.standalone.length}) ==`);
  for (const e of plan.standalone) out.push(`  row ${e.sheetRow}  ${e.die}`);

  out.push('');
  out.push(`Totals: ${plan.updates.length} to update, ${plan.noop.length} unchanged, `
         + `${plan.notFound.length} not found, ${plan.ambiguous.length} ambiguous, `
         + `${plan.conflicts.length} differ, ${plan.warnings.length} warnings, `
         + `${ledger.length} marked as already reported in Daily Summary.`);
  return out.join('\n');
}

async function tableExists(name) {
  const { rows } = await pool.query('SELECT to_regclass($1) AS t', [`public.${name}`]);
  return rows[0].t !== null;
}

// Tables a server running older code may not have yet. Without one, the check
// that needs it cannot run, and the report says so.
async function loadChecks() {
  const skippedChecks = [];
  const correctors = await tableExists('correctors');
  if (!correctors) skippedChecks.push('correctors');
  const trials = await tableExists('sample_trials');
  if (!trials) skippedChecks.push('sample_trials');
  const standalone = await tableExists('sample_followups');
  if (!standalone) skippedChecks.push('sample_followups');
  const hasLedger = await tableExists('daily_report_ledger');
  return {
    skippedChecks,
    hasLedger,
    correctors: correctors
      ? (await pool.query('SELECT name, plant, is_active FROM correctors')).rows
      : undefined,
    loggedTrials: trials
      ? new Map((await pool.query(
        'SELECT die_order_id, count(*)::int AS n FROM sample_trials WHERE die_order_id IS NOT NULL GROUP BY 1',
      )).rows.map((r) => [r.die_order_id, r.n]))
      : undefined,
    standaloneProfiles: standalone
      ? new Set((await pool.query('SELECT profile FROM sample_followups')).rows
        .map((r) => imp.normalizeDieNo(r.profile)).filter(Boolean))
      : undefined,
  };
}

function localToday() {
  const now = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
}

async function apply(plan, ledger, today) {
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
    for (const row of ledger) {
      await client.query(
        `INSERT INTO daily_report_ledger (order_id, stage, stage_date, reported_on)
         VALUES ($1, $2, $3, $4) ON CONFLICT (order_id, stage) DO NOTHING`,
        [row.orderId, row.stage, row.stageDate, today],
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

  const { missing: missingColumns } = imp.checkColumns(rows);
  if (missingColumns.includes(imp.COLUMNS.die)) {
    console.error(`Sheet "${sheetName}" has no die number column. Nothing was read or written.`);
    process.exit(1);
  }

  const orders = (await pool.query(ORDER_QUERY)).rows;
  const { skippedChecks, hasLedger, correctors, loggedTrials, standaloneProfiles } = await loadChecks();
  const plan = imp.buildImportPlan({ rows, orders, correctors, loggedTrials, standaloneProfiles });
  const today = localToday();
  const ledger = hasLedger ? imp.ledgerRows(plan, today) : [];

  const report = renderReport(plan, { file, dryRun, missingColumns, ledger, skippedChecks });
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
    await apply(plan, ledger, today);
    console.log(`Applied ${plan.updates.length} updates.`);
  }

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
