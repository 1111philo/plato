import { useRef, useCallback, forwardRef } from 'react';
import { useChatKeyboardNav } from '../../hooks/useChatKeyboardNav.js';
import { useStickToBottom } from '../../hooks/useStickToBottom.js';

const ChatArea = forwardRef(function ChatArea({ children, announcement }, ref) {
  const logRef = useRef(null);

  // Merge the forwarded ref with our internal logRef
  const setRefs = useCallback((node) => {
    logRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useChatKeyboardNav(logRef);

  // Stay pinned to the bottom as content streams in — unless the reader has
  // scrolled up. See the hook for why this watches the DOM, not React state.
  useStickToBottom(logRef);

  return (
    <>
      <div
        className="p-4 text-base"
        role="log"
        tabIndex={0}
        aria-live="off"
        aria-label="Chat log"
        aria-description="Use Alt plus Arrow keys to navigate between messages"
        ref={setRefs}
      >
        <div className="mx-auto max-w-3xl space-y-3">
          {children}
        </div>
      </div>
      {/* Separate live region for screen reader announcements — kept outside the
          log so VoiceOver doesn't re-read chat history on every update */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </>
  );
});

export default ChatArea;
