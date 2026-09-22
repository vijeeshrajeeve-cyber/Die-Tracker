import React, { useState, useEffect, useCallback } from 'react';
import { Search, ChevronDown, ChevronUp, Package, MessageSquarePlus } from 'lucide-react';
import { STATUS_CONFIG } from '../utils/constants';
import { deliveryFollowupsAPI } from '../api';
import { formatDate } from '../utils/helpers';
import { todayLocal } from '../utils/today.js';
import DieAttentionLabels from '../components/DieAttentionLabels';
import DieReceivanceModal from '../components/delivery/DieReceivanceModal';
import DeliveryFollowupDrawer from '../components/delivery/DeliveryFollowupDrawer';
import {
  etaChip, countBuckets, compareByUrgency, normalizeEta, daysBetween, formatSlip, channelLabel,
} from '../utils/deliveryFollowup';

// In Manufacturing: dies ordered and not yet received, worked as a delivery
// follow-up list against each supplier's ETA.

const hasDieReceivedDate = (order) => {
  const d = order?.['Die Received Date'];
  return d != null && String(d).trim() !== '';
};

const BUCKETS = [
  { key: 'overdue', label: 'Overdue', color: '#DC2626' },
  { key: 'due_soon', label: 'Due in 7 days', color: '#D97706' },
  { key: 'later', label: 'Later', color: '#0F766E' },
  { key: 'no_eta', label: 'No ETA', color: '#64748B' },
];

const TONES = {
  danger: { fg: '#DC2626', bg: 'rgba(220,38,38,0.12)' },
  warning: { fg: '#B45309', bg: 'rgba(217,119,6,0.14)' },
  neutral: { fg: '#0F766E', bg: 'rgba(15,118,110,0.12)' },
  muted: { fg: '#64748B', bg: 'rgba(100,116,139,0.14)' },
};

const SORTABLE = [
  { key: 'DIE NO', label: 'Die No' }, { key: 'Order No', label: 'Order' }, { key: 'Plant', label: 'Plant' },
  { key: 'TYPE', label: 'Type' }, { key: 'Die Size', label: 'Size' }, { key: 'Cavity', label: 'Cav' },
  { key: 'Supplier', label: 'Supplier' }, { key: 'ETA', label: 'ETA' },
];

