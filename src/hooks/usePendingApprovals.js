import { useCallback, useEffect, useState } from 'react';
import { qualityDiscrepanciesAPI } from '../api';

const POLL_MS = 60000;

// The approver's pending queue, shared by the Alerts bell and the QD Tracker
// banner so the two can never disagree.
//
// `enabled` MUST be false for users without qd-tracker access: the endpoint sits
// behind pageAccessMiddleware('qd-tracker'), so polling on their behalf would
// 403 once a minute for their whole session.
export default function usePendingApprovals(enabled) {
  const [state, setState] = useState({ count: 0, qds: [] });

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await qualityDiscrepanciesAPI.pendingApprovals();
      setState({ count: r.count || 0, qds: r.qds || [] });
    } catch {
      // A failed poll must never break the top bar. The next tick retries, and
      // showing a stale count beats showing an error in a notification bell.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    // The first fetch is kicked off a tick late rather than called straight from
    // the effect body: refresh() reaches setState, and this repo's lint counts
    // any setState reachable from an effect body as a cascading render.
    const kick = setTimeout(refresh, 0);
    const id = setInterval(refresh, POLL_MS);
    // Returning to the tab is exactly when the count is most likely stale.
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);

  return { count: state.count, qds: state.qds, refresh };
}
