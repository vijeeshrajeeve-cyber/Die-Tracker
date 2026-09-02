'use strict';
const { pressNumber, stripProfile } = require('./dieOrderPrefill.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');

// A die number is <profile>-<press number><2-digit sequence>: 29663-253 is
// press 2, sequence 53. The die list writes the same shape with an underscore
// (29663_213). Only 3-digit suffixes belong to the live sequence — GEX 2's
// legacy numbers (-3503) encode the P35 press code, not a press number, and
// that convention was retired in March 2026.
function parseSuffix(dieNo) {
  const parts = String(dieNo == null ? '' : dieNo).trim().split(/[-_]/);
  if (parts.length < 2) return null;
  return /^[0-9]{3}$/.test(parts[1]) ? Number(parts[1]) : null;
}

// Every candidate die for this profile and press, from all three places a die
// number can already exist. Plant is filtered in JS so the tested
// normalizePlant stays the single definition of 'GEX 01' === 'GEX 2'.
async function collectCandidates(client, prof, pressNo) {
  const dies = await client.query(
    `SELECT die_no, plant, raw_data->>'NumHoles' AS cavity FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND split_part(die_no, '_', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '_', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  const orders = await client.query(
    `SELECT die_no, plant FROM die_orders
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  const requests = await client.query(
    `SELECT die_no, plant FROM backup_die_requests
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2`,
    [prof, pressNo]
  );
  return [
    ...dies.rows.map((r) => ({ ...r, source: 'die' })),
    ...orders.rows.map((r) => ({ ...r, source: 'order' })),
    ...requests.rows.map((r) => ({ ...r, source: 'backup request' })),
  ];
}

async function nextDieNumber(client, { plant, profile, press }) {
  const prof = stripProfile(profile);
  const pressNo = pressNumber(press);
  if (!prof || pressNo === null) return null;

  const want = normalizePlant(plant);
  const rows = (await collectCandidates(client, prof, pressNo))
    .filter((r) => !want || normalizePlant(r.plant) === want);

  let highest = null;
  let basis = null;
  for (const row of rows) {
    const suffix = parseSuffix(row.die_no);
    if (suffix === null) continue;
    if (highest === null || suffix > highest) {
      highest = suffix;
      basis = { source: row.source, die_no: row.die_no };
    }
  }

  // Cavity comes from the newest DIE, which is not always the newest of the
  // three sources: die_orders.cavity is set on 7 of 659 rows, and a backup
  // request's cavity is only what someone typed. Cavity climbs as a design is
  // revised (10018 on press 2 runs 2 -> 3 -> 4), so the newest die is the one
  // that reflects the current design.
  let cavity = null;
  let cavityHighest = null;
  for (const row of rows) {
    if (row.source !== 'die') continue;
    const value = String(row.cavity == null ? '' : row.cavity).trim();
    if (!value) continue;
    const suffix = parseSuffix(row.die_no);
    if (suffix === null) continue;
    if (cavityHighest === null || suffix > cavityHighest) {
      cavityHighest = suffix;
      cavity = { value, die_no: row.die_no };
    }
  }

  // A profile with no history on this press starts the sequence at 01.
  const next = highest === null ? (pressNo * 100) + 1 : highest + 1;
  return { dieNo: `${prof}-${next}`, basis, cavity };
}

// The client-side duplicate check can hold every request and order in memory
// but not 44,669 dies, so this is the one check that has to be server-side.
async function dieNoExistsInDieList(client, dieNo) {
  const suffix = parseSuffix(dieNo);
  const prof = stripProfile(String(dieNo == null ? '' : dieNo).split(/[-_]/)[0]);
  if (!prof || suffix === null) return false;

  const { rows } = await client.query(
    `SELECT 1 FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND split_part(die_no, '_', 2) = $2
     LIMIT 1`,
    [prof, String(suffix)]
  );
  return rows.length > 0;
}

module.exports = { parseSuffix, nextDieNumber, dieNoExistsInDieList };
