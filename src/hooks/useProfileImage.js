import { useEffect, useState } from 'react';
import { ordersAPI } from '../api';

// fileId -> Promise of an object URL. A stored image never changes (a new one
// gets a new file id), so the URL is kept for the page's lifetime and the
// search palette does not refetch the same thumbnail on every keystroke.
const cache = new Map();

function loadUrl(orderId, fileId) {
  if (!cache.has(fileId)) {
    const pending = ordersAPI.fileBlob(orderId, fileId)
      .then((blob) => URL.createObjectURL(blob))
      .catch((err) => { cache.delete(fileId); throw err; });
    cache.set(fileId, pending);
  }
  return cache.get(fileId);
}

/** Object URL of an order's stored profile image, or null while loading or when there is none. */
export default function useProfileImage(orderId, fileId) {
  // Remember which file the URL belongs to, so a stale one is never shown for another.
  const [loaded, setLoaded] = useState({ fileId: null, url: null });
  useEffect(() => {
    if (!orderId || !fileId) return undefined;
    let cancelled = false;
    loadUrl(orderId, fileId)
      .then((url) => { if (!cancelled) setLoaded({ fileId, url }); })
      .catch((err) => console.error('Failed to load profile image:', err));
    return () => { cancelled = true; };
  }, [orderId, fileId]);
  return fileId && loaded.fileId === fileId ? loaded.url : null;
}
