// Prefill for the Generate Die Order PDF modal. Kept out of BackupDieRequests.jsx
// (1,453 lines, no component test framework) so the merge rules can be tested.

// Only 38.8% of dies name a supplier that matches the master exactly; these two
// aliases cover a further 8,873 dies, lifting coverage to 58.7%. Follows the
// SUPPLIER_ALIASES precedent in components/modals/PDFImportModal.jsx.
export const SUPPLIER_ALIASES = {
  'PHOEINIX': 'PHOENIX',
  'PHOENIX MIDDLE EAST': 'PHME',
  // GEX-2's own spellings for the same two firms.
  'ME PHOENIX': 'PHME',
  'PHOENIX INTERNATIONAL S.P.A.': 'PHOENIX',
};

// MODE OF SHIPMENT is derived from the matched supplier record, so a name that
// is not in the master is worse than no name at all — return null and leave the
// field blank rather than stranding the shipment mode.
export const canonicalSupplier = (raw, supplierNames) => {
  const key = String(raw ?? '').trim().toUpperCase();
  if (!key) return null;
  const aliased = SUPPLIER_ALIASES[key] || key;
  return (supplierNames || []).find((n) => String(n).trim().toUpperCase() === aliased) || null;
};

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

export const applyPrefill = (values, { order, dieList } = {}, { supplierNames = [] } = {}) => {
  const next = { ...values };
  const sources = {};
  const label = (row, kind) => `${kind} ${row.die_no}`;

  // DIE SIZE and SUPPLIER: a recent purchase outranks the historical die list.
  // Whatever the request or the frozen design already wrote stays put.
  for (const [row, kind] of [[order, 'order'], [dieList, 'die list']]) {
    if (!row) continue;

    if (isBlank(next.DIE_SIZE) && !isBlank(row.die_size)) {
      next.DIE_SIZE = String(row.die_size).trim();
      sources.DIE_SIZE = label(row, kind);
    }

    if (isBlank(next.SUPPLIER)) {
      const supplier = canonicalSupplier(row.supplier, supplierNames);
      if (supplier) {
        next.SUPPLIER = supplier;
        sources.SUPPLIER = label(row, kind);
      }
    }
  }

  if (!dieList) return { values: next, sources };

  // Orders record no die type and no bolster, so these two are die-list only.
  if (!next.SOLID && !next.HOLLOW) {
    const type = String(dieList.die_type ?? '').trim().toUpperCase();
    if (type === 'SOLID' || type === 'HOLLOW') {
      next[type] = true;
      sources[type] = label(dieList, 'die list');
    }
  }

  if (isBlank(next.BOLSTER_NO) && !isBlank(dieList.bolster_no)) {
    next.BOLSTER_NO = String(dieList.bolster_no).trim();
    sources.BOLSTER_NO = label(dieList, 'die list');
  }

  return { values: next, sources };
};
