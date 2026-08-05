// Per-metric colour and score-band colour, shared by MetricCard and TrendCard.
// In its own module rather than beside a component so both can import it
// without tripping react-refresh/only-export-components.

export const COLORS = {
  ordersPlaced: '#3B82F6',
  dieLife: '#14B8A6',
  dieFailure: '#F43F5E',
  designLeadTime: '#0EA5E9',
  deliveryLeadTime: '#6366F1',
  trialRatio: '#8B5CF6',
  qdRate: '#EF4444',
  designRevisions: '#F59E0B',
};

// Mirrors the server's ratingBand thresholds, colour only. The server remains
// the authority on the band *label*; this is purely how a score is tinted.
export function band(score) {
  if (score >= 7.5) return '#16A34A';
  if (score >= 6.5) return '#0D9488';
  if (score >= 5.5) return '#D97706';
  if (score >= 4.0) return '#EA580C';
  return '#DC2626';
}
