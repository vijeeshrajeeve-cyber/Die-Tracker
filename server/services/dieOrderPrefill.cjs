'use strict';
const { normalizePlant } = require('./frozenDesigns.cjs');

// The die list writes press as 'M_PRESS.2'; requests and the presses master say
// 'PRESS 2'. The trailing integer is all the two spellings share.
function pressNumber(raw) {
  const m = String(raw == null ? '' : raw).match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

// extractProfileFromDie hands us a zero-stripped profile ('1001'), but the die
// list stores IDProfile verbatim ('01001') for 6,280 of 44,669 dies. Stripping
// both sides is lossless: all 20,916 distinct profiles stay distinct.
function stripProfile(raw) {
  return String(raw == null ? '' : raw).trim().replace(/^0+/, '');
}

// Plant is filtered in JS rather than SQL so the tested normalizePlant helper
// stays the single definition of 'GEX 01' === 'GEX 1'. A profile+press+cavity
// group holds a handful of dies, so the LIMIT is never the binding constraint.
function pickForPlant(rows, plant) {
  const want = normalizePlant(plant);
  if (!want) return rows[0] || null;
  return rows.find((r) => normalizePlant(r.plant) === want) || null;
}

// The die list stores the press as a canonical press_name and the cavity as an
// integer, both resolved at import — see services/dieListImport.cjs. That is
// what lets one query serve two plants whose exports share no column names.
async function findDieListMatch(client, { plant, profile, press, cavity }) {
  const prof = stripProfile(profile);
  const pressName = String(press == null ? '' : press).trim();
  const cav = (cavity === null || cavity === undefined || cavity === '' || !Number.isFinite(Number(cavity)))
    ? null
    : Math.round(Number(cavity));
  if (!prof || !pressName || cav === null) return null;

  const { rows } = await client.query(
    `SELECT die_no, plant, die_size, die_type, bolster_no, supplier
     FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND upper(trim(press)) = upper(trim($2))
       AND cavity = $3
     ORDER BY substring(die_no from '[-_]([0-9]+)$')::int DESC NULLS LAST
     LIMIT 50`,
    [prof, pressName, cav]
  );
  return pickForPlant(rows, plant);
}

// die_orders.press is populated on 6 of 659 rows and die_orders.cavity on 7, so
// press is derived from the die_no suffix instead ('18114-407' -> press 4). That
// rule was verified against the die list, where both are known: it holds for
// 43,662 of 44,667 dies. The 3-digit guard excludes GEX 2's 4-digit '-2502'
// suffixes, which encode the P25/P35 press codes rather than a press number.
async function findRecentOrderMatch(client, { plant, profile, press }) {
  const prof = stripProfile(profile);
  const pressNo = pressNumber(press);
  if (!prof || pressNo === null) return null;

  const { rows } = await client.query(
    `SELECT die_no, plant, die_size, supplier, ordered_date
     FROM die_orders
     WHERE ordered_date IS NOT NULL
       AND regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND split_part(die_no, '-', 2) ~ '^[0-9]{3}$'
       AND left(split_part(die_no, '-', 2), 1)::int = $2
     ORDER BY ordered_date DESC
     LIMIT 50`,
    [prof, pressNo]
  );
  return pickForPlant(rows, plant);
}

module.exports = { pressNumber, stripProfile, findDieListMatch, findRecentOrderMatch };
