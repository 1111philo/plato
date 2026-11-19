import { normalizeSsoStyle } from '../lib/sso.js';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// One single sign-on button: the site's standard full-width button, with an
// optional icon and color pair an admin set for the provider (docs/SSO.md,
// "Button style"). Login, Signup, and the admin panel's preview all render
// this, so they can't drift apart.
//
// Only the icon and the two colors change: size, radius, font, gap, and the
// focus ring are the Button's own. With colors it's the filled (`default`)
// variant, whose border is transparent, so the focus border and ring show
// exactly as on the site's primary buttons; without, the outline variant as
// before. Colors are validated hex values set through the `style` prop,
// never as CSS text. The icon is decorative: the label is the name.
export default function SsoButton({ label, style, className, ...props }) {
  const look = normalizeSsoStyle(style);
  const colors = look?.background ? { backgroundColor: look.background, color: look.color } : undefined;
  return (
    <Button variant={colors ? 'default' : 'outline'} className={cn('w-full', className)} style={colors} {...props}>
      {look?.icon && <img src={look.icon} alt="" aria-hidden="true" data-sso-icon className="size-5 shrink-0 object-contain" />}
      {label}
    </Button>
  );
}