export default function InManufacturingPage({
  data, searchTerm, setSearchTerm, theme, correctors, correctorsError,
  setSelectedOrder, setRevisionHistoryOrder, setData, setToast, setActiveTab,
}) {
  const [summaries, setSummaries] = useState({});
  const [summaryError, setSummaryError] = useState('');
  const [bucket, setBucket] = useState(null);
  const [sort, setSort] = useState(null); // null = urgency order
  const [followupId, setFollowupId] = useState(null);
  const [receivanceOrder, setReceivanceOrder] = useState(null);

  const loadSummaries = useCallback(() => {
    deliveryFollowupsAPI.getSummaries()
      .then((r) => { setSummaries(r?.summaries || {}); setSummaryError(''); })
      .catch((err) => setSummaryError(err.message || 'Could not load follow-ups'));
  }, []);
  // Refetched when the order list changes, so an ETA edited in the order form
  // shows its slip here without a reload.
  useEffect(() => { loadSummaries(); }, [data, loadSummaries]);

  const today = todayLocal();
  const config = STATUS_CONFIG.DONE;
  const StatusIcon = config.icon || Package;
  const orders = data.filter((o) => o.STATUS === 'DONE' && !hasDieReceivedDate(o));
  const counts = countBuckets(orders, today);
  const term = (searchTerm || '').toLowerCase();
  const visible = orders
    .filter((o) => !bucket || etaChip(o.ETA, today).bucket === bucket)
    .filter((o) => !term || [o['DIE NO'], o['Order No'], o.Supplier].some((v) => v && String(v).toLowerCase().includes(term)))
    .sort((a, b) => {
      if (!sort) return compareByUrgency(a, b, today);
      const cmp = String(a[sort.key] ?? '').localeCompare(String(b[sort.key] ?? ''), undefined, { numeric: true });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  const toggleSort = (key) => setSort((s) => (!s || s.key !== key
    ? { key, direction: 'asc' }
    : s.direction === 'asc' ? { key, direction: 'desc' } : null));
  const followupOrder = followupId != null ? data.find((o) => o.id === followupId) : null;

  const styles = {
    tableContainer: { background: theme.cardBg, borderRadius: '8px', border: `1px solid ${theme.cardBorder}`, overflow: 'hidden', boxShadow: theme.shadowSm },
    th: { padding: '0.85rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 500, color: theme.textMuted, background: theme.tableBg, borderBottom: `1px solid ${theme.cardBorder}`, whiteSpace: 'nowrap' },
    td: { padding: '0.85rem 0.75rem', borderBottom: `1px solid ${theme.cardBorder}`, fontSize: '0.85rem', color: theme.text, verticalAlign: 'top' },
    chip: (tone) => ({ display: 'inline-block', padding: '3px 9px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap', background: TONES[tone].bg, color: TONES[tone].fg }),
    action: (color) => ({ padding: '6px 12px', background: `${color}1F`, border: `1px solid ${color}66`, borderRadius: '8px', cursor: 'pointer', color, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }),
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: `${config.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StatusIcon size={24} color={config.color} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: theme.text, margin: 0 }}>{config.label}</h1>
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: '4px 0 0' }}>Follow up delivery against each supplier&apos;s ETA</p>
          </div>
          <span style={{ background: config.color, color: 'white', padding: '4px 12px', borderRadius: '20px', fontSize: '0.875rem', fontWeight: 600 }}>{orders.length}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: theme.inputBg || '#0F172A', borderRadius: '10px', padding: '10px 14px', border: `1px solid ${theme.border || '#334155'}`, minWidth: '280px' }}>
          <Search size={18} color={theme.textMuted} />
          <input aria-label="Search dies in manufacturing" type="text" placeholder="Search die, order or supplier…" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ border: 'none', background: 'transparent', color: theme.text, fontSize: '0.9rem', outline: 'none', width: '100%' }} />
        </div>
      </div>

      <div role="group" aria-label="Filter by ETA" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginBottom: '1rem' }}>
        {BUCKETS.map((b) => {
          const active = bucket === b.key;
          return (
            <button key={b.key} type="button" aria-pressed={active} onClick={() => setBucket(active ? null : b.key)}
              style={{ textAlign: 'left', padding: '12px 14px', borderRadius: '10px', cursor: 'pointer', background: active ? `${b.color}1A` : theme.cardBg, border: `1px solid ${active ? b.color : theme.cardBorder}`, color: theme.text }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: b.color, fontVariantNumeric: 'tabular-nums' }}>{counts[b.key]}</div>
              <div style={{ fontSize: '0.8rem', color: theme.textMuted }}>{b.label}</div>
            </button>
          );
        })}
      </div>

      {summaryError && (
        <p role="alert" style={{ color: '#DC2626', fontSize: '0.8rem', margin: '0 0 0.75rem' }}>
          Follow-up history could not be loaded ({summaryError}). ETAs below are still current.
        </p>
      )}

      <div style={styles.tableContainer}>
        {visible.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {SORTABLE.map((col) => (
                    <th scope="col" key={col.key} style={{ ...styles.th, cursor: 'pointer' }} onClick={() => toggleSort(col.key)}
                      aria-sort={sort?.key === col.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        {col.label}
                        {sort?.key === col.key
                          ? (sort.direction === 'asc' ? <ChevronUp size={14} color={config.color} /> : <ChevronDown size={14} color={config.color} />)
                          : <ChevronDown size={14} color="#64748B" style={{ opacity: 0.3 }} />}
                      </span>
                    </th>
                  ))}
                  <th scope="col" style={styles.th}>ETA status</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Slips</th>
                  <th scope="col" style={styles.th}>Last follow-up</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Days</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Rev</th>
                  <th scope="col" style={{ ...styles.th, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((order) => {
                  const summary = summaries[order.id];
                  const chip = etaChip(order.ETA, today, formatDate);
                  const current = normalizeEta(order.ETA);
                  const revised = summary?.slips > 0 && summary.originalEta && summary.originalEta !== current;
                  const since = normalizeEta(order['Design to EMS Date']);
                  const days = since ? daysBetween(since, today) : null;
                  return (
                    <tr key={order.id}>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        <DieAttentionLabels order={order} dense />
                        <button type="button" className="row-open" onClick={() => setSelectedOrder(order)} style={{ fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>
                          {order['DIE NO']}<span className="sr-only"> — open details</span>
                        </button>
                      </td>
                      <td style={styles.td}>{order['Order No'] || '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>{order.Plant || '—'}</td>
                      <td style={styles.td}>{order.TYPE === 'N' ? 'New' : order.TYPE === 'B' ? 'Backup' : (order.TYPE || '—')}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{order['Die Size'] || '—'}</td>
                      <td style={{ ...styles.td, fontFamily: 'monospace' }}>{order.Cavity || '—'}</td>
                      <td style={styles.td}>{order.Supplier || '—'}</td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {revised && (
                          <div style={{ fontSize: '0.72rem', color: theme.textMuted, textDecoration: 'line-through' }} title="Original ETA">
                            {formatDate(summary.originalEta)}
                          </div>
                        )}
                        {current ? formatDate(current) : (order.ETA ? String(order.ETA) : '—')}
                      </td>
                      <td style={styles.td}><span style={styles.chip(chip.tone)}>{chip.text}</span></td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        {summary?.slips
                          ? <span title={`${formatSlip(summary.daysSlipped)} since the first ETA`} style={styles.chip(summary.slips > 1 ? 'danger' : 'warning')}>{summary.slips}</span>
                          : <span style={{ color: '#64748B' }}>—</span>}
                      </td>
                      <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                        {summary?.lastContact
                          ? <>{formatDate(summary.lastContact.date)}<div style={{ fontSize: '0.72rem', color: theme.textMuted }}>{channelLabel(summary.lastContact.channel)}</div></>
                          : <span style={{ color: theme.textMuted }}>Never</span>}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center', fontFamily: 'monospace' }}>{days != null && days >= 0 ? `${days}d` : '—'}</td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        {order['Design Revision Count'] > 0
                          ? <button type="button" onClick={() => setRevisionHistoryOrder && setRevisionHistoryOrder(order)} style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, background: 'rgba(245,158,11,0.2)', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.4)', cursor: 'pointer' }} title="View revision history">{order['Design Revision Count']}</button>
                          : <span style={{ color: '#64748B' }}>—</span>}
                      </td>
                      <td style={{ ...styles.td, textAlign: 'center' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                          <button type="button" onClick={() => setFollowupId(order.id)} style={styles.action('#4F46E5')} title="Log a follow-up or a new ETA">
                            <MessageSquarePlus size={15} /> Follow up
                          </button>
                          <button type="button" onClick={() => setReceivanceOrder(order)} style={styles.action('#0891B2')} title="Confirm Die Receivance">
                            <Package size={15} /> Confirm
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: theme.textMuted }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: theme.text, marginBottom: '0.5rem' }}>
              {orders.length ? 'No dies match this filter' : 'No dies in manufacturing'}
            </h3>
            {bucket && <button type="button" onClick={() => setBucket(null)} style={styles.action(config.color)}>Show all</button>}
          </div>
        )}
      </div>

      {followupOrder && (
        <DeliveryFollowupDrawer
          order={followupOrder}
          summary={summaries[followupOrder.id]}
          theme={theme}
          onClose={() => setFollowupId(null)}
          onSaved={(result) => {
            if (result?.eta !== undefined && result.eta !== followupOrder.ETA) {
              setData((prev) => prev.map((o) => (o.id === followupOrder.id ? { ...o, ETA: result.eta } : o)));
            }
            loadSummaries();
            setToast({ message: `Follow-up saved for ${followupOrder['DIE NO']}`, type: 'success' });
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}

      {receivanceOrder && (
        <DieReceivanceModal
          order={receivanceOrder} theme={theme} correctors={correctors} correctorsError={correctorsError}
          setToast={setToast}
          onClose={() => setReceivanceOrder(null)}
          onConfirmed={(patch) => {
            const done = receivanceOrder;
            setData((prev) => prev.map((o) => (o.id === done.id ? { ...o, ...patch, changeCount: (o.changeCount || 0) + 1 } : o)));
            setReceivanceOrder(null);
            setToast({ message: `Die ${done['DIE NO']} confirmed${'Submission Date' in patch ? ', trial skipped' : ''} & moved to Sample Followup`, type: 'success' });
            setActiveTab('flow-sample-followup');
            setTimeout(() => setToast(null), 3000);
          }}
        />
      )}
    </div>
  );
}
