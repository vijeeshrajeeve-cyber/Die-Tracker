// Status configuration with colors and icons
export const STATUS_CONFIG = {
  'AWAITING FOR DESIGN': { color: '#DC2626', bgColor: '#FEF2F2', label: 'Awaiting Design' },
  'PENDING FOR DESIGN APPROVAL': { color: '#EA580C', bgColor: '#FFF7ED', label: 'Design Approval' },
  'UNDER SIMULATION': { color: '#7C3AED', bgColor: '#F5F3FF', label: 'Simulation' },
  'PENDING FOR DESIGN TO EMS': { color: '#2563EB', bgColor: '#EFF6FF', label: 'Design to EMS' },
  'PENDING FOR PR': { color: '#D97706', bgColor: '#FFFBEB', label: 'Pending PR' },
  'PENDING FOR ORACLE ENTRY': { color: '#C2410C', bgColor: '#FFF7ED', label: 'Oracle Entry' },
  'PENDING FOR ORDERING': { color: '#0D9488', bgColor: '#F0FDFA', label: 'Pending Order' },
  'DONE': { color: '#16A34A', bgColor: '#F0FDF4', label: 'Completed' },
  'CANCELLED': { color: '#6B7280', bgColor: '#F3F4F6', label: 'Cancelled' },
  'HOLD': { color: '#4B5563', bgColor: '#F9FAFB', label: 'On Hold' },
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
