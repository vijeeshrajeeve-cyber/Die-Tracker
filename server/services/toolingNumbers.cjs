'use strict';
// Pure normalisers for the tooling master (inserts and bolsters). No database, no app imports.

const GEX2_INSERT = /^(25|35)IC(\d+)(E)?(?:-(\d+))?$/;
const GEX1_INSERT = /^I[-\s]?(\d{1,5})$/;
const GEX1_INSERT_CODE = /^I-(\w+)$/;
const BOLSTER = /^(?:BOL[-\s]*|B[-\s]+)(.+)$/;
const SIZE_TOKEN = /^(?:∅|Ø|DIA)?\s*(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)$/;

function unknownNumber(raw) {
    return { kind: 'unknown', canonical: null, plant: null, cavities: null, madeForDie: null, raw };
}

function parseToolingNumber(raw) {
    const rawText = raw == null ? '' : String(raw);
    const text = rawText.trim().toUpperCase();
    if (!text) return unknownNumber(rawText);

    let match = GEX2_INSERT.exec(text);
    if (match) {
        return {
            kind: 'insert',
            canonical: text,
            plant: 'GEX 2',
            cavities: Number(match[2]),
            madeForDie: match[4] || null,
            raw: rawText,
        };
    }

    match = GEX1_INSERT.exec(text);
    if (match) {
        const digits = match[1].padStart(5, '0');
        return { kind: 'insert', canonical: `I-${digits}`, plant: 'GEX 1', cavities: null, madeForDie: digits, raw: rawText };
    }
    match = GEX1_INSERT_CODE.exec(text);
    if (match) {
        return { kind: 'insert', canonical: text, plant: 'GEX 1', cavities: null, madeForDie: null, raw: rawText };
    }

    match = BOLSTER.exec(text);
    if (match) {
        const rest = match[1].replace(/\s+/g, '-');
        return { kind: 'bolster', canonical: `BOL-${rest}`, plant: null, cavities: null, madeForDie: null, raw: rawText };
    }

    return unknownNumber(rawText);
}

// Size class: uppercase X, no spaces, no diameter prefix, decimals kept. NO and blank are null.
function normalizeSizeClass(raw) {
    if (raw == null) return null;
    const text = String(raw).trim().toUpperCase();
    if (!text || text === 'NO') return null;
    const match = SIZE_TOKEN.exec(text);
    if (match) return `${match[1]}X${match[2]}`;
    return text;
}

// Resolve a die-list tooling reference. A parsed insert/bolster is returned even when the
// master lacks it (it becomes "unverified" later); a bare number needs exactly one match.
function resolveToolingRef(raw, known) {
    const rawText = raw == null ? '' : String(raw);
    const parsed = parseToolingNumber(rawText);
    if (parsed.kind !== 'unknown') {
        return { kind: parsed.kind, toolingNumber: parsed.canonical, raw: rawText };
    }
    const text = rawText.trim();
    if (/^\d+$/.test(text)) {
        const asInsert = `I-${text.padStart(5, '0')}`;
        const asBolster = `BOL-${text}`;
        const inInserts = known.inserts.has(asInsert);
        const inBolsters = known.bolsters.has(asBolster);
        if (inInserts && !inBolsters) return { kind: 'insert', toolingNumber: asInsert, raw: rawText };
        if (inBolsters && !inInserts) return { kind: 'bolster', toolingNumber: asBolster, raw: rawText };
    } else if (text) {
        // The inventory stores GEX-2 letter variants as raw uppercased text (35IC1A) and
        // bolster-block entries as BOL-<RAW>; resolve those against the master too.
        const asInsert = text.toUpperCase();
        const asBolster = `BOL-${asInsert}`;
        const inInserts = known.inserts.has(asInsert);
        const inBolsters = known.bolsters.has(asBolster);
        if (inInserts && !inBolsters) return { kind: 'insert', toolingNumber: asInsert, raw: rawText };
        if (inBolsters && !inInserts) return { kind: 'bolster', toolingNumber: asBolster, raw: rawText };
    }
    return { kind: 'unknown', toolingNumber: null, raw: rawText };
}

function pressFromGex2Location(raw) {
    const text = raw == null ? '' : String(raw).trim().toUpperCase();
    if (text === '25MN' || text === 'P25') return 'PRESS 7';
    if (text === '35MN' || text === 'P35') return 'PRESS 8';
    return null;
}

module.exports = { parseToolingNumber, normalizeSizeClass, resolveToolingRef, pressFromGex2Location };
