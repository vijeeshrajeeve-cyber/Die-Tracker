'use strict';
// Universal search: the pure half. The route owns the queries; this owns what
// counts as a match, how matches rank, and the SQL fragments both share, so
// the database's candidate order and the final order can't drift apart.

const MIN_QUERY_LENGTH = 2;
const RESULT_CAP = 8;
// Candidates fetched per group before ranking. The SQL orders them exact →
// prefix → contains first, so an exact code is never lost behind 200 newer
// partial matches.
const CANDIDATE_LIMIT = 200;

const ORDER_SEARCH = {
  fields: ['die_no', 'order_no', 'supplier', 'customer_name', 'pr_number'],
  primary: ['die_no', 'order_no'],
  dateField: 'created_at',
};

const QD_SEARCH = {
  fields: ['qd_no', 'die_no', 'supplier', 'profile_number', 'issue_summary'],
  primary: ['qd_no', 'die_no'],
  dateField: 'raised_date',
};

function normaliseQuery(raw) {
  const q = typeof raw === 'string' ? raw.trim() : '';
  return q.length >= MIN_QUERY_LENGTH ? q : null;
}

// Backslash is Postgres's default LIKE escape, so escaping it first keeps a
// typed "\" from swallowing the next character.
const escapeLike = (q) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const containsPattern = (q) => `%${escapeLike(q)}%`;
const prefixPattern = (q) => `${escapeLike(q)}%`;

const matchClause = (fields) => `(${fields.map((f) => `${f} ILIKE $1`).join(' OR ')})`;

// $2 is the lower-cased query, $3 the prefix pattern.
const rankClause = ({ fields, primary }) => {
  const exact = primary.map((f) => `lower(${f}) = $2`).join(' OR ');
  const prefix = fields.map((f) => `${f} ILIKE $3`).join(' OR ');
  return `CASE WHEN ${exact} THEN 0 WHEN ${prefix} THEN 1 ELSE 2 END`;
};

const text = (v) => (v == null ? '' : String(v).toLowerCase());
const time = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
};

function scoreRow(row, needle, { fields, primary }) {
  const exact = primary.find((f) => text(row[f]) === needle);
  if (exact) return { score: 0, matchedField: exact };
  const prefix = fields.find((f) => text(row[f]).startsWith(needle));
  if (prefix) return { score: 1, matchedField: prefix };
  const contains = fields.find((f) => text(row[f]).includes(needle));
  if (contains) return { score: 2, matchedField: contains };
  return null;
}

function rankRows(rows, q, config) {
  const needle = q.toLowerCase();
  return (rows || [])
    .map((row) => ({ row, hit: scoreRow(row, needle, config) }))
    .filter((entry) => entry.hit)
    .sort((a, b) => a.hit.score - b.hit.score
      || time(b.row[config.dateField]) - time(a.row[config.dateField])
      || (b.row.id ?? 0) - (a.row.id ?? 0))
    .slice(0, RESULT_CAP)
    .map(({ row, hit }) => ({ row, matchedField: hit.matchedField }));
}

module.exports = {
  MIN_QUERY_LENGTH, RESULT_CAP, CANDIDATE_LIMIT, ORDER_SEARCH, QD_SEARCH,
  normaliseQuery, escapeLike, containsPattern, prefixPattern, matchClause, rankClause, rankRows,
};
