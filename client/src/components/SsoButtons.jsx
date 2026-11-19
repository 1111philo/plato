import { providerName, ssoStartUrl } from '../lib/sso.js';
import SsoButton from './SsoButton.jsx';

// One button per single sign-on provider, then an "or" divider before the
// email and password form below it. Renders nothing when SSO is off
// (docs/SSO.md). Each button is a full-page navigation to the provider.
// `verb`: Login shows the provider's own label ("Sign in with UIC"); Signup
// passes "Continue" ("Continue with UIC"). A provider's `style` (icon and
// colors) applies to both.
export default function SsoButtons({ providers, invite, next, verb, divider = true }) {
  if (!providers?.length) return null;
  return (
    <>
      <div className="space-y-2">
        {providers.map((p) => (
          <SsoButton
            key={p.id}
            label={verb ? `${verb} with ${providerName(p.label)}` : p.label}
            style={p.style}
            onClick={() => window.location.assign(ssoStartUrl(p.id, { invite, next }))}
          />
        ))}
      </div>
      {divider && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
          <span>or</span>
          <span className="h-px flex-1 bg-border" aria-hidden="true" />
        </div>
      )}
    </>
  );
}
