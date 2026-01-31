import React from 'react';
import { ArrowRight } from 'lucide-react';
import { STATUS_CONFIG, PIPELINE_STATUSES } from '../../utils/constants';

function ActivePipeline({ data, onOrderClick, theme }) {
  return (
    <div style={{
      background: theme.cardBg,
      borderRadius: '16px',
      padding: '1.25rem',
      border: `1px solid ${theme.border}`,
      marginTop: '1.5rem'
    }}>
      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem', color: theme.text }}>
        Active Pipeline
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem'
      }}>
        {PIPELINE_STATUSES.map((status, idx) => {
          const config = STATUS_CONFIG[status];
          const orders = data.filter(o => o.STATUS === status);
          return (
            <div key={status}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: config.color
                }} />
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase' }}>
                  {config.label}
                </span>
                <span style={{
                  marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 600,
                  background: `${config.color}20`, color: config.color,
                  padding: '2px 8px', borderRadius: '10px'
                }}>
                  {orders.length}
                </span>
              </div>
              <div style={{
                display: 'flex', flexDirection: 'column', gap: '8px',
                maxHeight: '200px', overflowY: 'auto'
              }}>
                {orders.slice(0, 5).map(order => (
                  <div
                    key={order.id}
                    onClick={() => onOrderClick(order)}
                    style={{
                      background: theme.bg,
                      padding: '10px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      border: `1px solid ${theme.border}`,
                      transition: 'transform 0.2s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                  >
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: theme.text }}>
                      {order['DIE NO']}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: theme.textMuted, marginTop: '4px' }}>
                      {order.Supplier}
                    </div>
                  </div>
                ))}
                {orders.length > 5 && (
                  <div style={{ fontSize: '0.75rem', color: theme.textMuted, textAlign: 'center', padding: '8px' }}>
                    +{orders.length - 5} more
                  </div>
                )}
              </div>
              {idx < PIPELINE_STATUSES.length - 1 && (
                <div style={{
                  position: 'absolute', right: '-20px', top: '50%',
                  transform: 'translateY(-50%)', color: theme.textMuted
                }}>
                  <ArrowRight size={16} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ActivePipeline;
