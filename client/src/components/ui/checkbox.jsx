import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Simple checkbox component using native HTML input[type="checkbox"]
 * styled to match the design system.
 */
const Checkbox = forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => {
  return (
    <input
      type="checkbox"
      ref={ref}
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      className={cn(
        "size-4 shrink-0 rounded border border-border bg-background cursor-pointer",
        "transition-colors outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "checked:bg-primary checked:border-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
});

Checkbox.displayName = 'Checkbox';

export { Checkbox };
