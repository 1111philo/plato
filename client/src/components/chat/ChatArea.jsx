import { useRef, useEffect, forwardRef } from 'react';

const NEAR_BOTTOM_PX = 150; // accounts for fixed compose bar + spacer

const ChatArea = forwardRef(function ChatArea({ children, lessonName }, ref) {
  const localRef = useRef(null);
  const scrollRef = ref || localRef;
  const programmaticScroll = useRef(false);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    const el = typeof scrollRef === 'function' ? null : scrollRef.current;
    if (!el) return;

    // Find the scroll container — could be the element itself or a parent
    let scrollContainer = document.documentElement;
    let sc = el;
    while (sc && sc !== document.documentElement) {
      const { overflowY } = getComputedStyle(sc);
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scrollContainer = sc;
        break;
      }
      sc = sc.parentElement;
    }

    function isNearBottom() {
      return scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < NEAR_BOTTOM_PX;
    }

    function scrollToBottom() {
      programmaticScroll.current = true;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }

    function handleScroll() {
      if (programmaticScroll.current) {
        programmaticScroll.current = false;
        return;
      }
      nearBottomRef.current = isNearBottom();
    }

    const observer = new MutationObserver(() => {
      if (nearBottomRef.current) scrollToBottom();
    });

    observer.observe(el, { childList: true, subtree: true, characterData: true });
    scrollContainer.addEventListener('scroll', handleScroll);

    return () => {
      observer.disconnect();
      scrollContainer.removeEventListener('scroll', handleScroll);
    };
  }, [scrollRef]);

  return (
    <div
      className="p-4 text-base"
      role="log"
      aria-live="polite"
      aria-label={lessonName ? `${lessonName} conversation` : 'Lesson conversation'}
      ref={scrollRef}
    >
      <div className="mx-auto max-w-3xl space-y-3">
        {children}
      </div>
    </div>
  );
});

export default ChatArea;
