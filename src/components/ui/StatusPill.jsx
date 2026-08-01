import React from 'react';
import { STATUS_CONFIG, BACKUP_REQUEST_STATUS_CONFIG, statusColors } from '../../utils/constants';

/**
 * The status pill, in one place.
 *
 * There were three copies of this — DieOrderingSystem (dead, never rendered),
 * OrdersPage, and BackupDieRequests — each with its own hard-coded fallback
 * colour, and all three painted a fixed near-white chip regardless of theme.
 * In the dark theme the app defaults to, a register of 50 rows meant 50 bright
 * chips punched through a #09090b page.
 *
 * `theme.isDark` picks the pair. Every component that renders a pill already
 * receives `theme`, so this needs no new plumbing; if a caller somehow has no
 * theme, it falls back to the light pair, which is the readable-on-anything one.
 */
const StatusPill = ({ status, theme = {}, config = STATUS_CONFIG, style }) => {
  const { fg, bg, label } = statusColors(status, theme.isDark, config);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        backgroundColor: bg,
        color: fg,
        ...style,
      }}
    >
      {label}
    </span>
  );
};

/** Backup-request statuses use their own vocabulary but the identical pill. */
export const BackupStatusPill = (props) => (
  <StatusPill {...props} config={BACKUP_REQUEST_STATUS_CONFIG} />
);

export default StatusPill;
