import { MONTHS } from './constants';

// Parse Excel date serial number to ISO string
export const parseExcelDate = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return null;
};

// Get month abbreviation from date string
export const getMonthFromDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    return MONTHS[new Date(dateStr).getMonth()];
  } catch {
    return null;
  }
};

// Normalize column names from imported data
export const normalizeColumnName = (col) => {
  const mappings = {
    'pr no.:': 'PR No.',
    'pr no': 'PR No.',
    'die no': 'DIE NO',
    'order no': 'Order No',
    'die size': 'Die Size',
    'die requested date': 'Die Requested Date',
    'ordered date': 'Ordered date',
    'type of shipment': 'Type of shipment',
    'mandrels per cavity': 'Mandrels per Cavity',
    'total mandrels': 'Total Mandrels',
    'design received date': 'Design Received Date',
    'design approved date': 'Design Approved Date',
    'pr entry': 'PR Entry',
    'pr number': 'PR Number',
    'pr no.': 'PR Number',
    'customer name': 'Customer Name',
    'customer': 'Customer Name',
    'die received date': 'Die Received Date',
    'submission date': 'Submission Date',
    'sample approval date': 'Sample Approval Date',
    'no of trial': 'No of Trial',
    'no. of trial': 'No of Trial',
    'corrector': 'Corrector',
    'press': 'Press',
    'ascona reference': 'Ascona Reference',
    'ascona ref': 'Ascona Reference',
    'sample status': 'Sample Status',
    'remark': 'Remark',
    'remarks': 'Remark',
    'oracle entry': 'Oracle Entry',
    'overall delay': 'OVERALL DELAY',
    'status': 'STATUS',
    'plant': 'Plant',
    'type': 'TYPE',
    'supplier': 'Supplier',
    'eta': 'ETA',
    'delay': 'Delay',
  };
  return mappings[col.toLowerCase().trim()] || col;
};

// Parse date in DD/MM/YYYY format
export const parseDateDMY = (dateStr) => {
  if (!dateStr) return null;
  // Support DD/MM/YYYY, DD-MM-YYYY, and DD.MM.YYYY formats
  const match = dateStr.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return null;
};

// Format date for display
export const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  } catch {
    return dateStr;
  }
};

// Calculate statistics from orders data
export const calculateStats = (data) => {
  const total = data.length;
  const completed = data.filter(o => o.STATUS === 'DONE').length;
  const pending = data.filter(o => !['DONE', 'CANCELLED'].includes(o.STATUS)).length;
  const cancelled = data.filter(o => o.STATUS === 'CANCELLED').length;
  const delayedOrders = data.filter(o => o.Delay > 0);
  const avgDelay = delayedOrders.length > 0
    ? (delayedOrders.reduce((sum, o) => sum + (o.Delay || 0), 0) / delayedOrders.length).toFixed(1)
    : '0';
  return { total, completed, pending, cancelled, avgDelay };
};

// Generate notifications from orders
export const generateNotifications = (data) => {
  const notifications = [];
  const now = new Date();

  data.forEach(order => {
    if (order.STATUS === 'AWAITING FOR DESIGN' && order['Die Requested Date']) {
      const requestDate = new Date(order['Die Requested Date']);
      const hoursDiff = (now - requestDate) / (1000 * 60 * 60);
      if (hoursDiff > 48) {
        notifications.push({
          type: 'urgent',
          title: 'Design Overdue',
          message: `Die ${order['DIE NO']} awaiting design for ${Math.floor(hoursDiff)}+ hours`,
          order
        });
      }
    }
    if (order.STATUS === 'PENDING FOR ORDERING' && order['Oracle Entry']) {
      const oracleDate = new Date(order['Oracle Entry']);
      const hoursDiff = (now - oracleDate) / (1000 * 60 * 60);
      if (hoursDiff > 24) {
        notifications.push({
          type: 'warning',
          title: 'Pending Ordering',
          message: `Die ${order['DIE NO']} ready for ordering`,
          order
        });
      }
    }
  });

  return notifications;
};
