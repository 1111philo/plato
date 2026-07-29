import { useState, useEffect, useRef } from 'react';

/**
 * Smoothly reveals streamed text at a steady typing cadence.
 *
 * rawText: the full accumulated text from the API (or null when not streaming).
 * Returns [displayText, isDraining]:
 *   - displayText: the portion to render (null when inactive)
 *   - isDraining: true while the drain is still catching up to the buffer
 *
 * Continues streaming in background tabs (browsers throttle setInterval to 1000ms
 * when hidden, making it appear that streaming paused). When the tab becomes visible
 * again, the display catches up immediately.
 */
export function useStreamedText(rawText) {
  const [display, setDisplay] = useState(null);
  const bufferRef = useRef('');
  const posRef = useRef(0);
  const doneRef = useRef(false);   // API finished sending
  const activeRef = useRef(false);
  const timerRef = useRef(null);
  const lastTickRef = useRef(0);

  // Update buffer when new text arrives
  useEffect(() => {
    if (rawText == null) {
      // API is done — mark it but DON'T reset yet. Let the drain finish.
      doneRef.current = true;
      return;
    }
    // New stream starting
    if (!activeRef.current) {
      activeRef.current = true;
      doneRef.current = false;
      posRef.current = 0;
      lastTickRef.current = Date.now();
      setDisplay('');
    }
    bufferRef.current = rawText;
  }, [rawText]);

  // Drain buffer at a steady pace, continuing in background
  useEffect(() => {
    if (!activeRef.current && rawText == null) return;
    if (timerRef.current) return; // already running

    const tick = () => {
      const now = Date.now();
      const elapsed = now - lastTickRef.current;
      const target = bufferRef.current;

      // Catch up if we were throttled (e.g., tab was hidden)
      // Advance by at least 1 char, or more if time has passed
      const charsToAdd = Math.max(1, Math.floor(elapsed / 30));
      const newPos = Math.min(posRef.current + charsToAdd, target.length);

      if (newPos > posRef.current) {
        posRef.current = newPos;
        lastTickRef.current = now;
        setDisplay(target.slice(0, posRef.current));
      }

      if (posRef.current >= target.length && doneRef.current) {
        // Drain caught up and API is done — finish
        clearInterval(timerRef.current);
        timerRef.current = null;
        activeRef.current = false;
        setDisplay(null);
        bufferRef.current = '';
        posRef.current = 0;
        doneRef.current = false;
      }
    };

    timerRef.current = setInterval(tick, 30);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rawText]);

  // Catch up immediately when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && activeRef.current) {
        // Reset timer to catch up now that we're visible
        lastTickRef.current = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return display;
}
