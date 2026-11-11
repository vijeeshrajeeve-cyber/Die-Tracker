'use strict';
// Drawing-archive matcher: which folders of the drawing archive are walked, and what tooling
// number a drawing file name stands for. Pure apart from the directory reads in listArchiveDrawings.

const fs = require('node:fs');
const path = require('node:path');
const { normalizeSizeClass } = require('./toolingNumbers.cjs');

const g1 = (prefix, kindHint) => ({ prefix, plant: 'GEX 1', kindHint });
const g2 = (prefix, kindHint) => ({ prefix, plant: 'GEX 2', kindHint });

const SCOPED_FOLDERS = [
    g1('Toolings/Dieshop - Insert Drawings/AutoCad', 'insert'),
    g1('Toolings/Dieshop - Insert Drawings/PDF & Tiff', 'insert'),
    g1('Toolings/Toolings/BOLSTER', 'bolster'),
    g1('Toolings/Bolsters', 'bolster'),
    g1('Toolings/Press-6', 'insert'),
    g1('Toolings/INS- copies', null),
    g1('14.Insert Details', 'insert'),
    g1('1.Press 1/Insert', 'insert'), g1('1.Press 1/Bolsters', 'bolster'),
    g1('2.Press 2/Insert', 'insert'), g1('2.Press 2/Bloster', 'bolster'),
    g1('3.Press 3/Inserts', 'insert'), g1('3.Press 3/Bolsters', 'bolster'),
    g1('4.Press 4/Insert', 'insert'), g1('4.Press 4/Bolsters', 'bolster'),
    g1('5.Press 5/Insert', 'insert'), g1('5.Press 5/Bolsters', 'bolster'),
    g1('6.Press 6/Insert', 'insert'), g1('6.Press 6/Bolster', 'bolster'),
    g2('10.TALEX tooling/25 MN/Inserts 25MN', 'insert'),
    g2('10.TALEX tooling/25 MN/Bolsters 25MN', 'bolster'),
    g2('10.TALEX tooling/35 MN/Inserts', 'insert'),
    g2('10.TALEX tooling/35 MN/Bolsters  35MN', 'bolster'), // two spaces, as on disk
    g2('7.Press-7-ND', null),
    g2('8.Press-8-ND', null),
    g1('', null), // root-level files only
];

const DRAWING_EXTENSIONS = new Set(['dxf', 'dwg', 'pdf']);

function listArchiveDrawings(root, fsLike = fs) {
    const folders = SCOPED_FOLDERS.filter((f) => f.prefix).map((f) => ({ ...f, key: f.prefix.toLowerCase() }));
    const rootFolder = SCOPED_FOLDERS.find((f) => !f.prefix);
    const out = [];

    // Descend only towards, or inside, a scoped folder (case-insensitive).
    const canDescend = (rel) => {
        const k = rel.toLowerCase();
        return folders.some((f) => f.key === k || f.key.startsWith(`${k}/`) || k.startsWith(`${f.key}/`));
    };
    const folderOf = (relDir) => {
        if (!relDir) return rootFolder;
        const k = relDir.toLowerCase();
        return folders.find((f) => k === f.key || k.startsWith(`${f.key}/`)) || null;
    };

    const walk = (relDir) => {
        const absDir = relDir ? path.join(root, ...relDir.split('/')) : root;
        let entries;
        try {
            entries = fsLike.readdirSync(absDir, { withFileTypes: true });
        } catch (err) {
            if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return;
            throw err;
        }
        for (const entry of entries) {
            const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (canDescend(rel)) walk(rel);
                continue;
            }
            if (entry.name.startsWith('~$')) continue;
            const dot = entry.name.lastIndexOf('.');
            if (dot <= 0) continue;
            const ext = entry.name.slice(dot + 1).toLowerCase();
            if (!DRAWING_EXTENSIONS.has(ext)) continue;
            const folder = folderOf(relDir);
            if (!folder) continue;
            out.push({
                absPath: path.join(absDir, entry.name),
                relPath: rel,
                stem: entry.name.slice(0, dot),
                ext,
                plant: folder.plant,
                kindHint: folder.kindHint,
            });
        }
    };

    walk('');
    return out;
}

// ---------------------------------------------------------------------------------------------
// File-name interpretation

