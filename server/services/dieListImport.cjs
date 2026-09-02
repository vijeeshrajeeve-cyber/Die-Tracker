'use strict';

// Column aliases per field. normalizeKey() strips case and punctuation, so
// 'Die No', 'die_no' and 'DIE NO' collapse to one key — only genuinely
// different words need listing. The ID*/*Primary spellings are what the
// plants' own die-management system exports (e.g. the GEX-01 die list).
const DIE_NO_ALIASES = ['die no', 'die_no', 'die', 'die number', 'die number/name', 'die number name', 'iddie', 'die id'];
const PROFILE_ALIASES = ['profile', 'profile number', 'profile_number', 'idprofile', 'profile id'];
const CUSTOMER_ALIASES = ['customer', 'customer name', 'customer_name', 'party', 'client', 'idcustomer1', 'idcustomer'];
const PRESS_ALIASES = ['press', 'press name', 'press code', 'machine', 'pressprimary', 'primary press'];
const DIE_SIZE_ALIASES = ['die size', 'die_size', 'size', 'section size', 'profile size'];
const DIE_DIAM_ALIASES = ['diesdiam', 'die diam', 'die diameter', 'diameter'];
const THICKNESS_ALIASES = ['thickness', 'die thickness'];

const normalizeKey = (key) => String(key || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const clean = (value, max = 500) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text ? text.substring(0, max) : null;
};

const getField = (row, aliases) => {
    const normalized = {};
    Object.entries(row || {}).forEach(([key, value]) => {
        normalized[normalizeKey(key)] = value;
    });

    for (const alias of aliases) {
        const value = normalized[normalizeKey(alias)];
        if (value !== null && value !== undefined && String(value).trim() !== '') {
            return value;
        }
    }
    return null;
};

const extractProfile = (dieNo) => {
    const text = clean(dieNo);
    if (!text) return null;
    return text.split('-')[0].replace(/^0+/, '') || null;
};

// Orders and frozen designs record die size as "<diameter>X<thickness>" (e.g.
// 250X160 — the most common value across 659 orders is exactly the 250 + 160
// pair). Storing the diameter alone makes the order-PDF prefill stamp a bare
// "250" where every other order says 250X160.
const composeDieSize = (row) => {
    const diam = clean(getField(row, DIE_DIAM_ALIASES), 100);
    const thickness = clean(getField(row, THICKNESS_ALIASES), 100);
    if (diam && thickness) return `${diam}X${thickness}`;
    return clean(getField(row, DIE_SIZE_ALIASES), 200) || diam;
};

module.exports = {
    normalizeKey, clean, getField, extractProfile, composeDieSize,
    DIE_NO_ALIASES, PROFILE_ALIASES, CUSTOMER_ALIASES, PRESS_ALIASES,
    DIE_SIZE_ALIASES, DIE_DIAM_ALIASES, THICKNESS_ALIASES,
};
