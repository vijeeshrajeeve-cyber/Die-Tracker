import React from 'react';
import CorrectorSelect from '../ui/CorrectorSelect';
import { SAMPLE_STATUSES } from '../../utils/sampleFollowupView';

const FIELDS = [
  ['die', 'Die number', 'text'], ['customer', 'Customer', 'text'],
  ['plant', 'Plant', 'text'], ['press', 'Press', 'text'],
  ['supplier', 'Supplier', 'text'], ['corrector', 'Corrector', 'corrector'],
  ['die_received_date', 'Die received', 'date'], ['ascona_reference', 'Ascona reference', 'select'],
  ['submission_date', 'Submitted', 'date'], ['sample_approval_date', 'Approved', 'date'],
  ['status', 'Sample status', 'select'],
];

export default function SampleFollowupForm({ value, onChange, onSubmit, onCancel, editing, busy, correctors, correctorsError, theme }) {
  return (
    <form className="sf-record-form" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <p className="sf-muted sf-form-hint">{editing ? 'Changes are saved together when you select Save changes.' : 'Add the sample details. You can log trials after saving.'}</p>
      <fieldset disabled={busy}>
        <div className="sf-form-grid">
          {FIELDS.map(([key, label, type]) => (
            <div className="sf-field" key={key}>
              <label htmlFor={`sf-form-${key}`}>{label}</label>
              {type === 'corrector' ? (
                <CorrectorSelect id={`sf-form-${key}`} value={value[key] || ''}
                  onChange={next => onChange({ ...value, [key]: next })}
                  correctors={correctors} loadError={correctorsError} plant={value.plant}
                  style={{ width: '100%', background: theme.inputBg, color: theme.text, border: `1px solid ${theme.cardBorder}`, padding: '9px 10px', borderRadius: '6px' }} />
              ) : type === 'select' ? (
                <select id={`sf-form-${key}`} value={value[key] || (key === 'status' ? 'Pending' : 'No')}
                  onChange={event => onChange({ ...value, [key]: event.target.value })}>
                  {(key === 'status' ? SAMPLE_STATUSES : ['Yes', 'No']).map(option => <option key={option}>{option}</option>)}
                </select>
              ) : (
                <input id={`sf-form-${key}`} type={type} required={key === 'die'}
                  value={type === 'date' ? String(value[key] || '').slice(0, 10) : value[key] || ''}
                  onChange={event => onChange({ ...value, [key]: event.target.value })} />
              )}
            </div>
          ))}
          <div className="sf-field sf-full-width">
            <label htmlFor="sf-form-remark">Sample remark</label>
            <textarea id="sf-form-remark" rows={4} value={value.remark || ''}
              onChange={event => onChange({ ...value, remark: event.target.value })} />
          </div>
        </div>
        <div className="sf-panel-actions">
          <button type="submit" className="sf-button sf-primary">{busy ? 'Saving…' : editing ? 'Save changes' : 'Create record'}</button>
          <button type="button" className="sf-button" onClick={onCancel}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}
