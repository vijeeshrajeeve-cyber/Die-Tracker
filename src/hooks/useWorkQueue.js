import { useCallback, useEffect, useRef, useState } from 'react';
import { workQueueAPI } from '../workQueueAPI';

export default function useWorkQueue(filters) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const active = useRef(null);
  const { scope, bucket, plant, q, page, limit = 50 } = filters;

  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    try {
      const result = await workQueueAPI.list({ scope, bucket, plant, q, page, limit }, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setError(null);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure.status === 401 || failure.status === 403) setData(null);
      setError(failure);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [scope, bucket, plant, q, page, limit]);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const pollVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const poll = setInterval(pollVisible, 60000);
    window.addEventListener('focus', pollVisible);
    document.addEventListener('visibilitychange', pollVisible);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
      active.current?.abort();
      window.removeEventListener('focus', pollVisible);
      document.removeEventListener('visibilitychange', pollVisible);
    };
  }, [refresh]);

  return { data, loading, error, refresh };
}
