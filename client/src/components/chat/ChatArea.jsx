import { useRef, useEffect, useCallback, forwardRef, useState } from 'react';
import { useChatKeyboardNav } from '../../hooks/useChatKeyboardNav.js';

const ChatArea = forwardRef(function ChatArea({ children, scrollTrigger, announcement }, ref) {
  const logRef = useRef(null);
  const bottomRef = useRef(null);
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);

  // Merge the forwarded ref with our internal logRef
  const setRefs = useCallback((node) => {
    logRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  useChatKeyboardNav(logRef);

  // Track user scroll to detect when they've manually scrolled away from bottom
  useEffect(() => {
    const container = logRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Consider "at bottom" if within 50px of the bottom
      const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
      setUserHasScrolledUp(!isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // Only auto-scroll if user hasn't manually scrolled up
    if (!userHasScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [scrollTrigger, userHasScrolledUp]);

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
        <div ref={bottomRef} aria-hidden="true" />
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
