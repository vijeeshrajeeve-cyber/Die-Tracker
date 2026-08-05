import React, { useState, useEffect, useCallback } from 'react';
import { Download } from 'lucide-react';
import { supplierPerformanceAPI } from '../../api';
import { MONTHS } from '../../utils/constants';
import RatingHero from '../../components/analytics/RatingHero';
import MetricCard from '../../components/analytics/MetricCard';
import TrendCard from '../../components/analytics/TrendCard';
import DieLifeMatrix from '../../components/analytics/DieLifeMatrix';

const FREQUENCIES = ['Monthly', 'Quarterly', 'YTD'];

export default function SupplierReportTab({ theme }) {
  const [suppliers, setSuppliers] = useState([]);
  const [supplier, setSupplier] = useState('');
  const [year] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
  const [frequency, setFrequency] = useState('Monthly');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    supplierPerformanceAPI.getSuppliers()
      .then((rows) => { if (!cancelled) { setSuppliers(rows || []); setSupplier((s) => s || (rows || [])[0] || ''); } })
      .catch(() => { if (!cancelled) setError('Could not load the supplier list.'); });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    if (!supplier) return;
    setLoading(true); setError('');
    try {
      setReport(await supplierPerformanceAPI.getReport({ supplier, year, month, frequency }));
    } catch (e) {
      setError(e.message || 'Could not build the report.');
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [supplier, year, month, frequency]);

  useEffect(() => { load(); }, [load]);

  const select = { padding: '8px 12px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: 8, color: theme.text, fontSize: '0.85rem', cursor: 'pointer' };
  const label = { fontSize: 9.5, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 3 };

  const trendFor = (key) => (report?.trend || []).map((r) => ({ month: r.month, value: r[key] }));

  return (
    <div>
      <div className="no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1.5rem' }}>
        <div>
          <label style={label} htmlFor="sr-supplier">Supplier</label>
          <select id="sr-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} style={{ ...select, minWidth: 160 }}>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="sr-month">Month</label>
          <select id="sr-month" value={month} onChange={(e) => setMonth(e.target.value)} style={select}>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={label} htmlFor="sr-frequency">Frequency</label>
          <select id="sr-frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} style={select}>
            {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <button onClick={() => window.print()} style={{ marginLeft: 'auto', padding: '9px 16px', background: '#1F6FB0', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Download size={15} /> Export PDF
        </button>
      </div>

      {error && <div style={{ padding: 16, borderRadius: 10, border: '1px solid #EF4444', color: '#EF4444', fontSize: '0.85rem', marginBottom: '1.5rem' }}>{error}</div>}
      {loading && <div style={{ color: theme.textDim, fontSize: '0.85rem' }}>Building report…</div>}

      {report && !loading && (
        <div id="supplier-report">
          <RatingHero report={report} theme={theme} />

          <div className="dt-analytics-grid" style={{ marginTop: '1.5rem' }}>
            {report.metrics.map((m) => (
              <MetricCard key={m.key} metric={m} value={report.snapshot[m.key]}
                score={report.scores[m.key]} trend={trendFor(m.key)} theme={theme} />
            ))}
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <DieLifeMatrix rows={report.dieLifeRows} theme={theme} />
          </div>

          <h2 style={{ fontSize: '0.75rem', fontWeight: 700, color: theme.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '2rem 0 0.75rem' }}>
            Trends · Jan–{month} {year}
          </h2>
          <div className="dt-analytics-grid">
            {report.metrics.map((m) => (
              <TrendCard key={m.key} metric={m} trend={trendFor(m.key)} theme={theme} />
            ))}
          </div>

          <p style={{ fontSize: 11, color: theme.textDim, marginTop: '1.5rem', lineHeight: 1.6 }}>
            Each metric is scored 0–10 against its target band, then combined using the weights above.
            Metrics with no data for the period are excluded from the rating rather than scored zero.
            Die life and die failure come from the figures entered on the Die Life Data tab.
          </p>
        </div>
      )}
    </div>
  );
}
