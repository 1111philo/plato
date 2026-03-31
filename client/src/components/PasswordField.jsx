import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function PasswordField({ id, name, value, onChange, onKeyDown, placeholder, autoComplete, inputRef, required, disabled }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete || 'off'}
        ref={inputRef}
        required={required}
        disabled={disabled}
        className="pr-16"
      />
      <Button
        type="button"
        variant="ghost"
        size="xs"
        className="absolute right-1 top-1/2 -translate-y-1/2"
        aria-label={visible ? 'Hide password' : 'Show password'}
        onClick={() => setVisible(!visible)}
      >
        {visible ? 'Hide' : 'Show'}
      </Button>
    </div>
  );
}
