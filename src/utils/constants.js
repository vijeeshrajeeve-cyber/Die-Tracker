import { ShoppingCart, Pencil, Cpu, CheckSquare, FileText, Database, Send, Factory, Eye, Clock, AlertTriangle, Package, TrendingUp, Truck, XCircle, Layers } from 'lucide-react';

// Status configuration with colors, icons, and labels.
//
// This is the ONLY copy. DieOrderingSystem used to carry a second one that had
// drifted — it knew 'DIE RECEIVED' while this one did not, so orders in that
// status rendered as a cyan pill in the detail modal and as raw grey
// "DIE RECEIVED" text in the register. Anything needing a status colour imports
// from here.
//
// Each status carries two pairs. `color`/`bgColor` are the light-theme pill:
// dark ink on a pale tint. `darkColor`/`darkBgColor` are the dark-theme pill:
// a light tint of the same hue over an alpha wash, so the pill sits *in* the
// dark surface instead of punching a near-white chip through it — the old
// single pair was theme-independent, and a register of 50 rows was 50 glare
// points in the dark theme the app defaults to.
//
// Every pair is measured at >= 4.5:1 against its own background (and the dark
// pairs against both `cardBg` #131316 and page `bg` #09090b, since pills appear
// on each). The pill text is 12px/600, which is not WCAG "large", so 4.5 is the
// bar — the previous values ran 2.07-4.41 and failed it in eight of eleven
// cases. All eleven foregrounds are distinct, so no two statuses collide.
export const STATUS_CONFIG = {
  'AWAITING FOR DESIGN': { color: '#B91C1C', bgColor: '#FEF2F2', darkColor: '#F87171', darkBgColor: 'rgba(239,68,68,0.18)', icon: Clock, label: 'Awaiting Design' },
  'PENDING FOR DESIGN APPROVAL': { color: '#C2410C', bgColor: '#FFF7ED', darkColor: '#FB923C', darkBgColor: 'rgba(249,115,22,0.18)', icon: AlertTriangle, label: 'Design Approval' },
  'UNDER SIMULATION': { color: '#7C3AED', bgColor: '#F5F3FF', darkColor: '#A78BFA', darkBgColor: 'rgba(139,92,246,0.18)', icon: Layers, label: 'Simulation' },
  'PENDING FOR DESIGN TO EMS': { color: '#2563EB', bgColor: '#EFF6FF', darkColor: '#60A5FA', darkBgColor: 'rgba(59,130,246,0.18)', icon: Package, label: 'Design to EMS' },
  'PENDING FOR PR': { color: '#B45309', bgColor: '#FFFBEB', darkColor: '#F59E0B', darkBgColor: 'rgba(245,158,11,0.18)', icon: TrendingUp, label: 'Pending PR' },
  // Deliberately a burnt orange one step off Design Approval's, in both themes:
  // the two sit next to each other in the flow and must not read as one status.
  'PENDING FOR ORACLE ENTRY': { color: '#9A3412', bgColor: '#FFF7ED', darkColor: '#F97316', darkBgColor: 'rgba(194,65,12,0.20)', icon: Factory, label: 'Oracle Entry' },
  'PENDING FOR ORDERING': { color: '#0F766E', bgColor: '#F0FDFA', darkColor: '#14B8A6', darkBgColor: 'rgba(20,184,166,0.18)', icon: Truck, label: 'Pending Order' },
  'DONE': { color: '#15803D', bgColor: '#F0FDF4', darkColor: '#22C55E', darkBgColor: 'rgba(34,197,94,0.18)', icon: CheckSquare, label: 'In Manufacturing' },
  // Set by hasDieReceivedDate() when a spreadsheet import marks STATUS=DONE but
  // a Die Received Date is present — those completes belong in Sample Followup,
  // not the In Manufacturing flow.
  'DIE RECEIVED': { color: '#0E7490', bgColor: '#ECFEFF', darkColor: '#06B6D4', darkBgColor: 'rgba(6,182,212,0.18)', icon: Package, label: 'Die Received' },
  'CANCELLED': { color: '#4B5563', bgColor: '#F3F4F6', darkColor: '#9CA3AF', darkBgColor: 'rgba(156,163,175,0.16)', icon: XCircle, label: 'Cancelled' },
  'HOLD': { color: '#374151', bgColor: '#F9FAFB', darkColor: '#D1D5DB', darkBgColor: 'rgba(156,163,175,0.10)', icon: AlertTriangle, label: 'On Hold' },
};

