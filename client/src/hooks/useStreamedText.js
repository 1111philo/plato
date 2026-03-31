import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Smoothly reveals streamed text at a steady typing cadence.
 *
 * rawText: the full accumulated text from the API (or null when not streaming).
 * Returns [displayText, isDraining]:
 *   - displayText: the portion to render (null when inactive)
 *   - isDraining: true while the drain is still catching up to the buffer
 */
export function useStreamedText(rawText) {
  const [display, setDisplay] = useState(null);
  const bufferRef = useRef('');
  const posRef = useRef(0);
  const doneRef = useRef(false);   // API finished sending
  const activeRef = useRef(false);
  const timerRef = useRef(null);

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
      setDisplay('');
    }
    bufferRef.current = rawText;
  }, [rawText]);

  // Drain buffer at a steady pace
  useEffect(() => {
    if (!activeRef.current && rawText == null) return;
    if (timerRef.current) return; // already running

    timerRef.current = setInterval(() => {
      const target = bufferRef.current;

      if (posRef.current < target.length) {
        posRef.current++;
        setDisplay(target.slice(0, posRef.current));
      } else if (doneRef.current) {
        // Drain caught up and API is done — finish
        clearInterval(timerRef.current);
        timerRef.current = null;
        activeRef.current = false;
        // Final display is the complete text (or null to hand off to messages)
        setDisplay(null);
        bufferRef.current = '';
        posRef.current = 0;
        doneRef.current = false;
      }
      // else: drain caught up but API still sending — wait for more
    }, 30);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rawText]);

  return display;
}
