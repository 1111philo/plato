import { useRef, useEffect, forwardRef } from 'react';

const NEAR_BOTTOM_PX = 80;

const ChatArea = forwardRef(function ChatArea({ children, courseName }, ref) {
  const localRef = useRef(null);
  const scrollRef = ref || localRef;
  const programmaticScroll = useRef(false);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const el = typeof scrollRef === 'function' ? null : scrollRef.current;
    if (!el) return;

    function isNearBottom() {
      return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    }

    function scrollToBottom() {
      programmaticScroll.current = true;
      el.scrollTop = el.scrollHeight;
    }

    function handleScroll() {
      // Ignore scroll events we triggered ourselves
      if (programmaticScroll.current) {
        programmaticScroll.current = false;
        return;
      }
      nearBottomRef.current = isNearBottom();
    }

    // Watch for ANY DOM change inside the container (new nodes, text growth, etc.)
    const observer = new MutationObserver(() => {
      if (nearBottomRef.current) scrollToBottom();
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('scroll', handleScroll);

    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', handleScroll);
    };
  }, [scrollRef]);

  return (
    <div className="chat" role="log" aria-live="polite" aria-label={courseName ? `${courseName} conversation` : 'Course conversation'} ref={scrollRef}>
      {children}
    </div>
  );
});

export default ChatArea;
