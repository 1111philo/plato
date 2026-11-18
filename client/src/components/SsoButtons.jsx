import { providerName, ssoStartUrl } from '../lib/sso.js';
import { Button } from '@/components/ui/button';

// One button per single sign-on provider, then an "or" divider before the
// email and password form below it. Renders nothing when SSO is off
// (docs/SSO.md). Each button is a full-page navigation to the provider.
// `verb`: Login shows the provider's own label ("Sign in with UIC"); Signup
// passes "Continue" ("Continue with UIC").
export default function SsoButtons({ providers, invite, next, verb }) {
  if (!providers?.length) return null;
  return (
    <>
      <div className="space-y-2">
        {providers.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            className="w-full"
            onClick={() => window.location.assign(ssoStartUrl(p.id, { invite, next }))}
          >
            {verb ? `${verb} with ${providerName(p.label)}` : p.label}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
        <span>or</span>
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </div>
    </>
  );
}
