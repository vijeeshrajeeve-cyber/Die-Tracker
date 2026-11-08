'use strict';
// Converts the scoped DWG drawings of the archive to DXF with AutoCAD's accoreconsole.
//   node server/scripts/convert-dwg-to-dxf.cjs [--archive <root>] [--dxf-dir <dir>] [--accoreconsole <exe>]
//        [--concurrency 3] [--limit N] [--dry-run]
// DXFs mirror the archive paths under --dxf-dir; ones already newer than their DWG are skipped, so the
// script is safe to re-run. Writes <dxf-dir>/conversion-report.json. Failures do not change the exit code.
const fs = require('node:fs');
const path = require('node:path');
const { listArchiveDrawings, SCOPED_FOLDERS } = require('../services/archiveMatcher.cjs');
const { DEFAULT_ACCORECONSOLE, planConversions, convertAll } = require('../services/dwgConvert.cjs');

const DEFAULT_ARCHIVE = 'C:\\Users\\vijee\\Desktop\\18.06.2026\\New folder\\14.Die Toolings';
const DEFAULT_DXF_DIR = 'C:\\Users\\vijee\\Desktop\\18.06.2026\\tooling-dxf';

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const archive = path.resolve(flag('--archive') || DEFAULT_ARCHIVE);
  const dxfRoot = path.resolve(flag('--dxf-dir') || DEFAULT_DXF_DIR);
  const exe = flag('--accoreconsole') || DEFAULT_ACCORECONSOLE;
  const concurrency = Number(flag('--concurrency') || 3);
  const limit = flag('--limit') ? Number(flag('--limit')) : null;
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(archive)) { console.error(`Archive root not found: ${archive}`); process.exit(1); }
  if (!fs.existsSync(exe)) { console.error(`accoreconsole.exe not found: ${exe}`); process.exit(1); }

  const dwgs = listArchiveDrawings(archive).filter((f) => f.ext === 'dwg');
  const plan = planConversions(dwgs, dxfRoot, (p) => fs.statSync(p));
  const todo = limit != null ? plan.todo.slice(0, limit) : plan.todo;

  // Counts per scoped folder (longest matching prefix wins; '' is the root-level files).
  const prefixes = SCOPED_FOLDERS.map((f) => f.prefix).sort((a, b) => b.length - a.length);
  const folderOf = (f) => {
    const rel = f.relPath.toLowerCase();
    return prefixes.find((p) => p && rel.startsWith(`${p.toLowerCase()}/`)) ?? '';
  };
  const counts = new Map();
  const todoSet = new Set(plan.todo);
  for (const f of dwgs) {
    const p = folderOf(f);
    const c = counts.get(p) || { todo: 0, done: 0 };
    c[todoSet.has(f) ? 'todo' : 'done']++;
    counts.set(p, c);
  }

  console.log(`DWG to DXF conversion ${dryRun ? '(DRY RUN, nothing converted)' : '(LIVE)'}`);
  console.log(`Archive: ${archive}\nDXF dir: ${dxfRoot}\nTool:    ${exe}`);
  console.log(`\nScoped DWGs: ${dwgs.length}  to convert: ${plan.todo.length}  already up to date: ${plan.done}`);
  for (const [p, c] of [...counts].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`  ${p || '(archive root)'}: todo ${c.todo}, done ${c.done}`);
  }
  if (limit != null) console.log(`\n--limit ${limit}: converting ${todo.length} of ${plan.todo.length}`);
  if (dryRun) { console.log('\nDry run, no files were converted.'); return; }

  fs.mkdirSync(dxfRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  const result = await convertAll(todo, dxfRoot, {
    exe, concurrency, skipped: plan.done,
    onProgress: ({ done, total, failed }) => {
      if (done % 25 === 0 || done === total) console.log(`${done - failed}/${total} converted, failed ${failed}`);
    },
  });
  const reportFile = path.join(dxfRoot, 'conversion-report.json');
  const report = {
    startedAt, finishedAt: new Date().toISOString(), archiveRoot: archive, dxfRoot,
    converted: result.converted, skipped: result.skipped, failed: result.failed,
  };
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\nConverted ${result.converted}, skipped ${result.skipped}, failed ${result.failed.length}. Report: ${reportFile}`);
  for (const f of result.failed) console.log(`  FAILED ${f.relPath}: ${f.error}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
