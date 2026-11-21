import React, { useEffect, useRef, useState } from 'react';
import { FileSpreadsheet, FileText, Download } from 'lucide-react';
import { sampleFollowupsAPI } from '../../api';
import { todayLocal, previousMonth } from '../../utils/today';

// Header button + popover for the Sample Approval Followup report. The waiting
// list is always as of today; the month only sets the "Last month" section.
const ApprovalReportMenu = ({ onError }) => {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => previousMonth(todayLocal()));
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const monthRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    monthRef.current?.focus();
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const download = async (kind) => {
    if (busyRef.current || !/^\d{4}-\d{2}$/.test(month)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const blob = await sampleFollowupsAPI.approvalReport(month, kind);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Sample-Approval-${month}.${kind}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      onError(`Approval report failed: ${error.message}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button ref={buttonRef} type="button" className="sf-button sf-button-header"
        aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <FileSpreadsheet size={16} />Approval report
      </button>
      {open && (
        <div className="sf-card" role="dialog" aria-label="Approval report"
          style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 30, width: 280, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="sf-card-label" htmlFor="sf-approval-month" style={{ margin: 0 }}>Report month</label>
          <input id="sf-approval-month" ref={monthRef} type="month" value={month}
            onChange={(e) => setMonth(e.target.value)}
            style={{ background: 'var(--sf-raised)', color: 'var(--sf-text)', border: '1px solid var(--sf-border-strong)', borderRadius: 8, padding: '8px 10px', fontSize: '.9rem' }} />
          <p className="sf-card-foot" style={{ margin: 0 }}>Waiting list is as of today; the month sets the "Last month" section.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="sf-button" disabled={busy || !month} aria-busy={busy} onClick={() => download('pdf')}>
              <FileText size={15} />{busy ? 'Preparing…' : 'Download PDF'}
            </button>
            <button type="button" className="sf-button" disabled={busy || !month} aria-busy={busy} onClick={() => download('xlsx')}>
              <Download size={15} />{busy ? 'Preparing…' : 'Download Excel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ApprovalReportMenu;
