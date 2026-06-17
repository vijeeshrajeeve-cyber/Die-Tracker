import { useCallback, useState } from 'react';
import { extractProfileFromDie, ordersAPI, profilesAPI } from '../api';

export default function usePIImport({
  fetchOrders,
  fetchProfileMeta,
  setCurrentPage,
  setToast,
}) {
  const [missingCustomerPrompt, setMissingCustomerPrompt] = useState(null);

  // Look up missing customer names by profile (extracted from die_no).
  // For misses, prompt the user to enter customer names; save back to profile master.
  // Returns the records with Customer Name filled in (or unchanged if user cancelled).
  const resolveCustomerNames = useCallback(async (records, getDie, getCustomer, setCustomer) => {
    const missing = [];
    const profileToRecords = {};

    for (const rec of records) {
      const customer = (getCustomer(rec) || '').trim();
      if (customer) continue;

      const die = getDie(rec);
      const profile = extractProfileFromDie(die);
      if (!profile) continue;

      if (!profileToRecords[profile]) profileToRecords[profile] = [];
      profileToRecords[profile].push(rec);
      missing.push({ profile, die });
    }

    if (missing.length === 0) return records;

    const uniqueProfiles = Array.from(new Set(missing.map(m => m.profile)));
    const lookupResults = await Promise.all(uniqueProfiles.map(async p => {
      const res = await profilesAPI.lookup(p);
      return { profile: p, customer: res?.customer_name || null };
    }));

    const customerByProfile = {};
    lookupResults.forEach(r => { customerByProfile[r.profile] = r.customer; });

    uniqueProfiles.forEach(p => {
      if (customerByProfile[p]) {
        (profileToRecords[p] || []).forEach(rec => setCustomer(rec, customerByProfile[p]));
      }
    });

    const stillMissing = uniqueProfiles
      .filter(p => !customerByProfile[p])
      .map(p => ({ profile: p, dieNo: profileToRecords[p][0] && getDie(profileToRecords[p][0]) }));

    if (stillMissing.length === 0) return records;

    const collected = await new Promise((resolve) => {
      setMissingCustomerPrompt({
        profiles: stillMissing,
        values: stillMissing.reduce((acc, p) => ({ ...acc, [p.profile]: '' }), {}),
        onResolve: (values) => { setMissingCustomerPrompt(null); resolve(values); },
        onCancel: () => { setMissingCustomerPrompt(null); resolve(null); },
      });
    });

    if (!collected) return records;

    const saves = Object.entries(collected)
      .filter(([, v]) => v && v.trim())
      .map(async ([profile, customer]) => {
        const trimmed = customer.trim();
        try {
          await profilesAPI.save(profile, trimmed);
        } catch (e) {
          console.error('Save profile failed:', e);
        }
        (profileToRecords[profile] || []).forEach(rec => setCustomer(rec, trimmed));
      });

    await Promise.all(saves);
    fetchProfileMeta();

    return records;
  }, [fetchProfileMeta]);

  const handlePIImport = useCallback(async (importData, options = {}) => {
    // resolveCustomers: when false, skip the missing-customer lookup/prompt (and so never
    //   touch the customer name) — used by PI import, which must not change customer data.
    // restrictUpdateFields: when set, only these fields are sent on an UPDATE, leaving every
    //   other field on the existing order untouched. New orders always get the full payload.
    const { resolveCustomers = true, restrictUpdateFields = null } = options;
    try {
      const records = importData.map(r => ({ ...r }));
      if (resolveCustomers) {
        await resolveCustomerNames(
          records,
          (r) => r['DIE NO'] || r.die_no,
          (r) => r['Customer Name'] || r.customer_name,
          (r, v) => { r['Customer Name'] = v; if ('customer_name' in r) r.customer_name = v; }
        );
      }

      let created = 0;
      let updated = 0;

      for (const record of records) {
        const { isExisting, ...orderData } = record;
        if (isExisting && orderData.id) {
          const payload = restrictUpdateFields
            ? restrictUpdateFields.reduce((acc, key) => {
                if (key in orderData) acc[key] = orderData[key];
                return acc;
              }, {})
            : orderData;
          await ordersAPI.patch(orderData.id, payload);
          updated++;
        } else {
          await ordersAPI.create(orderData);
          created++;
        }
      }

      await fetchOrders();
      setCurrentPage(1);

      const messages = [];
      if (created > 0) messages.push(`${created} new order(s) created`);
      if (updated > 0) messages.push(`${updated} order(s) updated`);
      const msg = `PI Import successful: ${messages.join(', ')}`;
      setToast({ message: msg, type: 'success' });
      setTimeout(() => setToast(null), 5000);
    } catch (error) {
      console.error('PI Import error:', error);
      setToast({ message: 'Failed to import: ' + error.message, type: 'error' });
      setTimeout(() => setToast(null), 5000);
    }
  }, [fetchOrders, resolveCustomerNames, setCurrentPage, setToast]);

  return {
    handlePIImport,
    missingCustomerPrompt,
    setMissingCustomerPrompt,
  };
}
