import { useRef, useEffect, forwardRef } from 'react';

const ChatArea = forwardRef(function ChatArea({ children, lessonName, scrollTrigger }, ref) {
  const localRef = useRef(null);
  const scrollRef = ref || localRef;
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [scrollTrigger]);

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
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  );
});

export default ChatArea;
