import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const SELECT_CLASS = 'h-10 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm';

/**
 * One admin-defined custom user field (#364), rendered by type. Used on
 * Signup, /settings, ProfileCompletionGate, and the Admin → Edit User card.
 * Optional fields get an "(optional)" hint (matches Signup's convention);
 * required ones carry aria-required.
 */
export default function CustomFieldInput({ field, value, onChange, idPrefix = 'cf', disabled = false }) {
  const id = `${idPrefix}-${field.id}`;
  const common = {
    id,
    value: value ?? '',
    disabled,
    'aria-required': field.required || undefined,
    onChange: (e) => onChange(e.target.value),
  };

  let control;
  if (field.type === 'textarea') {
    control = <Textarea rows={3} {...common} />;
  } else if (field.type === 'dropdown') {
    const options = field.options || [];
    control = (
      <select {...common} className={SELECT_CLASS}>
        <option value="">Select…</option>
        {/* Keep a value that's no longer an option visible rather than silently blanking it. */}
        {value && !options.includes(value) && <option value={value}>{value} (no longer an option)</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else if (field.type === 'link') {
    control = <Input type="url" inputMode="url" placeholder="https://" {...common} />;
  } else if (field.type === 'phone') {
    control = <Input type="tel" autoComplete="tel" {...common} />;
  } else {
    control = <Input type="text" {...common} />;
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {field.label}
        {!field.required && <span className="text-muted-foreground text-xs">(optional)</span>}
      </Label>
      {control}
    </div>
  );
}
