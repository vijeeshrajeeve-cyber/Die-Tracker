import React from 'react';
import { STATUS_CONFIG } from '../../utils/constants';

function StatusBadge({ status }) {
  const config = STATUS_CONFIG[status] || { color: '#6B7280', bgColor: '#F3F4F6', label: status };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
        backgroundColor: config.bgColor,
        color: config.color
      }}
    >
      {config.label}
    </span>
  );
}

export default StatusBadge;
