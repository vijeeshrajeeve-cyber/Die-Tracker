'use strict';

// Data behind the J-file's "No. of Active Dies", "Extruded Volume on Active
// Dies" and "Previous suppliers" fields. Kept out of jFileTemplate.cjs, which
// is PDF coordinate work — these queries are logic worth testing without
// pdf-lib in the way.

// Mirrors SUPPLIER_ALIASES in src/utils/dieOrderPrefill.js. That module is ESM
// and cannot be required from CommonJS, so the map is duplicated deliberately —
// change both together.
const SUPPLIER_ALIASES = {
  'PHOEINIX': 'PHOENIX',
  'PHOENIX MIDDLE EAST': 'PHME',
  'GIANGSU': 'JIANGSU',
  'GIANSUN': 'JIANGSU',
  'JIANSU': 'JIANGSU',
};

// The form's table has ten rows.
const MAX_ACTIVE_DIES = 10;

// Prints the master's name where the die list uses a variant spelling, and the
// raw name otherwise — a supplier with no mapping is still a real supplier.
function canonicalSupplierName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) return null;
  return SUPPLIER_ALIASES[name.toUpperCase()] || name;
}

const stripProfile = (raw) => String(raw == null ? '' : raw).trim().replace(/^0+/, '');

// The die list writes 29663_603, an order writes 29663-603, and a padded order
// writes 029663-603 — all the same physical die.
function dieKey(dieNo) {
  const parts = String(dieNo == null ? '' : dieNo).trim().split(/[-_]/);
  if (parts.length < 2) return stripProfile(parts[0]).toUpperCase();
  return `${stripProfile(parts[0])}-${parts[1]}`.toUpperCase();
}

function queryDieListActive(pool, prof) {
  return pool.query(
    `SELECT die_no,
            raw_data->>'Tonnage'      AS tonnage,
            raw_data->>'NameSupplier' AS supplier
     FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND upper(COALESCE(raw_data->>'DieStatus', '')) NOT IN ('SCRAPPED', 'HOLD')
     ORDER BY die_no`,
    [prof]
  );
}

function queryOrdersInProcess(pool, prof) {
  return pool.query(
    `SELECT die_no, supplier, status
     FROM die_orders
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND upper(COALESCE(status, '')) NOT IN ('HOLD', 'CANCELLED')
     ORDER BY die_no`,
    [prof]
  );
}

// Deliberately unfiltered by status: a die since scrapped was still bought from
// someone, and "Previous suppliers" is a purchase history.
function queryDieListSuppliers(pool, prof) {
  return pool.query(
    `SELECT DISTINCT raw_data->>'NameSupplier' AS supplier
     FROM existing_die_details
     WHERE regexp_replace(profile_number, '^0+', '') = $1
       AND NULLIF(raw_data->>'NameSupplier', '') IS NOT NULL`,
    [prof]
  );
}

function queryOrderSuppliers(pool, prof) {
  return pool.query(
    `SELECT DISTINCT supplier
     FROM die_orders
     WHERE regexp_replace(split_part(die_no, '-', 1), '^0+', '') = $1
       AND NULLIF(supplier, '') IS NOT NULL`,
    [prof]
  );
}

/**
 * Gather the J-file's per-profile data.
 *
 * @param {object} pool           pg Pool (or any { query })
 * @param {string} profileOrDie   '29663' or '29663-252'
 * @returns {Promise<{activeDies: {die_no: string, supplier: string|null, tonnage: number|null}[],
 *                    prevSuppliers: string[]}>}
 */
async function collectJFileData(pool, profileOrDie) {
  const prof = stripProfile(String(profileOrDie == null ? '' : profileOrDie).split('-')[0]);
  if (!prof) return { activeDies: [], prevSuppliers: [] };

  const [dieRes, orderRes, dieSupRes, orderSupRes] = await Promise.all([
    queryDieListActive(pool, prof),
    queryOrdersInProcess(pool, prof),
    queryDieListSuppliers(pool, prof),
    queryOrderSuppliers(pool, prof),
  ]);

  const toTonnage = (value) => {
    const text = String(value == null ? '' : value).trim();
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  };

  const activeDies = dieRes.rows.map((r) => ({
    die_no: r.die_no,
    supplier: canonicalSupplierName(r.supplier),
    tonnage: toTonnage(r.tonnage),
  }));

  // An order earns a row only when the die list has never heard of it. The list
  // is a periodic export, so anything ordered since it was taken is missing —
  // but a die it already carries (often as IN ORDER) must not appear twice.
  const seen = new Set(dieRes.rows.map((r) => dieKey(r.die_no)));
  for (const r of orderRes.rows) {
    if (!r.die_no) continue;
    const key = dieKey(r.die_no);
    if (seen.has(key)) continue;
    seen.add(key);
    activeDies.push({ die_no: r.die_no, supplier: canonicalSupplierName(r.supplier), tonnage: null });
  }

  const prevSuppliers = [...new Map(
    [...dieSupRes.rows, ...orderSupRes.rows]
      .map((r) => canonicalSupplierName(r.supplier))
      .filter(Boolean)
      .map((name) => [name.toUpperCase(), name])
  ).values()].sort((a, b) => a.localeCompare(b));

  return { activeDies: activeDies.slice(0, MAX_ACTIVE_DIES), prevSuppliers };
}

module.exports = { collectJFileData, canonicalSupplierName, dieKey, SUPPLIER_ALIASES, MAX_ACTIVE_DIES };
