import React from 'react';
import { correctorOptions } from '../../utils/correctorOptions';

// The Corrector field for call sites that render a raw input today. The
// filtering, fallback and pinning rule lives in utils/correctorOptions so the
// call sites that render their own <select> share exactly the same behaviour.
export default function CorrectorSelect({
  value, onChange, correctors = [], plant, loadError,
  id, ariaLabel = 'Corrector', style, disabled = false,
}) {
  const options = correctorOptions({ correctors, plant, value });

  // A failed fetch and a genuinely empty list must not look identical. Without
  // this, a backend outage would present as "there are no correctors" and the
  // user would have no idea why they cannot proceed.
  if (loadError) {
    return (
      <div>
        <select id={id} aria-label={ariaLabel} value="" disabled
          style={{ ...style, cursor: 'not-allowed', opacity: 0.65 }}>
          <option value="">— unavailable —</option>
        </select>
        <span style={{ fontSize: '0.68rem', color: '#EF4444', marginTop: '3px', display: 'block' }}>
          Corrector list could not be loaded. Reload the page and try again.
        </span>
      </div>
    );
  }

  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={{ ...style, cursor: disabled ? 'not-allowed' : 'pointer' }}
    >
      <option value="">— select corrector —</option>
      {options.map((o) =>
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      )}
    </select>
  );
}
