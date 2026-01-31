import React from 'react';
import { ArrowRight } from 'lucide-react';
import { STATUS_CONFIG, PIPELINE_STATUSES } from '../../utils/constants';
import StatusBadge from '../common/StatusBadge';

function PipelineBoard({ data, onOrderClick, theme }) {
  const pipelineData = PIPELINE_STATUSES.map(status => ({
    status,
    config: STATUS_CONFIG[status],
    orders: data.filter(o => o.STATUS === status)
  }));

  return (
    <div style={{
      background: theme.cardBg,
      borderRadius: '16px',
      padding: '1.5rem',
      border: `1px solid ${theme.border}`
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem'
      }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: theme.text }}>
          Order Pipeline
        </h2>
        <span style={{ fontSize: '0.85rem', color: theme.textMuted }}>
          {data.filter(o => PIPELINE_STATUSES.includes(o.STATUS)).length} active orders
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '1rem'
      }}>
        {pipelineData.map((column, idx) => (
          <div
            key={column.status}
            style={{
              background: theme.bg,
              borderRadius: '12px',
              padding: '1rem',
              minHeight: '400px'
            }}
          >
            {/* Column Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '1rem',
              paddingBottom: '0.75rem',
              borderBottom: `2px solid ${column.config.color}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: column.config.color
                }} />
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: theme.text,
                  textTransform: 'uppercase'
                }}>
                  {column.config.label}
                </span>
              </div>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                background: `${column.config.color}20`,
                color: column.config.color,
                padding: '4px 10px',
                borderRadius: '12px'
              }}>
                {column.orders.length}
              </span>
            </div>

            {/* Cards */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              maxHeight: '350px',
              overflowY: 'auto'
            }}>
              {column.orders.map(order => (
                <div
                  key={order.id}
                  onClick={() => onOrderClick(order)}
                  style={{
                    background: theme.cardBg,
                    borderRadius: '10px',
                    padding: '12px',
                    cursor: 'pointer',
                    border: `1px solid ${theme.border}`,
                    transition: 'all 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <div style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: theme.text,
                    marginBottom: '6px'
                  }}>
                    {order['DIE NO']}
                  </div>
                  <div style={{
                    fontSize: '0.75rem',
                    color: theme.textMuted,
                    marginBottom: '8px'
                  }}>
                    Order #{order['Order No']}
                  </div>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span style={{
                      fontSize: '0.7rem',
                      color: theme.textDim,
                      background: theme.bg,
                      padding: '3px 8px',
                      borderRadius: '4px'
                    }}>
                      {order.Supplier}
                    </span>
                    <span style={{
                      fontSize: '0.7rem',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      background: order.TYPE === 'N' ? '#3B82F620' : '#8B5CF620',
                      color: order.TYPE === 'N' ? '#3B82F6' : '#8B5CF6',
                      fontWeight: 600
                    }}>
                      {order.TYPE}
                    </span>
                  </div>
                  {order['Die Requested Date'] && (
                    <div style={{
                      fontSize: '0.7rem',
                      color: theme.textMuted,
                      marginTop: '8px',
                      paddingTop: '8px',
                      borderTop: `1px solid ${theme.border}`
                    }}>
                      Requested: {order['Die Requested Date']}
                    </div>
                  )}
                </div>
              ))}

              {column.orders.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  padding: '2rem 1rem',
                  color: theme.textMuted,
                  fontSize: '0.85rem'
                }}>
                  No orders
                </div>
              )}
            </div>

            {/* Arrow to next column */}
            {idx < pipelineData.length - 1 && (
              <div style={{
                position: 'absolute',
                right: '-12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: theme.textMuted,
                zIndex: 10
              }}>
                <ArrowRight size={20} />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        marginTop: '1.5rem',
        paddingTop: '1rem',
        borderTop: `1px solid ${theme.border}`,
        display: 'flex',
        justifyContent: 'center',
        gap: '2rem'
      }}>
        {PIPELINE_STATUSES.map(status => {
          const config = STATUS_CONFIG[status];
          return (
            <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: config.color
              }} />
              <span style={{ fontSize: '0.75rem', color: theme.textMuted }}>
                {config.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default PipelineBoard;