// Unknown statuses land here rather than on an ad-hoc literal at each call site.
export const STATUS_FALLBACK = { color: '#4B5563', bgColor: '#F3F4F6', darkColor: '#9CA3AF', darkBgColor: 'rgba(156,163,175,0.16)' };

/** Resolve a status to the pill colours for the active theme. */
export const statusColors = (status, isDark, config = STATUS_CONFIG) => {
  const c = config[status] || STATUS_FALLBACK;
  return {
    fg: (isDark ? c.darkColor : c.color) || STATUS_FALLBACK.color,
    bg: (isDark ? c.darkBgColor : c.bgColor) || STATUS_FALLBACK.bgColor,
    label: c.label || status,
  };
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

// Derived from STATUS_CONFIG so the two cannot drift again. This now includes
// 'DIE RECEIVED', which is a real persisted status — FlowPage's die-receivance
// action and hasDieReceivedDate both write it — but was missing from the list
// while the other STATUS_CONFIG copy knew about it. The server keeps its own
// whitelist in routes/orders.cjs for the revision and received-field endpoints;
// the PATCH route that writes 'DIE RECEIVED' only sanitises, so the two lists
// differing there is intentional rather than a gap.
export const VALID_STATUSES = Object.keys(STATUS_CONFIG);

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

// Backup request status configuration. Same two-pair scheme and same measured
// floor as STATUS_CONFIG above — 'Pending' was the worst pill in the app at
// 2.07:1 (amber #F59E0B on a near-white #FFFBEB), well under half the AA bar.
export const BACKUP_REQUEST_STATUS_CONFIG = {
  'Pending': { color: '#B45309', bgColor: '#FFFBEB', darkColor: '#F59E0B', darkBgColor: 'rgba(245,158,11,0.18)', label: 'Pending' },
  'Completed': { color: '#15803D', bgColor: '#F0FDF4', darkColor: '#22C55E', darkBgColor: 'rgba(34,197,94,0.18)', label: 'Completed' },
  'HOLD': { color: '#374151', bgColor: '#F9FAFB', darkColor: '#D1D5DB', darkBgColor: 'rgba(156,163,175,0.10)', label: 'HOLD' },
  'Not required': { color: '#4B5563', bgColor: '#F3F4F6', darkColor: '#9CA3AF', darkBgColor: 'rgba(156,163,175,0.16)', label: 'Not required' },
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

export const APP_NAME = 'Die Ordering System';

// Browser-tab titles. Built from CONTROLLABLE_PAGES so the navigable pages
// cannot fall out of step, plus the admin-only pages that are not access
// controlled and so never appear in that list.
export const PAGE_TITLES = {
  ...Object.fromEntries(CONTROLLABLE_PAGES.map(p => [p.id, p.label])),
  'settings': 'Settings',
  'email-settings': 'Email Settings',
  'users': 'Users',
  'existing-data': 'Existing Data',
};

/** "Orders · Die Ordering System" — page first, so it survives tab truncation. */
export const pageTitle = (tabId) => {
  const label = PAGE_TITLES[tabId];
  return label ? `${label} · ${APP_NAME}` : APP_NAME;
};

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

// Approval-state pill, shared by the QD drawer header and the register so the
// two cannot drift apart. Moved here from QDDetailPanel, where it was private
// and the register would have needed a second copy.
export const QD_APPROVAL_BADGE = {
  Draft:    { label: 'Draft',     bg: 'rgba(161,161,170,0.15)', fg: '#a1a1aa' },
  Pending:  { label: 'Pending',   bg: 'rgba(234,179,8,0.15)',   fg: '#EAB308' },
  Approved: { label: 'Approved',  bg: 'rgba(34,197,94,0.15)',   fg: '#22C55E' },
  SentBack: { label: 'Sent back', bg: 'rgba(239,68,68,0.15)',   fg: '#EF4444' },
};

// Which of those the register marks. Approved is left out on purpose: most QDs
// end up approved, and a pill on nearly every row teaches the eye to skip it.
export const QD_LIST_BADGE_STATES = ['Draft', 'Pending', 'SentBack'];
