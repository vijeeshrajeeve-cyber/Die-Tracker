'use strict';
// Turns the die list's free-text IDBolster value into typed die_tooling_links rows.
const { resolveToolingRef } = require('./toolingNumbers.cjs');
const { normalizePlant } = require('./frozenDesigns.cjs');

const SOURCE = 'die-list';
const ORDER_SOURCE = 'order-pdf';
const BATCH = 1000; // 6 params per row, well under Postgres' 65535 cap

async function loadKnownToolings(client) {
  const res = await client.query('SELECT number, kind FROM toolings');
  const known = { inserts: new Set(), bolsters: new Set() };
  for (const r of res.rows) {
    if (r.kind === 'insert') known.inserts.add(r.number);
    else if (r.kind === 'bolster') known.bolsters.add(r.number);
  }
  return known;
}

function linksFromDieList(rows, known) {
  const links = [];
  for (const row of rows) {
    const raw = row.bolsterNo == null ? '' : String(row.bolsterNo).trim();
    if (!raw || !row.dieNo) continue;
    const ref = resolveToolingRef(raw, known);
    links.push({
      die_no: row.dieNo,
      plant: normalizePlant(row.plant),
      tooling_number: ref.toolingNumber,
      kind: ref.kind,
      raw_value: raw,
      source: SOURCE,
    });
  }
  return links;
}

async function insertDieListLinks(client, links) {
  let inserted = 0;
  for (let start = 0; start < links.length; start += BATCH) {
    const batch = links.slice(start, start + BATCH);
    const params = [];
    const placeholders = batch.map((l, i) => {
      params.push(l.die_no, l.plant, l.tooling_number, l.kind, l.raw_value, l.source);
      const b = i * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    }).join(', ');
    const res = await client.query(
      `INSERT INTO die_tooling_links (die_no, plant, tooling_number, kind, raw_value, source) VALUES ${placeholders}`,
      params,
    );
    inserted += res.rowCount;
  }
  return inserted;
}

async function replaceDieListLinks(client, plant, links) {
  await client.query("DELETE FROM die_tooling_links WHERE source = 'die-list' AND plant = $1", [plant]);
  return insertDieListLinks(client, links);
}

// Records the INSERT No / BOLSTER No printed on a die order form for one die,
// replacing only that die's earlier order-pdf links.
async function recordOrderToolingLinks(client, { dieNo, plant, insertNo, bolsterNo }) {
  const raws = [insertNo, bolsterNo]
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter(Boolean);
  const die = dieNo == null ? '' : String(dieNo).trim();
  if (!raws.length || !die) return [];
  const known = await loadKnownToolings(client);
  const normPlant = normalizePlant(plant);
  const links = raws.map((raw) => {
    const ref = resolveToolingRef(raw, known);
    return { die_no: die, plant: normPlant, tooling_number: ref.toolingNumber, kind: ref.kind, raw_value: raw, source: ORDER_SOURCE };
  });
  await client.query("DELETE FROM die_tooling_links WHERE source = 'order-pdf' AND die_no = $1", [die]);
  await insertDieListLinks(client, links);
  return links;
}

module.exports = { loadKnownToolings, linksFromDieList, replaceDieListLinks, insertDieListLinks, recordOrderToolingLinks };
