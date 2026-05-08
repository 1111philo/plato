import { useCallback } from 'react';

const TEXTAREA_MIN_ROWS = 1;
const TEXTAREA_LINE_HEIGHT = 24;

export function useAutoResize(maxHeight = 200) {
  return useCallback((e) => {
    const el = e.target;
    el.style.height = '0';
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(next, TEXTAREA_LINE_HEIGHT * TEXTAREA_MIN_ROWS)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [maxHeight]);
}
