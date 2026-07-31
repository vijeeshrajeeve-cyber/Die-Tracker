import { ShoppingCart, Pencil, Cpu, CheckSquare, FileText, Database, Send, Factory, Eye, Clock, AlertTriangle, Package, TrendingUp, Truck, XCircle, Layers } from 'lucide-react';

// Status configuration with colors, icons, and labels
export const STATUS_CONFIG = {
  'AWAITING FOR DESIGN': { color: '#DC2626', bgColor: '#FEF2F2', icon: Clock, label: 'Awaiting Design' },
  'PENDING FOR DESIGN APPROVAL': { color: '#EA580C', bgColor: '#FFF7ED', icon: AlertTriangle, label: 'Design Approval' },
  'UNDER SIMULATION': { color: '#7C3AED', bgColor: '#F5F3FF', icon: Layers, label: 'Simulation' },
  'PENDING FOR DESIGN TO EMS': { color: '#2563EB', bgColor: '#EFF6FF', icon: Package, label: 'Design to EMS' },
  'PENDING FOR PR': { color: '#D97706', bgColor: '#FFFBEB', icon: TrendingUp, label: 'Pending PR' },
  'PENDING FOR ORACLE ENTRY': { color: '#C2410C', bgColor: '#FFF7ED', icon: Factory, label: 'Oracle Entry' },
  'PENDING FOR ORDERING': { color: '#0D9488', bgColor: '#F0FDFA', icon: Truck, label: 'Pending Order' },
  'DONE': { color: '#16A34A', bgColor: '#F0FDF4', icon: CheckSquare, label: 'In Manufacturing' },
  'CANCELLED': { color: '#6B7280', bgColor: '#F3F4F6', icon: XCircle, label: 'Cancelled' },
  'HOLD': { color: '#4B5563', bgColor: '#F9FAFB', icon: AlertTriangle, label: 'On Hold' },
};

export const CHART_COLORS = [
  '#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444',
  '#EC4899', '#6366F1', '#14B8A6', '#F97316', '#84CC16'
];

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const QUARTER_MONTHS = {
  'Q1': ['Jan', 'Feb', 'Mar'],
  'Q2': ['Apr', 'May', 'Jun'],
  'Q3': ['Jul', 'Aug', 'Sep'],
  'Q4': ['Oct', 'Nov', 'Dec']
};

export const PIPELINE_STATUSES = [
  'AWAITING FOR DESIGN',
  'PENDING FOR DESIGN APPROVAL',
  'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING'
];

export const VALID_STATUSES = [
  'AWAITING FOR DESIGN',
  'PENDING FOR DESIGN APPROVAL',
  'UNDER SIMULATION',
  'PENDING FOR DESIGN TO EMS',
  'PENDING FOR PR',
  'PENDING FOR ORACLE ENTRY',
  'PENDING FOR ORDERING',
  'DONE',
  'CANCELLED',
  'HOLD'
];

export const VALID_TYPES = ['N', 'B', 'T', 'C', 'H'];

export const TYPE_LABELS = {
  'N': 'New',
  'B': 'Backup',
  'T': 'Tooling',
  'C': 'Cancelled',
  'H': 'Hold'
};

// Process flow tabs for sidebar navigation (ordered by workflow sequence)
export const PROCESS_FLOW_TABS = [
  { id: 'flow-pending-order', status: 'PENDING FOR ORDERING', label: 'Pending Order', icon: ShoppingCart },
  { id: 'flow-awaiting-design', status: 'AWAITING FOR DESIGN', label: 'Awaiting Design', icon: Pencil },
  { id: 'flow-simulation', status: 'UNDER SIMULATION', label: 'Simulation', icon: Cpu },
  { id: 'flow-design-approval', status: 'PENDING FOR DESIGN APPROVAL', label: 'Design Approval', icon: CheckSquare },
  { id: 'flow-pending-pr', status: 'PENDING FOR PR', label: 'Pending PR', icon: FileText },
  { id: 'flow-oracle-entry', status: 'PENDING FOR ORACLE ENTRY', label: 'Oracle Entry', icon: Database },
  { id: 'flow-design-ems', status: 'PENDING FOR DESIGN TO EMS', label: 'Design to EMS', icon: Send },
  { id: 'flow-completed', status: 'DONE', label: 'In Manufacturing', icon: Factory },
  { id: 'flow-sample-followup', status: null, label: 'Sample Followup', icon: Eye },
];

// Backup request status configuration
export const BACKUP_REQUEST_STATUS_CONFIG = {
  'Pending': { color: '#F59E0B', bgColor: '#FFFBEB', label: 'Pending' },
  'Completed': { color: '#16A34A', bgColor: '#F0FDF4', label: 'Completed' },
  'HOLD': { color: '#4B5563', bgColor: '#F9FAFB', label: 'HOLD' },
  'Not required': { color: '#6B7280', bgColor: '#F3F4F6', label: 'Not required' },
};

