'use strict';
// Builds die_tooling_links (source 'die-list') from the IDBolster values already stored in
// existing_die_details.bolster_no.
//   node server/scripts/backfill-die-tooling-links.cjs [--plant "GEX 1"] [--dry-run]
// Replaces only the die-list links of each plant processed. A dry run still reads the
// database but writes nothing.
const { normalizePlant } = require('../services/frozenDesigns.cjs');
const {
  loadKnownToolings, linksFromDieList, replaceDieListLinks,
} = require('../services/dieToolingLinks.cjs');

function flag(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyPlantRaw = flag('--plant');
  const onlyPlant = onlyPlantRaw ? normalizePlant(onlyPlantRaw) : null;

  const { pool } = require('../db.cjs'); // lazy: only needed once we run
  try {
    console.log(`Die-tooling links backfill ${dryRun ? '(DRY RUN, nothing written)' : '(LIVE)'}`);
    const known = await loadKnownToolings(pool);
    console.log(`Master: ${known.inserts.size} inserts, ${known.bolsters.size} bolsters`);

    const res = await pool.query(
      "SELECT die_no, plant, bolster_no FROM existing_die_details WHERE bolster_no IS NOT NULL AND btrim(bolster_no) <> ''");
    const byPlant = new Map();
    for (const r of res.rows) {
      const plant = normalizePlant(r.plant);
      if (onlyPlant && plant !== onlyPlant) continue;
      if (!byPlant.has(plant)) byPlant.set(plant, []);
      byPlant.get(plant).push({ dieNo: r.die_no, plant, bolsterNo: r.bolster_no });
    }
    if (byPlant.size === 0) console.log('No rows with a bolster_no for the selected plant(s).');

    for (const [plant, rows] of byPlant) {
      const links = linksFromDieList(rows, known);
      const counts = { insert: 0, bolster: 0, unknown: 0 };
      const unknownRaw = new Map();
      for (const l of links) {
        counts[l.kind]++;
        if (l.kind === 'unknown') unknownRaw.set(l.raw_value, (unknownRaw.get(l.raw_value) || 0) + 1);
      }
      console.log(`\n${plant}: rows read ${rows.length}, links ${links.length}`);
      console.log(`  insert: ${counts.insert}, bolster: ${counts.bolster}, unknown: ${counts.unknown}`);
      const top = [...unknownRaw.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 20);
      console.log(`  top unknown raw values (${unknownRaw.size} distinct):`);
      for (const [raw, n] of top) console.log(`    ${n}\t${JSON.stringify(raw)}`);

      if (!dryRun) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const written = await replaceDieListLinks(client, plant, links);
          await client.query('COMMIT');
          console.log(`  written: ${written}`);
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      }
    }
    console.log(dryRun ? '\nDry run, no changes were written.' : '\nBackfill committed.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
