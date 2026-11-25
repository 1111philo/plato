import { useRef, useEffect, useCallback } from 'react';

/**
 * Flashes a notification in the document title when the user isn't
 * focused on the page or the chat input. Restores the original title
 * on focus / visibility change.
 *
 * @param {string} baseTitle – the normal document title for this page
 * @returns {() => void} notify – call when a new message arrives
 */
export function useTitleNotification(baseTitle) {
  const hasPendingRef = useRef(false);

  useEffect(() => {
    function restore() {
      if (hasPendingRef.current) {
        hasPendingRef.current = false;
        document.title = baseTitle;
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') restore();
    }
    window.addEventListener('focus', restore);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', restore);
      document.removeEventListener('visibilitychange', onVisibility);
      if (hasPendingRef.current) document.title = baseTitle;
    };
  }, [baseTitle]);

  const notify = useCallback(() => {
    if (document.hidden || !document.hasFocus()) {
      hasPendingRef.current = true;
      document.title = `(New message) ${baseTitle}`;
    }
  }, [baseTitle]);

  return notify;
}
