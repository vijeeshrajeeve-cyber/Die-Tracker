import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { sampleTrialsAPI } from '../../api';
import { dialogs } from '../ui/DialogProvider';
import { TRIAL_RESULTS, TRIAL_FAIL_REASONS } from '../../utils/constants';
import { formatDate } from '../../utils/helpers';

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = { trial_date: '', result: 'OK', fail_reason: '', comments: '' };

const resultStyle = {
  'OK': { color: '#16A34A', bg: 'rgba(22,163,74,0.15)' },
  'Not OK': { color: '#EF4444', bg: 'rgba(239,68,68,0.15)' },
};

// Trials save the moment they are added, not when the record's Save button is
// pressed — they are their own records with their own endpoint. The subtitle
// says so, because two save models in one modal is otherwise a surprise.
export default function TrialsSection({ parent, trials, theme, user, onChanged, setToast }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);

  const input = {
    width: '100%', padding: '8px 10px', background: theme.inputBg || '#0F172A',
    border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px',
    color: theme.text, fontSize: '0.85rem', outline: 'none', boxSizing: 'border-box',
  };
  const label = {
    display: 'block', fontSize: '0.7rem', fontWeight: 600, color: theme.textMuted,
    marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px',
  };

  const notify = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), type === 'error' ? 5000 : 3000);
  };

  const reset = () => { setForm(EMPTY); setAdding(false); };

  const save = async () => {
    if (!form.trial_date) return notify('Trial date is required', 'error');
    if (form.trial_date > today()) return notify('Trial date cannot be in the future', 'error');
    if (form.result === 'Not OK' && !form.fail_reason) {
      return notify('Select a reason for the failed trial', 'error');
    }
    setBusy(true);
    try {
      await sampleTrialsAPI.create({
        ...parent,
        trial_date: form.trial_date,
        result: form.result,
        fail_reason: form.result === 'Not OK' ? form.fail_reason : null,
        comments: form.comments,
      });
      reset();
      await onChanged();
      notify('Trial recorded', 'success');
    } catch (error) {
      notify('Failed to record trial: ' + error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (trial) => {
    const ok = await dialogs.confirm({
      title: `Delete trial ${trial.trial_no}`,
      message: 'This removes the trial permanently. It cannot be undone.',
      confirmLabel: 'Delete trial',
    });
    if (!ok) return;
    try {
      await sampleTrialsAPI.delete(trial.id);
      await onChanged();
      notify('Trial deleted', 'success');
    } catch (error) {
      notify('Failed to delete trial: ' + error.message, 'error');
    }
  };

  const cell = { padding: '8px 10px', fontSize: '0.82rem', color: theme.text, borderTop: `1px solid ${theme.border || '#334155'}` };
  const head = { padding: '8px 10px', fontSize: '0.7rem', fontWeight: 700, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', textAlign: 'left' };

  return (
    <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: `1px solid ${theme.border || '#334155'}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', gap: '1rem' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, color: theme.text, margin: 0 }}>Trials</h3>
          <p style={{ fontSize: '0.75rem', color: theme.textMuted, margin: '2px 0 0' }}>
            Saved as soon as you add them — separately from this record.
          </p>
        </div>
        {parent && !adding && (
          <button
            onClick={() => { setForm({ ...EMPTY, trial_date: today() }); setAdding(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', background: 'rgba(8,145,178,0.15)', border: '1px solid #0891B2', borderRadius: '8px', color: '#0891B2', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
          >
            <Plus size={14} /> Add Trial
          </button>
        )}
      </div>

      {!parent ? (
        <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: 0 }}>
          Save the record first to log trials.
        </p>
      ) : (
        <>
          {trials.length === 0 && !adding && (
            <p style={{ fontSize: '0.85rem', color: theme.textMuted, margin: 0 }}>No trials logged yet.</p>
          )}

          {trials.length > 0 && (
            <div style={{ overflowX: 'auto', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...head, width: '40px' }}>#</th>
                    <th style={head}>Date</th>
                    <th style={head}>Result</th>
                    <th style={head}>Reason</th>
                    <th style={head}>Comments</th>
                    <th style={{ ...head, width: '40px' }} />
                  </tr>
                </thead>
                <tbody>
                  {trials.map(t => {
                    const rs = resultStyle[t.result] || resultStyle['OK'];
                    return (
                      <tr key={t.id}>
                        <td style={{ ...cell, fontFamily: 'monospace' }}>{t.trial_no}</td>
                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>{formatDate(t.trial_date)}</td>
                        <td style={cell}>
                          <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 600, background: rs.bg, color: rs.color, whiteSpace: 'nowrap' }}>
                            {t.result}
                          </span>
                        </td>
                        <td style={cell}>{t.fail_reason || '—'}</td>
                        <td style={{ ...cell, color: theme.textMuted }}>{t.comments || '—'}</td>
                        <td style={{ ...cell, textAlign: 'center' }}>
                          {user?.role === 'admin' && (
                            <button
                              onClick={() => remove(t)}
                              title="Delete trial"
                              style={{ padding: '4px', background: 'rgba(239,68,68,0.15)', border: 'none', borderRadius: '6px', cursor: 'pointer', color: '#EF4444' }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {adding && (
            <div style={{ marginTop: '0.75rem', padding: '1rem', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '10px', background: 'rgba(8,145,178,0.05)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={label} htmlFor="trial-date">Trial Date</label>
                  <input
                    id="trial-date" type="date" style={input}
                    value={form.trial_date}
                    max={today()}
                    onChange={(e) => setForm({ ...form, trial_date: e.target.value })}
                  />
                </div>
                <div>
                  <label style={label} htmlFor="trial-result">Result</label>
                  <select
                    id="trial-result" style={input}
                    value={form.result}
                    onChange={(e) => setForm({ ...form, result: e.target.value, fail_reason: '' })}
                  >
                    {TRIAL_RESULTS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                {form.result === 'Not OK' && (
                  <div style={{ gridColumn: 'span 2' }}>
                    <label style={label} htmlFor="trial-reason">Reason</label>
                    <select
                      id="trial-reason" style={input}
                      value={form.fail_reason}
                      onChange={(e) => setForm({ ...form, fail_reason: e.target.value })}
                    >
                      <option value="">Select a reason…</option>
                      {TRIAL_FAIL_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={label} htmlFor="trial-comments">Comments</label>
                  <textarea
                    id="trial-comments" rows={2}
                    style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
                    value={form.comments}
                    onChange={(e) => setForm({ ...form, comments: e.target.value })}
                  />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '0.75rem' }}>
                <button
                  onClick={reset}
                  style={{ padding: '8px 16px', background: 'transparent', border: `1px solid ${theme.border || '#334155'}`, borderRadius: '8px', color: theme.textMuted, fontWeight: 600, cursor: 'pointer', fontSize: '0.82rem' }}
                >
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={busy}
                  style={{ padding: '8px 18px', background: '#0891B2', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer', fontSize: '0.82rem', opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'Saving…' : 'Save Trial'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