const PRESS_PART_WORDS = [
    /\bPR-\d-\d{3}\b/, /\bPA-\d-\d{3}\b/, /\bBO-\d{3}X\d{2,3}/, /\bSUB-*\s*BOL/,
    /\bHOLDERS?\b/, /\bBOLTS?\b/, /EYEBOLT/, /\bRINGS?\b/, /\bPLATENS?\b/, /\bFIXTURES?\b/, /\bKEY\b/, /\bPIN\b/,
];
const PAREN_BOLSTER_CODE = /\(\s*\d-\d-[A-Z]\s*\)/;
const TALEX_CODE = /\b(25|35)(IC\d{1,2}[A-Z]?|B\d+C\d+[A-Z]?)(?:-?([A-Z]?)-?(\d{5,6}))?\b/;
const SIZE_TOKEN = /(?<!\d)(\d{3,4})\s*X\s*(\d{2,3})(?!\d)/;
// A press-position-letter code. A leading digit or dash would make it part of a longer number - unless the dash
// belongs to a bolster prefix (BOL-4-6-B, B-2-2-A).
const BOLSTER_CODE = /(?:(?<![\d-])|(?<=\bBOLS?-)|(?<=\bBO-)|(?<=\bB-))(\d-\d-[A-Z])\b/;
// Parts that are not toolings: the wider insert spellings below never read one of these as an insert.
const NOT_TOOLING = /\bMANDREL\b|\bBACKER\b/;
// "BOL", "BOLS", "BO", "BOLSTER" as a word, a trailing BOL / BOL1, BOL glued to digits, or a "B-" prefix.
const BOL_WORD = /\b(?:BOLS?|BO|BOLSTER)\b|BOL\d?$|\bBOL(?=\d{3,5}\b)|\bB(?=[- ]\d{3,5}\b)/;
const LEADING_KIND = /^(?:I-|INS\b|BOLS?\b|BOL(?=\d)|BO\b|B-|(?:TLX-)?(?:25|35)(?:IC|B\d))/;
const PAREN_GROUP = /\(([^)]*)\)/g;
const SIZE_OR_PRESS_GROUP = /^\s*(?:P-?\d|PR-?\d|PRESS\s*\d|\d{3,4}\s*X\s*\d{2,3})\s*$/;
const DIGIT_TOKEN = /(?<!\d)\d{3,5}(?!\d)/g;

