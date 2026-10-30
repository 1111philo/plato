import { useState, useEffect, useRef } from 'react';
import { useApp } from '../contexts/AppContext.jsx';
import { nextRevealPosition, wantsInstantText, prefersReducedMotion, REVEAL_MS_PER_CHAR } from '../lib/chatPrefs.js';

/**
 * Reveals streamed text at a typing cadence (pacing: `nextRevealPosition` in
 * lib/chatPrefs.js, which also keeps the reveal close behind a fast stream
 * and drains quickly once it's done, #247).
 *
 * rawText: the full accumulated text from the API (or null when not streaming).
 * Returns the portion to render, or null when inactive. It goes null only
 * after the reveal has caught up with a finished stream; chat pages wait for
 * that to append the persisted message.
 *
 * Instant mode (the learner's "Show coach replies instantly" preference, or
 * prefers-reduced-motion when they haven't chosen) shows each chunk as it
 * arrives. Background tabs throttle the timer; the elapsed-time step catches
 * up, and returning to the tab shows everything buffered at once.
 */
export function useStreamedText(rawText) {
  const { state } = useApp();
  const instant = wantsInstantText(state.preferences, prefersReducedMotion());
  const instantRef = useRef(instant);
  useEffect(() => { instantRef.current = instant; }, [instant]);

  const [display, setDisplay] = useState(null);
  const bufferRef = useRef('');
  const posRef = useRef(0);
  const doneRef = useRef(false);   // API finished sending
  const activeRef = useRef(false);
  const timerRef = useRef(null);
  const lastTickRef = useRef(0);
  const catchUpRef = useRef(false); // tab just became visible

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
      const target = bufferRef.current;
      const newPos = nextRevealPosition({
        pos: posRef.current,
        length: target.length,
        elapsedMs: now - lastTickRef.current,
        done: doneRef.current,
        instant: instantRef.current || catchUpRef.current,
      });
      catchUpRef.current = false;

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

    timerRef.current = setInterval(tick, REVEAL_MS_PER_CHAR);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [rawText]);

  // Returning to the tab: show everything buffered on the next tick rather
  // than resuming the typing animation from where the throttled timer left it.
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden && activeRef.current) catchUpRef.current = true;
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return display;
}
