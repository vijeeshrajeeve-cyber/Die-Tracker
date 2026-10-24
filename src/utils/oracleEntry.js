import { WORKFLOW_STEPS } from './constants.js';

// Oracle Entry rules shared by the flow pages, the order drawer and the Oracle
// batch. A tooling (order type T) is not a separate asset in Oracle, so it
// skips the Oracle Entry stage and never goes into a batch.

export const isTooling = (order) => String(order?.TYPE ?? '').trim().toUpperCase() === 'T';

// The status an order moves to when `status` is completed.
export const nextStatusAfter = (order, status) => (
  status === 'PENDING FOR PR' && isTooling(order)
    ? 'PENDING FOR DESIGN TO EMS'
    : WORKFLOW_STEPS[status]?.nextStatus ?? null
);

// When an order entered Design to EMS: its Oracle entry, or for a tooling,
// which skipped Oracle Entry, its PR entry.
export const designToEmsSince = (order) => order?.['Oracle Entry'] || order?.['PR Entry'] || null;