// Workflow steps configuration: defines which date to set and which status to move to
export const WORKFLOW_STEPS = {
  'PENDING FOR ORDERING': {
    dateField: 'Ordered date',
    nextStatus: 'AWAITING FOR DESIGN',
    completionLabel: 'Mark as Ordered'
  },
  'AWAITING FOR DESIGN': {
    dateField: 'Design Received Date',
    nextStatus: 'PENDING FOR DESIGN APPROVAL',
    completionLabel: 'Design Received'
  },
  'UNDER SIMULATION': {
    dateField: '3D Model Received Date',
    nextStatus: 'PENDING FOR DESIGN APPROVAL',
    completionLabel: 'Simulation Complete'
  },
  'PENDING FOR DESIGN APPROVAL': {
    dateField: 'Design Approved Date',
    nextStatus: 'PENDING FOR PR',
    completionLabel: 'Approve Design'
  },
  'PENDING FOR PR': {
    dateField: 'PR Entry',
    nextStatus: 'PENDING FOR ORACLE ENTRY',
    completionLabel: 'PR Completed'
  },
  'PENDING FOR ORACLE ENTRY': {
    dateField: 'Oracle Entry',
    nextStatus: 'PENDING FOR DESIGN TO EMS',
    completionLabel: 'Oracle Entry Done'
  },
  'PENDING FOR DESIGN TO EMS': {
    dateField: 'Design to EMS Date',
    nextStatus: 'DONE',
    completionLabel: 'Sent to EMS'
  },
  'DONE': {
    dateField: null,
    nextStatus: null,
    completionLabel: null
  }
};

export const CONTROLLABLE_PAGES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'orders', label: 'Orders' },
  { id: 'backup-requests', label: 'Backup Die Requests' },
  { id: 'frozen-designs', label: 'Frozen Designs' },
  { id: 'qd-tracker', label: 'QD Tracker' },
  // Individual Process Flow pages
  { id: 'flow-pending-order', label: 'Pending Order', group: 'Process Flow' },
  { id: 'flow-awaiting-design', label: 'Awaiting Design', group: 'Process Flow' },
  { id: 'flow-simulation', label: 'Simulation', group: 'Process Flow' },
  { id: 'flow-design-approval', label: 'Design Approval', group: 'Process Flow' },
  { id: 'flow-pending-pr', label: 'Pending PR', group: 'Process Flow' },
  { id: 'flow-oracle-entry', label: 'Oracle Entry', group: 'Process Flow' },
  { id: 'flow-design-ems', label: 'Design to EMS', group: 'Process Flow' },
  { id: 'flow-completed', label: 'In Manufacturing', group: 'Process Flow' },
  { id: 'flow-sample-followup', label: 'Sample Followup', group: 'Process Flow' },
  { id: 'email-inbox', label: 'Email Inbox' },
  { id: 'analytics', label: 'Analytics' },
];

// Preset reasons for bypassing a frozen design and following the normal flow.
export const BYPASS_REASONS = ['Profile revised', 'Customer change', 'Quality issue', 'Other'];

// QD Tracker status vocabulary — colours match the QD Tracker design.
export const QD_STATUS_CONFIG = {
  'Open':             { fg: '#FBBF24', bg: 'rgba(245,158,11,0.15)' },
  'Sent to Supplier': { fg: '#60A5FA', bg: 'rgba(59,130,246,0.15)' },
  'FOC Accepted':     { fg: '#34D399', bg: 'rgba(16,185,129,0.15)' },
  // In the plant but not yet trialled — the replacement has arrived and still
  // has to prove itself, so it is neither outstanding nor settled.
  'FOC Received':     { fg: '#F0ABFC', bg: 'rgba(232,121,249,0.15)' },
  'Rejected':         { fg: '#FCA5A5', bg: 'rgba(239,68,68,0.15)' },
  'Reference':        { fg: '#A1A1AA', bg: 'rgba(161,161,170,0.14)' },
  'Rework In-house':  { fg: '#A78BFA', bg: 'rgba(139,92,246,0.15)' },
  'Closed':           { fg: '#22D3EE', bg: 'rgba(6,182,212,0.14)' },
};

export const QD_STATUSES = Object.keys(QD_STATUS_CONFIG);

export const QD_OUTCOMES = ['Supplier rework', 'FOC replacement', 'In-house correction', 'Credit note', 'Reference only'];

// Fact-card fields that stay editable for the QD's whole life, because they
// only become knowable after it has been approved and sent out. Everything else
// on the card is Part-A and locks once the QD leaves Draft/SentBack — the server
// enforces this in EDITABLE_FIELDS (`progress`) in services/qualityDiscrepancies.cjs;
// this list only decides whether the drawer offers the pencil. Keep them in step.
export const QD_PROGRESS_FIELDS = new Set([
  'eta_date', 'sent_to_purchase_date', 'sent_to_supplier_date',
  'supplier_acceptance', 'action_taken', 'supplier_comments', 'received_by_supplier',
]);

// Activity timeline dot tones — copied from the QD Tracker design's `tones` map.
export const QD_ACTIVITY_TONES = {
  flag:    { bg: 'rgba(245,158,11,0.18)', fg: '#FBBF24' },
  send:    { bg: 'rgba(59,130,246,0.18)', fg: '#60A5FA' },
  bad:     { bg: 'rgba(239,68,68,0.18)',  fg: '#FCA5A5' },
  good:    { bg: 'rgba(16,185,129,0.18)', fg: '#34D399' },
  neutral: { bg: 'rgba(161,161,170,0.16)', fg: '#A1A1AA' },
};
