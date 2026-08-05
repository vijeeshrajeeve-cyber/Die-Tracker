import React, { useState } from 'react';
import OverviewTab from './analytics/OverviewTab';
import SupplierReportTab from './analytics/SupplierReportTab';
import DieLifeTab from './analytics/DieLifeTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'supplier', label: 'Supplier Report' },
  { id: 'dielife', label: 'Die Life Data' },
];

export default function AnalyticsPage({ data, suppliers, theme }) {
  const [tab, setTab] = useState('overview');
  // Bumped when die life figures are saved. The panels below stay mounted, so
  // without this the Supplier Report keeps showing the report it fetched on
  // page load — and the monthly routine is "enter the figures, then look at the
  // report", which would silently show yesterday's numbers.
  const [dieLifeVersion, setDieLifeVersion] = useState(0);

  return (
    <div>
      <div role="tablist" aria-label="Analytics views" className="no-print"
        style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', borderBottom: `1px solid ${theme.cardBorder}` }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? '#1F6FB0' : 'transparent'}`,
              color: tab === t.id ? theme.text : theme.textMuted,
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Kept mounted rather than swapped, so switching back does not refetch
          and recompute the whole overview. */}
      <div style={{ display: tab === 'overview' ? 'block' : 'none' }}>
        <OverviewTab data={data} suppliers={suppliers} theme={theme} />
      </div>
      <div style={{ display: tab === 'supplier' ? 'block' : 'none' }}>
        <SupplierReportTab theme={theme} refreshKey={dieLifeVersion} />
      </div>
      <div style={{ display: tab === 'dielife' ? 'block' : 'none' }}>
        <DieLifeTab theme={theme} onSaved={() => setDieLifeVersion((v) => v + 1)} />
      </div>
    </div>
  );
}
