import React from 'react';
import { overlayViewBox, placedProfile, svgPath } from '../../utils/toolingFinderView';

// A tooling opening drawn from its geometry: the outer (when given) thin and muted,
// the pockets stroked, and for each placement the profile placed into its pocket,
// filled at 40 % in the accent colour. Coordinates are mm, y up; the group flips y.
// With no profile it is the plain opening picture (the Toolings drawer).
export default function OpeningOverlay({ pockets, outer = null, profilePoints = null, placements = [], size = { w: 96, h: 64 }, c }) {
  const polys = (pockets || []).filter((p) => Array.isArray(p) && p.length >= 3);
  const hasOuter = Array.isArray(outer) && outer.length >= 3;
  const vb = overlayViewBox(hasOuter ? [outer, ...polys] : polys);
  const box = { width: size.w, height: size.h, flexShrink: 0, borderRadius: 4, background: c.inset, border: `1px solid ${c.border}` };

  if (!vb || polys.length === 0) {
    return (
      <div role="img" aria-label="Opening not known" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: c.muted, textAlign: 'center' }}>
        opening not known
      </div>
    );
  }

  // pocketIndex refers to the finder's pocket list, before any filtering.
  const placed = profilePoints ? (placements || []).filter((p) => (pockets || [])[p.pocketIndex]?.length >= 3) : [];
  const label = `Opening with ${polys.length} pocket${polys.length === 1 ? '' : 's'}`
    + (placed.length ? `, profile placed in ${placed.length}` : '');

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={box}
    >
      <g transform="scale(1,-1)">
        {hasOuter && (
          <path d={svgPath(outer)} fill="none" stroke={c.muted} strokeWidth={0.75} strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
        )}
        {polys.map((p, i) => (
          <path key={`pocket-${i}`} d={svgPath(p)} fill="none" stroke={c.text} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {placed.map((pl, i) => (
          <path
            key={`placed-${i}`}
            d={svgPath(placedProfile(profilePoints, pl))}
            fill={c.primary}
            fillOpacity={0.4}
            stroke={c.primary}
            strokeWidth={0.75}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
}
