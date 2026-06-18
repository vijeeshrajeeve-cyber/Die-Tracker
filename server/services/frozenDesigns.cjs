'use strict';

function extractProfileFromDie(dieNo) {
  if (dieNo === null || dieNo === undefined) return null;
  const cleaned = String(dieNo).trim().split('-')[0].replace(/^0+/, '');
  return cleaned || null;
}

function hasFullKey({ profile, plant, press, cavity }) {
  return Boolean(profile) && Boolean(plant) && Boolean(press) &&
    cavity !== null && cavity !== undefined && cavity !== '';
}

async function findActiveMatch(client, { profile, plant, press, cavity }) {
  if (!hasFullKey({ profile, plant, press, cavity })) return null;
  const { rows } = await client.query(
    `SELECT * FROM frozen_designs
       WHERE profile_number = $1 AND plant = $2 AND press = $3 AND cavity = $4
         AND is_active = true
       LIMIT 1`,
    [profile, plant, press, Math.round(Number(cavity))]
  );
  return rows[0] || null;
}

module.exports = { extractProfileFromDie, hasFullKey, findActiveMatch };
