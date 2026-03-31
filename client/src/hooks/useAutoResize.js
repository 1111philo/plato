import { useCallback } from 'react';

export function useAutoResize(maxHeight = 120) {
  return useCallback((e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px';
  }, [maxHeight]);
}
