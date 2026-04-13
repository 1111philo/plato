import { useEffect } from 'react';

/**
 * Keyboard navigation for chat messages.
 *
 * When the chat log (or any descendant) is focused:
 *   Alt+ArrowDown → move focus to the next message
 *   Alt+ArrowUp   → move focus to the previous message
 *
 * @param {React.RefObject} logRef – ref to the chat log container element
 */
export function useChatKeyboardNav(logRef) {
  useEffect(() => {
    const log = logRef?.current;
    if (!log) return;

    function handleKeyDown(e) {
      if (!e.altKey) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

      const msgs = Array.from(log.querySelectorAll('[data-chat-message]'));
      if (msgs.length === 0) return;

      e.preventDefault();

      const current = document.activeElement;
      // Find the currently-focused message (or its ancestor message)
      let idx = msgs.indexOf(current);
      if (idx === -1) {
        // activeElement might be a child of a message
        idx = msgs.findIndex(m => m.contains(current));
      }

      let next;
      if (e.key === 'ArrowDown') {
        next = idx < msgs.length - 1 ? msgs[idx + 1] : msgs[msgs.length - 1];
      } else {
        next = idx > 0 ? msgs[idx - 1] : msgs[0];
      }

      if (next) next.focus();
    }

    log.addEventListener('keydown', handleKeyDown);
    return () => log.removeEventListener('keydown', handleKeyDown);
  }, [logRef]);
}
