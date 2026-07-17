'use strict';
// One-off importer for the historical QD Excel sheet.
//   node server/scripts/import-qd-sheet.cjs <path-to-sheet.xlsx> [--dry-run]
// Idempotent: skips any QD NO that already exists.
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../db.cjs');
const qd = require('../services/qualityDiscrepancies.cjs');

// Excel serial date (1900 system) → 'YYYY-MM-DD'
function excelDate(serial) {
  if (serial === '' || serial === null || serial === undefined) return null;
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = Math.round((n - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

const norm = (v) => String(v == null ? '' : v).trim();
// The sheet writes plants as 'GEX-1' / 'Gex-2'; the app uses 'GEX 1' / 'GEX 2'.
const normPlant = (v) => norm(v).toUpperCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
const clean = (v) => norm(v).replace(/\r\n/g, '\n');
// Column headers in the sheet carry stray trailing spaces — read both forms.
const col = (row, name) => row[name] ?? row[`${name} `] ?? '';

async function main() {
  const file = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!file) {
    console.error('Usage: node server/scripts/import-qd-sheet.cjs <sheet.xlsx> [--dry-run]');
    process.exit(1);
  }
  const wb = XLSX.readFile(path.resolve(file));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  let created = 0;
  let skipped = 0;
  for (const r of rows) {
    const qdNo = norm(col(r, 'QD NO'));
    const dieNo = norm(col(r, 'Die no'));
    if (!qdNo || !dieNo) { skipped++; continue; }

    if (!dryRun) {
      const exists = await pool.query('SELECT id FROM quality_discrepancies WHERE qd_no = $1', [qdNo]);
      if (exists.rowCount) { console.log(`skip ${qdNo} (already imported)`); skipped++; continue; }
    }

    const issueText = clean(col(r, 'Quality Issue')) || 'Quality discrepancy raised';
    const remarks = clean(col(r, 'Remarks'));
    const status = qd.mapSheetStatus(col(r, 'Status'));
    const raised = excelDate(col(r, 'Date'));
    if (!raised) { console.log(`skip ${qdNo} (unparseable date)`); skipped++; continue; }

    const record = {
      qdNo,
      dieNo,
      raisedDate: raised,
      plant: normPlant(col(r, 'Plant')) || 'GEX 2',
      supplier: norm(col(r, 'Supplier')) || 'Unknown',
      corrector: norm(col(r, 'Corrector')) || null,
      status,
      issueSummary: issueText.split('\n')[0].slice(0, 160),
      // Remarks carry the follow-up narrative — keep them with the issue detail.
      issueDetail: remarks ? `${issueText}\n\n${remarks}` : issueText,
      etaDate: excelDate(col(r, 'ETA Date')),
      closedAt: status === 'Closed' ? (excelDate(col(r, 'Die received')) || raised) : null,
    };

    if (dryRun) {
      console.log(`would create ${qdNo}: ${JSON.stringify({
        die: record.dieNo, raised: record.raisedDate, plant: record.plant,
        supplier: record.supplier, corrector: record.corrector, status: record.status,
        eta: record.etaDate, closed: record.closedAt, summary: record.issueSummary.slice(0, 60) + '…',
      }, null, 2)}`);
      created++;
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const id = await qd.createQD(client, record);
      await qd.addActivity(client, {
        qdId: id,
        actor: record.corrector || 'Engineering',
        action: `raised QD against die ${dieNo}`,
        icon: 'flag',
        tone: 'flag',
        occurredAt: `${raised} 00:00:00`,
      });
      await client.query('COMMIT');
      console.log(`created ${qdNo} (${status})`);
      created++;
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`FAILED ${qdNo}:`, e.message);
    } finally {
      client.release();
    }
  }
  console.log(`\nDone. created=${created} skipped=${skipped}${dryRun ? ' (dry run)' : ''}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
