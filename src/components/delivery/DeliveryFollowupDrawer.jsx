import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X } from 'lucide-react';
import { deliveryFollowupsAPI } from '../../api';
import { formatDate } from '../../utils/helpers';
import { todayLocal } from '../../utils/today.js';
import {
  CAUSES, CHANNELS, needsCause, validateFollowUpForm, normalizeEta, causeLabel, channelLabel, formatSlip,
} from '../../utils/deliveryFollowup';

// One die's delivery follow-up: log a contact (optionally with the new ETA the
// supplier gave) and read the timeline of ETA changes, contacts and chasers.

const emptyForm = () => ({ contactDate: todayLocal(), channel: 'email', note: '', newEta: '', cause: '', causeNote: '' });

const describe = (e) => {
  if (e.kind === 'eta_set') return { title: `ETA set to ${formatDate(e.eta_after)}` };
  if (e.kind === 'eta_revised') {
    return {
      title: `ETA ${formatDate(e.eta_before)} → ${e.eta_after ? formatDate(e.eta_after) : 'withdrawn'}`,
      detail: [causeLabel(e.cause), e.note].filter(Boolean).join(' — '),
    };
  }
  if (e.kind === 'contact') return { title: `${channelLabel(e.channel)} on ${formatDate(e.contact_date)}`, detail: e.note };
  return { title: 'Chaser email sent', detail: e.note };
};

