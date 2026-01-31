import React from 'react';

function ProgressPipeline({ order }) {
  // Include 3D Model stage only if simulation is enabled for this order
  const baseStages = ['Ordered date', 'Design Received Date'];
  const simulationStage = order.simulationEnabled ? ['3D Model Received Date'] : [];
  const endStages = ['Design Approved Date', 'PR Entry', 'Oracle Entry'];
  const stages = [...baseStages, ...simulationStage, ...endStages];

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      {stages.map((key, idx) => {
        const complete = order.STATUS !== 'CANCELLED' && order[key];
        return (
          <React.Fragment key={key}>
            <div
              style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                fontWeight: 700,
                background: complete ? '#10B981' : '#1E293B',
                color: complete ? 'white' : '#64748B',
                border: complete ? 'none' : '2px solid #334155'
              }}
            >
              {complete ? '✓' : idx + 1}
            </div>
            {idx < stages.length - 1 && (
              <div
                style={{
                  width: '8px',
                  height: '2px',
                  background: complete ? '#10B981' : '#334155'
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default ProgressPipeline;
