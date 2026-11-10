import React from 'react';
import { overlayViewBox, svgPath } from '../../utils/toolingFinderView';

// A profile drawn from its stored outline ({ outer, holes }, any frame, y up): the section
// filled, its holes cut out. The picture says nothing about size; the caller states the CCD.
export default function ProfileOutline({ outline, height = 72, label = 'Profile shape', c }) {
  const outer = outline?.outer;
  const box = { width: '100%', height, display: 'block', borderRadius: 6, background: c.inset, border: `1px solid ${c.border}` };
  const vb = Array.isArray(outer) && outer.length >= 3 ? overlayViewBox([outer], 0.12) : null;
  if (!vb) {
    return (
      <div role="img" aria-label="Profile picture not available" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: c.dim }}>
        no picture
      </div>
    );
  }
  const holes = (outline.holes || []).filter((h) => Array.isArray(h) && h.length >= 3);
  const d = [outer, ...holes].map(svgPath).join(' ');
  return (
    <svg role="img" aria-label={label} viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`} preserveAspectRatio="xMidYMid meet" style={box}>
      <g transform="scale(1,-1)">
        <path d={d} fillRule="evenodd" fill={c.text} fillOpacity={0.82} stroke={c.text} strokeWidth={0.75} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}