export default function DeliveryFollowupDrawer({ order, summary, theme, onClose, onSaved }) {
  const [events, setEvents] = useState([]);
  const [eventsError, setEventsError] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const firstField = useRef(null);

  const loadEvents = useCallback(() => deliveryFollowupsAPI.getEvents(order.id)
    .then((r) => { setEvents(r?.events || []); setEventsError(''); })
    .catch((err) => setEventsError(err.message || 'Could not load the timeline')), [order.id]);

  useEffect(() => { loadEvents(); firstField.current?.focus(); }, [loadEvents]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const today = todayLocal();
  const current = normalizeEta(order.ETA);
  const showCause = !!form.newEta && needsCause(order.ETA, form.newEta);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    const problem = validateFollowUpForm(form, order.ETA, today);
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const result = await deliveryFollowupsAPI.log(order.id, {
        contactDate: form.contactDate, channel: form.channel, note: form.note, newEta: form.newEta || undefined,
        cause: showCause ? form.cause : undefined, causeNote: showCause ? form.causeNote : undefined,
      });
      setForm(emptyForm());
      await loadEvents();
      onSaved(result);
    } catch (err) {
      setError(err.message || 'Could not save the follow-up');
    } finally {
      setSaving(false);
    }
  };

  const field = { width: '100%', padding: '9px 11px', background: theme.inputBg, border: `1px solid ${theme.cardBorder}`, borderRadius: '8px', color: theme.text, fontSize: '0.875rem', boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: '0.72rem', fontWeight: 600, color: theme.textMuted, marginBottom: '5px', textTransform: 'uppercase', letterSpacing: '0.04em' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000 }} onClick={onClose}>
      <aside role="dialog" aria-modal="true" aria-labelledby="followup-title" onClick={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)', background: theme.cardBg, borderLeft: `1px solid ${theme.cardBorder}`, boxShadow: '-12px 0 32px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column' }}>
        <header style={{ padding: '1.1rem 1.25rem', borderBottom: `1px solid ${theme.cardBorder}`, display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
          <div>
            <h2 id="followup-title" style={{ margin: 0, fontSize: '1.05rem', color: theme.text, fontFamily: 'monospace' }}>{order['DIE NO']}</h2>
            <p style={{ margin: '3px 0 0', fontSize: '0.8rem', color: theme.textMuted }}>{[order.Supplier, order.Plant, order['Order No']].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: '4px' }}><X size={20} /></button>
        </header>

        <div style={{ overflowY: 'auto', padding: '1rem 1.25rem', flex: 1 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', margin: '0 0 1.1rem' }}>
            {[
              ['Current ETA', current ? formatDate(current) : (order.ETA || 'None')],
              ['Original ETA', summary?.originalEta ? formatDate(summary.originalEta) : '—'],
              ['Slips', summary?.slips ? `${summary.slips} (${formatSlip(summary.daysSlipped)})` : '0'],
            ].map(([k, v]) => (
              <div key={k} style={{ padding: '8px 10px', borderRadius: '8px', background: theme.tableBg }}>
                <dt style={{ fontSize: '0.68rem', color: theme.textMuted, textTransform: 'uppercase' }}>{k}</dt>
                <dd style={{ margin: '2px 0 0', fontSize: '0.88rem', fontWeight: 600, color: theme.text }}>{v}</dd>
              </div>
            ))}
          </dl>

          <form onSubmit={submit} style={{ display: 'grid', gap: '10px', paddingBottom: '1.1rem', borderBottom: `1px solid ${theme.cardBorder}` }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: theme.text }}>Log a follow-up</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={label} htmlFor="followup-date">Date</label>
                <input ref={firstField} id="followup-date" type="date" max={today} value={form.contactDate} onChange={set('contactDate')} style={field} />
              </div>
              <div>
                <label style={label} htmlFor="followup-channel">Channel</label>
                <select id="followup-channel" value={form.channel} onChange={set('channel')} style={field}>
                  {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={label} htmlFor="followup-note">Supplier&apos;s reply</label>
              <textarea id="followup-note" rows={3} value={form.note} onChange={set('note')} placeholder="What did the supplier say?" style={{ ...field, resize: 'vertical' }} />
            </div>
            <div>
              <label style={label} htmlFor="followup-eta">New ETA from supplier (optional)</label>
              <input id="followup-eta" type="date" value={form.newEta} onChange={set('newEta')} style={field} />
            </div>
            {showCause && (
              <div style={{ display: 'grid', gap: '10px', padding: '10px', borderRadius: '8px', background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)' }}>
                <div>
                  <label style={label} htmlFor="followup-cause">Why did the ETA move?</label>
                  <select id="followup-cause" value={form.cause} onChange={set('cause')} style={field}>
                    <option value="">Pick a cause…</option>
                    {CAUSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={label} htmlFor="followup-cause-note">Cause note{form.cause === 'other' ? ' (required)' : ' (optional)'}</label>
                  <input id="followup-cause-note" type="text" value={form.causeNote} onChange={set('causeNote')} style={field} />
                </div>
              </div>
            )}
            {error && <p role="alert" style={{ margin: 0, color: '#DC2626', fontSize: '0.8rem' }}>{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="submit" disabled={saving} style={{ padding: '9px 20px', borderRadius: '8px', border: 'none', background: '#4F46E5', color: 'white', fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving…' : 'Save follow-up'}
              </button>
            </div>
          </form>

          <h3 style={{ margin: '1rem 0 0.5rem', fontSize: '0.9rem', color: theme.text }}>Timeline</h3>
          {eventsError && <p role="alert" style={{ color: '#DC2626', fontSize: '0.8rem' }}>{eventsError}</p>}
          {!eventsError && events.length === 0 && <p style={{ color: theme.textMuted, fontSize: '0.82rem' }}>Nothing logged yet.</p>}
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '10px' }}>
            {events.map((e) => {
              const { title, detail } = describe(e);
              return (
                <li key={e.id} style={{ paddingLeft: '12px', borderLeft: `2px solid ${e.kind === 'eta_revised' ? '#D97706' : theme.cardBorder}` }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>{title}</div>
                  {detail && <div style={{ fontSize: '0.82rem', color: theme.text, marginTop: '2px', whiteSpace: 'pre-wrap' }}>{detail}</div>}
                  <div style={{ fontSize: '0.72rem', color: theme.textMuted, marginTop: '2px' }}>
                    {e.created_by_name || 'Automatic'} · {new Date(e.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </aside>
    </div>
  );
}
