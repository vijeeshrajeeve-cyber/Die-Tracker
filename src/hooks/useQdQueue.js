import { useCallback, useEffect, useState } from 'react';
import { qualityDiscrepanciesAPI } from '../api';

const POLL_MS = 60000;
const EMPTY = { awaitingApproval: { count: 0, qds: [] }, sentBack: { count: 0, qds: [] } };

// What the signed-in user personally owes, shared by the Alerts bell and the QD
// Tracker banners so they can never disagree. One request covers both buckets.
//
// `enabled` MUST be false for users without qd-tracker access: the endpoint sits
// behind pageAccessMiddleware('qd-tracker'), so polling on their behalf would
// 403 once a minute for their whole session.
export default function useQdQueue(enabled) {
  const [state, setState] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await qualityDiscrepanciesAPI.myQueue();
      setState({
        awaitingApproval: { count: r.awaitingApproval?.count || 0, qds: r.awaitingApproval?.qds || [] },
        sentBack: { count: r.sentBack?.count || 0, qds: r.sentBack?.qds || [] },
      });
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
    // Returning to the tab is exactly when the counts are most likely stale.
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [enabled, refresh]);

  return {
    awaitingApproval: state.awaitingApproval,
    sentBack: state.sentBack,
    total: state.awaitingApproval.count + state.sentBack.count,
    refresh,
  };
}