function normaliseStem(stem) {
    return String(stem)
        .toUpperCase()
        .replace(/%(?:25)*20/g, ' ')
        .replace(/_/g, '-')
        .replace(/\[\d+\]|\(\d+\)|\(OK\)|\(A\)/g, ' ')
        .replace(/-OK\b/g, ' ')
        .replace(/\bREV\d*\b|\bMODEL\b|\bABSOLUTE\b/g, ' ')
        .replace(/(\d\s*X\s*\d+)\s*-A\b/g, '$1')
        .replace(/\.+\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function detectPress(text) {
    const m = /\bP-?(\d)\b/.exec(text) || /\bPR-?(\d)\b/.exec(text) || /PRESS\s*(\d)/.exec(text);
    return m ? `PRESS ${m[1]}` : null;
}

function interpretStem(stem, { plant, kindHint }) {
    let text = normaliseStem(stem);
    // A leading token that carries a kind (I-, INS, BOL, BO, B-, TALEX code) decides the part; every
    // parenthesised cross-reference group (not a size or press token) only names the mating part and is ignored.
    if (LEADING_KIND.test(text)) {
        text = text.replace(PAREN_GROUP, (group, inner) => (SIZE_OR_PRESS_GROUP.test(inner) ? group : ' '))
            .replace(/\s+/g, ' ').trim();
    }
    if (text.includes('SCRAP')) return { skip: 'scrap' };

    const talex = TALEX_CODE.exec(text);
    if (!talex && !PAREN_BOLSTER_CODE.test(text) && PRESS_PART_WORDS.some((re) => re.test(text))) {
        return { skip: 'press-part' };
    }

    let variant = null;
    if (/\bFIN(?:ITURA)?\b/.test(text)) {
        variant = 'FIN';
        text = text.replace(/\bFIN(?:ITURA)?\b/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const size = SIZE_TOKEN.exec(text);
    const sizeClass = size ? normalizeSizeClass(`${size[1]}X${size[2]}`) : null;
    if (size) text = text.replace(SIZE_TOKEN, ' ');
    const press = detectPress(text);
    const extra = { sizeClass, press, variant, stemNormalised: text };
    const make = (toolingNumber, kind, basis, plantOverride) =>
        ({ toolingNumber, kind, plant: plantOverride || plant, basis, ...extra });

    // (a) TALEX codes are GEX 2.
    if (talex) {
        const [, p, code, dieLetter, dieDigits] = talex;
        const die = dieDigits ? `${dieLetter}${dieDigits}` : '';
        if (code.startsWith('IC')) {
            return make(`${p}${code}${die ? `-${die}` : ''}`, 'insert', die ? 'filename-die' : 'filename-code', 'GEX 2');
        }
        return make(`BOL-${p}${code}`, 'bolster', 'filename-code', 'GEX 2');
    }

    // (b) A bolster code such as 4-6-B.
    const code = BOLSTER_CODE.exec(text);
    if (code) return make(`BOL-${code[1]}`, 'bolster', 'filename-code');

    // (c) BOL words: the first 3-5 digit token, with a "-<letter>" suffix when one follows it.
    if (BOL_WORD.test(text)) {
        DIGIT_TOKEN.lastIndex = 0;
        const token = DIGIT_TOKEN.exec(text);
        if (token) {
            const letter = /^-([A-Z])(?![A-Z0-9])/.exec(text.slice(token.index + token[0].length));
            return make(`BOL-${token[0]}${letter ? `-${letter[1]}` : ''}`, 'bolster', 'filename-code');
        }
    }

    // (d) Insert markers.
    const ins = /\bI-(\d{5})\b/.exec(text)
        || /\bINS[-. ]*(\d{5})\b/.exec(text)
        || /(?<!\d)(\d{5})(?:-\d)?[- ]*INS\b/.exec(text)
        // "INST" and "INSERT" also mark an insert, and an old four-digit die number is padded (9053-Ins is I-09053).
        || (!NOT_TOOLING.test(text) && (/\bINS(?:ERT|T)?[-. ]*(\d{4,5})\b/.exec(text)
            || /(?<!\d)(\d{4,5})(?:-\d)?[-. ]*INS(?:ERT|T)?\b/.exec(text)));
    if (ins) return make(`I-${ins[1].padStart(5, '0')}`, 'insert', 'filename-die');

    // (e) Bare numbers, disambiguated by the folder. A trailing letter (01049B) is an unresolvable variant.
    if (kindHint === 'insert') {
        const bare = /^(\d{5})(?![A-Z0-9])/.exec(text);
        if (bare) return make(`I-${bare[1]}`, 'insert', 'filename-die');
    }
    if (kindHint === 'bolster') {
        const bare = /^(\d{3,5})(?![A-Z0-9])/.exec(text);
        if (bare) return make(`BOL-${bare[1]}`, 'bolster', 'filename-code');
        const lettered = /(?<!\d)(\d{3})-([A-Z])\b/.exec(text);
        if (lettered) return make(`BOL-${lettered[1]}-${lettered[2]}`, 'bolster', 'filename-code');
    }

    return { skip: 'unrecognised' };
}

// ---------------------------------------------------------------------------------------------

const EXT_RANK = { dxf: 0, dwg: 1, pdf: 2 };

function groupByTooling(files) {
    const groups = new Map();
    for (const file of files) {
        let group = groups.get(file.toolingNumber);
        if (!group) {
            const { toolingNumber, kind, plant, basis, sizeClass, press, variant } = file;
            group = { match: { toolingNumber, kind, plant, basis, sizeClass, press, variant }, files: [], primary: null };
            groups.set(file.toolingNumber, group);
        }
        if (!group.match.sizeClass && file.sizeClass) group.match.sizeClass = file.sizeClass;
        if (!group.match.press && file.press) group.match.press = file.press;
        group.files.push(file);
    }
    const rank = (f) => [EXT_RANK[f.ext], f.ext === 'dxf' && f.variant === 'FIN' ? 1 : 0, f.stem.length];
    for (const group of groups.values()) {
        group.primary = group.files.reduce((best, f) => {
            const a = rank(f), b = rank(best);
            for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? f : best;
            return best;
        });
    }
    return groups;
}

module.exports = { SCOPED_FOLDERS, listArchiveDrawings, interpretStem, groupByTooling };
