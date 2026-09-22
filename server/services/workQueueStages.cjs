'use strict';

// Stable persisted identifiers. Keep the SQL seed and projection in sync.
const STAGES = Object.freeze([
  { key: 'pending_order', label: 'Pending Order', days: 1, page: 'flow-pending-order' },
  { key: 'awaiting_design', label: 'Awaiting Design', days: 3, page: 'flow-awaiting-design' },
  { key: 'simulation', label: 'Simulation', days: 2, page: 'flow-simulation' },
  { key: 'design_approval', label: 'Design Approval', days: 1, page: 'flow-design-approval' },
  { key: 'pending_pr', label: 'Pending PR', days: 1, page: 'flow-pending-pr' },
  { key: 'oracle_entry', label: 'Oracle Entry', days: 1, page: 'flow-oracle-entry' },
  { key: 'design_to_ems', label: 'Design to EMS', days: 1, page: 'flow-design-ems' },
  { key: 'manufacturing', label: 'In Manufacturing', days: null, page: 'flow-completed' },
  { key: 'sample_submission', label: 'Sample Submission', days: 7, page: 'flow-sample-followup' },
  { key: 'sample_approval', label: 'Sample Approval', days: 3, page: 'flow-sample-followup' },
  { key: 'qd_approval', label: 'QD Approval', days: 2, page: 'qd-tracker' },
  { key: 'qd_returned', label: 'QD Returned', days: 2, page: 'qd-tracker' },
  { key: 'foc_receipt', label: 'FOC Receipt', days: null, page: 'qd-tracker' },
  { key: 'foc_trial', label: 'FOC Trial Follow-up', days: 3, page: 'qd-tracker' },
]);
const STAGE_BY_KEY = Object.freeze(Object.fromEntries(STAGES.map(stage => [stage.key, stage])));

module.exports = { STAGES, STAGE_BY_KEY };
