import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards the fix for a bug that was live in every date-stamping path in the app.
//
// `new Date().toISOString()` asks "what is today" and answers in UTC. This app
// runs Asia/Dubai (UTC+4), so between midnight and 4am it returns yesterday:
// audit entries filed under the wrong day, date fields pre-filled a day early,
// a validator rejecting the real today as being in the future. The fix is
// todayLocal() — src/utils/today.js on the frontend, server/services/dates.cjs
// on the backend.
//
// This test bans the "now" form only. Converting an EXISTING Date to its ISO
// day is a different question and is deliberately untouched: parseExcelDate
// builds its Date from a UTC-anchored epoch, so toISOString() is the correct
// reading there, and rewriting it would shift every imported date by a day.
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const SCAN = ['src', 'server'];

// `new Date()` with no argument, immediately serialised to an ISO day.
const BANNED = /new Date\(\)\s*\.toISOString\(\)\s*\.(?:split\('T'\)\[0\]|slice\(0,\s*10\))/;

// Cosmetic stamps in an export filename or a report footer. Reviewed and
// deliberately left as UTC: they name a file or print a footer, and none of
// them is stored, compared, or validated against.
const ALLOWED = new Set([
  'src/pages/FrozenDesignsPage.jsx',
  'src/pages/QDTrackerPage.jsx',
  'src/utils/exportExcel.js',
  'server/services/supplierReportPdf.cjs',
]);

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|jsx|cjs)$/.test(entry)) out.push(full);
  }
  return out;
};

test('no source file derives today from the UTC day', () => {
  const offenders = [];
  for (const dir of SCAN) {
    for (const file of walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        // Comments naming the banned pattern are how the two helpers explain
        // themselves; only real code counts.
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) return;
        if (BANNED.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Use todayLocal() instead of new Date().toISOString() for the current day:\n  ${offenders.join('\n  ')}`
  );
});
