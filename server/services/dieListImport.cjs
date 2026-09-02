'use strict';
const { canonicalPress, cleanPressToken } = require('./frozenDesigns.cjs');

// Column aliases per field. normalizeKey() strips case and punctuation, so
// 'Die No', 'die_no' and 'DIE NO' collapse to one key — only genuinely
// different words need listing.
//
// The plants export from different die-management systems and share almost no
// column names. GEX-01 writes IDDie / PressPrimary / NumHoles / DieStatus;
// GEX-2 writes IDDie / IDPressPrimary / NumCavities / DescrStatus. Both
// vocabularies are listed here so the rest of the app sees one shape — adding a
// third plant should mean extending these lists and nothing else.
const DIE_NO_ALIASES = ['die no', 'die_no', 'die', 'die number', 'die number/name', 'die number name', 'iddie', 'die id'];
const PROFILE_ALIASES = ['profile', 'profile number', 'profile_number', 'idprofile', 'profile id'];
const CUSTOMER_ALIASES = [
    'customer', 'customer name', 'customer_name', 'party', 'client', 'idcustomer1', 'idcustomer',
    'profiles descrcustomer', 'descrcustomer',
];
const PRESS_ALIASES = ['press', 'press name', 'press code', 'machine', 'pressprimary', 'primary press', 'idpressprimary'];
const DIE_SIZE_ALIASES = ['die size', 'die_size', 'size', 'section size', 'profile size'];
const DIE_DIAM_ALIASES = ['diesdiam', 'die diam', 'die diameter', 'diameter'];
const THICKNESS_ALIASES = ['thickness', 'die thickness', 'dieheight', 'die height'];
const STATUS_ALIASES = ['diestatus', 'die status', 'descrstatus', 'status'];
const CAVITY_ALIASES = ['numholes', 'num holes', 'numcavities', 'num cavities', 'cavity', 'cavities', 'no of cav'];
const DIE_TYPE_ALIASES = ['dietype', 'die type', 'descrdietype'];
const SUPPLIER_ALIASES = ['namesupplier', 'name supplier', 'descrsupplier', 'supplier', 'die supplier', 'manufacturer', 'vendor'];
const TONNAGE_ALIASES = ['tonnage', 'qtykggross', 'qty kg gross', 'extruded volume', 'extruded qty'];
const BOLSTER_ALIASES = ['idbolster', 'bolster', 'bolster no', 'bolster number'];

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
// "250" where every other order says 250X160. GEX-2 calls the second dimension
// DieHeight rather than Thickness.
const composeDieSize = (row) => {
    const diam = clean(getField(row, DIE_DIAM_ALIASES), 100);
    const thickness = clean(getField(row, THICKNESS_ALIASES), 100);
    if (diam && thickness) return `${diam}X${thickness}`;
    return clean(getField(row, DIE_SIZE_ALIASES), 200) || diam;
};

// canonicalPress already resolves a press_name, a press_code ('P35' -> PRESS 8),
// a 'P'-prefixed number and a bare number. GEX-01's 'M_PRESS.4' is none of
// those, so when the token matches nothing verbatim we retry on its trailing
// number. canonicalPress signals "no match" by echoing the cleaned token back.
const resolvePress = (raw, presses) => {
    if (!raw) return null;
    const direct = canonicalPress(raw, presses);
    if (direct && direct !== cleanPressToken(raw)) return direct;

    const trailing = String(raw).match(/(\d+)\s*$/);
    if (trailing) {
        const byNumber = canonicalPress(trailing[1], presses);
        if (byNumber && byNumber !== trailing[1]) return byNumber;
    }
    return raw;
};

const toInteger = (value) => {
    const text = clean(value, 50);
    if (!text) return null;
    const n = Number(text.replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n) : null;
};

/**
 * Normalise one spreadsheet row into the shape existing_die_details stores.
 *
 * @param {object} row      One row as read from the workbook
 * @param {object[]} presses  Rows from the presses master (press_name, press_code)
 */
const mapRow = (row, presses) => {
    const dieNo = clean(getField(row, DIE_NO_ALIASES));
    // The press is resolved here rather than at query time so every downstream
    // lookup is a plain equality: the die list writes 'M_PRESS.4' at GEX-01 and
    // 'P35' at GEX-2, and both mean a row in the presses master. A press with no
    // master row keeps its raw token and simply never matches.
    const rawPress = clean(getField(row, PRESS_ALIASES), 100);
    return {
        dieNo,
        profile: clean(getField(row, PROFILE_ALIASES)) || extractProfile(dieNo),
        customer: clean(getField(row, CUSTOMER_ALIASES)),
        dieSize: composeDieSize(row),
        press: resolvePress(rawPress, presses),
        dieStatus: clean(getField(row, STATUS_ALIASES), 100),
        cavity: toInteger(getField(row, CAVITY_ALIASES)),
        dieType: clean(getField(row, DIE_TYPE_ALIASES), 50),
        supplier: clean(getField(row, SUPPLIER_ALIASES), 200),
        tonnage: toInteger(getField(row, TONNAGE_ALIASES)),
        bolsterNo: clean(getField(row, BOLSTER_ALIASES), 100),
    };
};

// A row that mapped to nothing at all is a spacer or a stray header, not a die.
const isEmptyRow = (mapped) => !mapped.dieNo && !mapped.profile && !mapped.customer
    && !mapped.dieSize && !mapped.press && !mapped.dieStatus
    && mapped.cavity === null && !mapped.dieType && !mapped.supplier
    && mapped.tonnage === null && !mapped.bolsterNo;

module.exports = {
    normalizeKey, clean, getField, extractProfile, composeDieSize, toInteger, resolvePress,
    mapRow, isEmptyRow,
    DIE_NO_ALIASES, PROFILE_ALIASES, CUSTOMER_ALIASES, PRESS_ALIASES,
    DIE_SIZE_ALIASES, DIE_DIAM_ALIASES, THICKNESS_ALIASES,
    STATUS_ALIASES, CAVITY_ALIASES, DIE_TYPE_ALIASES, SUPPLIER_ALIASES,
    TONNAGE_ALIASES, BOLSTER_ALIASES,
};
