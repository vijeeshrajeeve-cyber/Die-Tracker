// What the Confirm Die Receivance modal sends, and whether it may offer to
// skip the sample trial.
//
// Tooling and some Backup dies are fit for use the moment they arrive, so the
// receipt can stamp the sample fields straight away instead of leaving the
// die Pending on the Sample Followup page for someone to close by hand. The
// option is a per-die human choice, which is why it lives in the form rather
// than as a server rule: Tooling defaults on, Backup defaults off, New dies
// never see it. Nothing is persisted beyond the stamped fields and the
// change-log reason — zero logged trials plus Approved is what a skipped die
// looks like, and the audit entry says why.

const TYPE_LABELS = { T: 'Tooling', B: 'Backup', N: 'New' };

export const skipTrialAllowed = (type) => type === 'T' || type === 'B';

export const skipTrialDefault = (type) => type === 'T';

export const buildReceivancePatch = ({ order, form, skipTrial }) => {
  const date = form.die_received_date;
  const corrector = (form.corrector || '').trim();
  const skipping = !!skipTrial && skipTrialAllowed(order.TYPE);
  const reason = skipping
    ? `Corrector: ${corrector} · Trial skipped (${TYPE_LABELS[order.TYPE]})`
    : `Corrector: ${corrector}`;

  const logEntry = {
    date,
    field: 'STATUS',
    oldValue: order.STATUS,
    newValue: 'DIE RECEIVED',
    stage: order.STATUS,
    reason,
  };

  const patch = {
    STATUS: 'DIE RECEIVED',
    'Die Received Date': date,
    'Corrector': corrector,
    'Press': order['Press'] || order.Plant || '',
    'Ascona Reference': order['Ascona Reference'] || 'No',
    'Sample Status': order['Sample Status'] || 'Pending',
    'Change Log': [logEntry],
  };

  if (skipping) {
    patch['Submission Date'] = date;
    patch['Sample Approval Date'] = date;
    patch['No of Trial'] = 0;
    patch['Sample Status'] = 'Approved';
  }

  return { patch, logEntry };
};
