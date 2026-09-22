import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bell, Check, Inbox, RefreshCw, X } from 'lucide-react';
import { workQueueAPI } from '../../workQueueAPI';
import useDialog from '../../hooks/useDialog';
import { dateLabel } from './view';

const LABELS = { assignment: 'Assigned to you', due_today: 'Due today', due_soon: 'Due soon', overdue: 'Overdue', escalation: 'Overdue escalation', note: 'Work update' };

export default function WorkQueueInbox({ onSelect }) {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(null);
  const active = useRef(null);
  const mounted = useRef(true);
  const dialogRef = useDialog({ open, onClose: () => setOpen(false), closeOnEscape: reading === null });
  const unread = notifications.filter(notification => !notification.read_at).length;

  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const result = await workQueueAPI.inbox(controller.signal);
      if (controller.signal.aborted) return;
      setNotifications(result.notifications || []);
      setError('');
    } catch (failure) {
      if (controller.signal.aborted) return;
      if ([401, 403].includes(failure.status)) { setNotifications([]); setOpen(false); }
      setError(failure.message);
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const initial = setTimeout(refresh, 0);
    const pollVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const interval = setInterval(pollVisible, 60000);
    window.addEventListener('focus', pollVisible);
    document.addEventListener('visibilitychange', pollVisible);
    return () => {
      mounted.current = false;
      active.current?.abort();
      clearTimeout(initial); clearInterval(interval);
      window.removeEventListener('focus', pollVisible);
      document.removeEventListener('visibilitychange', pollVisible);
    };
  }, [refresh]);

  async function read(notification, openItem) {
    setReading(notification.id); setError('');
    try {
      if (!notification.read_at) await workQueueAPI.readNotification(notification.id);
      if (!mounted.current) return;
      setNotifications(values => values.map(value => value.id === notification.id ? { ...value, read_at: value.read_at || new Date().toISOString() } : value));
      if (openItem) { setOpen(false); onSelect(notification.item_id); }
    } catch (failure) {
      if (mounted.current) {
        if ([401, 403].includes(failure.status)) setNotifications([]);
        setError(failure.message);
      }
    } finally { if (mounted.current) setReading(null); }
  }

  return <>
    <button type="button" className="wq-button" aria-haspopup="dialog" aria-expanded={open} aria-label={`Queue notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => { setOpen(true); refresh(); }}>
      <Bell size={16} />Notifications{unread > 0 && <span className="wq-unread-count">{unread}</span>}
    </button>
    {open && <div className="wq-overlay" onClick={event => { if (event.target === event.currentTarget && reading === null) setOpen(false); }}>
      <aside className="wq-drawer" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="wq-inbox-title" tabIndex={-1}>
        <header className="wq-drawer-header"><div><span className="wq-eyebrow">Work queue</span><h2 id="wq-inbox-title">Notifications</h2><p className="wq-help">{unread} unread · your internal reminders and updates</p></div><button type="button" className="wq-icon-button" disabled={reading !== null} aria-label="Close notifications" onClick={() => setOpen(false)}><X size={20} /></button></header>
        <div className="wq-actions"><button type="button" className="wq-button wq-button-small" disabled={loading} onClick={refresh}><RefreshCw size={14} />Refresh</button>{loading && <span className="wq-help" role="status">Checking notifications…</span>}</div>
        {error && <div className="wq-message wq-message-error" role="alert">{notifications.length ? 'These notifications may be out of date. ' : ''}{error}</div>}
        {!notifications.length && !loading && !error && <div className="wq-empty"><Inbox size={32} /><h3>No notifications yet</h3><p>Internal reminders appear here after they are enabled by an administrator.</p></div>}
        <ol className="wq-inbox-list">{notifications.map(notification => {
          const payload = notification.payload || {};
          return <li key={notification.id} className={notification.read_at ? '' : 'is-unread'}>
            <div className="wq-notification-heading"><strong>{LABELS[notification.kind] || String(notification.kind || 'Work update').replaceAll('_', ' ')}</strong>{!notification.read_at && <span className="wq-status">Unread</span>}</div>
            <button type="button" className="wq-record-link" disabled={reading !== null} onClick={() => read(notification, true)}>{payload.die_no || `Work item ${notification.item_id}`}<ArrowUpRight size={14} /></button>
            <p>{payload.stage_label || 'Open the work item for its next action'}{payload.plant ? ` · ${payload.plant}` : ''}</p>
            {payload.note && <p>{payload.note}</p>}
            <div className="wq-notification-footer"><time dateTime={notification.created_at}>{dateLabel(notification.created_at, payload.timezone || 'Asia/Dubai', true)}</time>{!notification.read_at && <button type="button" className="wq-button wq-button-small" disabled={reading !== null} onClick={() => read(notification, false)}><Check size={13} />Mark read</button>}</div>
          </li>;
        })}</ol>
      </aside>
    </div>}
  </>;
}
