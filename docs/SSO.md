# Single sign-on

People can sign in with an institution's account (first: Microsoft Entra ID)
**or** with plato's own email and password. Both stay available. SSO is off
unless a deployment configures it.

## Who owns what

- **Core** owns everything that decides who you are: the routes
  (`server/src/routes/sso.js`), the OpenID Connect flow
  (`server/src/lib/oidc.js`), which account an identity lands in
  (`server/src/lib/external-identity.js`), and the session. Routes live under
  `/v1/auth/sso/`, so the CloudFront WAF rate rule and the origin check cover
  them.
- **A plugin supplies a provider** (`auth.provider` capability,
  `server/src/lib/sso-providers.js`): where the issuer is and what its ID
  token means. A plugin never sees a session or a user record.
  `plugins/entra-sso` is the first; a provider for another campus or for
  Google is another small plugin.

## Which account you land in

Decided 2026-11-17. In order:

1. **Connecting from Settings** (already signed in): asks for the current
   password first (adding a way to sign in is a credential change). Nothing is
   linked when the provider redirects back; the link is made at the exchange,
   and only for the signed-in person who started it. The account gets an email.
2. **The identity is already linked** → that account. A stored link always
   wins, even if emails have changed on either side since.
3. **An email the provider vouches for matches an account** → it's linked and
   signed in (everyone, staff included), and the account gets an email saying
   so. **If nobody ever proved that account's email, its password is removed
   and every session ends.** plato accepts unproven emails (a learner can
   change theirs; a shareable invite takes any), so someone could park an
   account on another person's address and wait for their first sign-in. An
   email counts as proven (`emailVerifiedAt`) when an emailed invite or an
   emailed reset link was used, or the account was made by SSO; changing the
   email clears it. Accounts from before this existed count as unproven, so
   their first SSO sign-in removes the password once (the email says so, and
   Settings can set a new one).
4. **They came from an invite link** → the account is made from the invite.
   An email invite keeps the *invite's* email (holding the link is the proof,
   as with password signup) and must not be expired. A shareable link needs an
   email the provider vouches for, uses it, and counts against its usage limit.
5. **A vouched-for email has an invite, pending or expired** → the account is
   made from it, with the invite's name, group, and answers. The identity
   proves the address, so the emailed link isn't needed.
6. **Otherwise nobody is created** (invite only). The app shows "You don't
   have an account yet", with a wait-list join that carries the verified name
   and email (a signed 15-minute ticket, `ssoTicket` on `POST /v1/waitlist`).
   If a vouched-for email is already on the wait list, the entry is marked
   "Email verified" (`profile.ssoVerified`), its name is replaced with the
   provider's (anyone can join the public list under someone else's address;
   the group and answers stay as submitted), and the person keeps waiting.

Other rules:
- One identity belongs to one account, and an account has one identity
  (`ssoKey` = `<provider>:<tenant>:<subject>` on the user). The database
  enforces it: on DynamoDB the owner is a guard item (sync-data partition
  `_sso`) written in the same transaction as the user and read with strong
  consistency; on SQLite a unique index. Connecting an identity that's on
  another account is refused; accounts can't be merged.
  Deleting an account releases its identity (the guard item goes with it),
  and a guard whose owner is gone is treated as stale and replaced.
- **Which emails are vouched for** is the provider's call. Entra: the `email`
  claim and the sign-in name, only when the domain is one the tenant owns
  (`SSO_ENTRA_DOMAINS`), and never when Entra says the email's domain owner
  isn't verified. A guest (B2B) account matches nothing, whatever its address.
  List only domains that are verified in the tenant.
- An account made by SSO has **no password**. Password sign-in answers
  "Invalid credentials" (in the same time as a wrong password). To add one: Settings →
  Sign-in methods → **Email me a link to set one** (the password-reset email;
  `/reset-password` opens while signed in, and a reset signs every session
  out), or "Forgot password" from the login page. Disconnecting SSO from your own account
  needs your current password; an admin can unlink anyone
  (`DELETE /v1/admin/users/:userId/sso`), which also ends that person's
  sessions. Unlinking isn't a block: if the email still matches, their next
  SSO sign-in connects it again. **A password reset drops the link** along
  with every session, so an identity connected by whoever had the account
  doesn't outlive the reset; the owner connects it again by signing in with it.
- An invite for a vouched-for email works through SSO even after its link
  expired. To stop someone joining, revoke the invite.
- Roles never come from the provider. New accounts are learners.
- Sign-out ends the plato session only. When someone's institutional account
  is disabled, SSO stops working for them and their plato session runs out by
  itself (up to 30 days).

## What people see

The app side is `client/src/lib/sso.js` (start URL, messages, the one-time
exchange), `components/SsoButtons.jsx`, and `pages/SsoComplete.jsx`. With SSO
off, every page looks exactly as it did before.

- **Sign in** (`/login`): one button per provider with its label ("Sign in
  with UIC") above the email and password form, then "or". A sign-in that
  fails comes back with a message (`?sso=<reason>`, removed from the address
  bar once shown): cancelled, took too long, couldn't sign you in, or not
  available right now.
- **Coming back** (`/sso/complete`): "Signing you in…", then the classroom. A
  new account is told its username once, as after signup. The one-time code
  is taken out of the address bar at once and posted exactly once.
- **No account** (rule 6): "You don't have an account yet". If the wait list
  is open, "Join the wait list" opens the usual form with the name and email
  filled in and the email read-only; the ticket travels in router state
  (memory), never the URL or localStorage. If it's closed: "Ask your program
  team for an invite." Someone already waiting sees "You're on the wait list.
  We'll email you when you're invited."
- **Something in the way**: a plain sentence per case (the identity is on
  another account, the invite can't be used or is full, an account already
  exists for that email), or "That sign-in link has expired" for a used or
  expired code. Always a way back to sign in.
- **Create account** (`/signup?token=…`): "Continue with UIC" above the form.
  It makes the account from that invite with no password; the invite's email
  doesn't have to match the institution's.
- **Settings → Sign-in methods**: "Connected as <email>" with **Disconnect**
  (asks first; refused with "Set a password first, so you can still sign in."
  when there's no password), or **Connect UIC**. Connecting goes to the
  provider and comes back to Settings with "UIC is now connected."; cancelling
  there comes back to Settings too. An account with no password sees
  "Not set — use Forgot password to add one" in place of the change-password
  form (which asks for the current one). The provider rows only appear when
  SSO is on or the account is connected.
- **Privacy** (`/privacy`): says what plato receives from the institution and
  what it keeps.

Where a sentence names the provider ("UIC is now connected."), the name is
the button label without its "Sign in with" (`providerName` in `sso.js`); a
label of another shape is used whole.

### Button style

An admin can give a provider's button an **icon** and a **background and text
color** (Admin → Plugins → the provider). It stays the site's button: same
height, radius, font, spacing, full width, and focus ring. Only the icon
(20 px square, left of the label, decorative: `alt=""`, `aria-hidden`) and
the two colors change. `components/SsoButton.jsx` is that one button, used by
Login ("Sign in with UIC"), Signup ("Continue with UIC"), and the admin
panel's preview. Settings → Sign-in methods keeps the site's standard
buttons.

`GET /v1/auth/sso/providers` carries it as an optional
`style: { background, color, icon }` per provider. A provider returns its
stored settings as `cfg.style`; core validates them
(`server/src/lib/sso-button-style.js`) and serves only what passes, so a bad
stored value falls back to the default button:

- **Colors:** both `#rrggbb`, and their contrast ratio at least **4.5:1**
  (WCAG AA). One color alone, or a pair below that, drops both.
- **Icon:** a `data:image/(png|jpeg|webp);base64,…` URL of at most 20 KB
  (20,480 characters) whose first bytes are that format. No SVG (it can carry
  script) and no remote address (tracking, mixed content). The admin panel
  redraws an upload to fit 64 × 64 first, and the settings route refuses a
  longer value, since all plugin settings share one stored record.

The app checks again before rendering (`normalizeSsoStyle` in `sso.js`) and
sets the colors through the `style` prop, never as CSS text.

## Signup from an invite

An invite link opens the signup page. With SSO on it offers "Continue with
<provider>" above the password form. **When the invite was sent to an address
a provider vouches for** (`GET /v1/auth/invite/:token` returns `sso: [ids]`,
from the provider's owned domains), the page leads with that button alone
("No username or password needed.") and the password form is behind **Set a
password instead**. Someone invited at a campus address shouldn't be asked to
invent a username and password they don't need. They can also skip the link
entirely and use the sign-in button on the login page.

## The flow

```
app      GET  /v1/auth/sso/<provider>/start?next=/path[&invite=<token>]
           → 302 to the provider, + HttpOnly cookie plato_sso_tx (signed, 10 min:
             state, nonce, PKCE verifier, next, invite)
provider   (sign-in, MFA: entirely there)
           → 302 /v1/auth/sso/<provider>/callback?code=…&state=…
server     checks the cookie and state, trades the code (with the PKCE
           verifier) for an ID token, verifies it, decides the account
           → 302 <app>/sso/complete#code=<one-time code>
app      POST /v1/auth/sso/exchange { code }   (with the cookie)
           → { outcome: 'signed_in', accessToken, refreshToken, user, next }
             | { outcome: 'no_account', onWaitlist, waitlistOpen, email, …, ticket }
             | { outcome: 'linked' } | { outcome: 'error', code }
```

- **No token ever travels in a URL.** The one-time code lives 60 seconds, is
  deleted on first use, and only works with the same browser's transaction
  cookie. It isn't a refresh token and can't be used as one.
- **ID token checks:** signature against the provider's published keys (RS256
  only; keys refetch on rotation), issuer, audience, expiry, nonce, and for
  Entra the tenant id. The discovery document's issuer must equal the
  configured one, and endpoints must be https.
- **Nothing from the provider is stored** except the stable subject id and
  the email it showed. No provider tokens are kept.
- `next` is a path on this site only: control characters (browsers strip tabs
  and newlines from URLs), backslashes, and anything the URL parser resolves
  to another origin become `/`. The app checks again before navigating.
- The transaction cookie is `__Secure-plato_sso_tx` over https (a sibling
  host can't plant it), and every SSO response is `Cache-Control: no-store`.
- Failures redirect to `/login?sso=<reason>` (`cancelled`, `expired`,
  `refused`, `failed`, `unavailable`). Logs carry a reason code only, never a
  token or a claim (`sso_start_failed`, `sso_callback_failed`).

## Configuring Microsoft Entra

**Trust settings are deployment config, not admin settings.** An admin account
must not be able to point sign-in at another tenant, so the tenant, client id,
secret, and owned domains are template parameters (→ environment variables),
supplied at deploy time from a private place. This repo holds only their
names.

| Template parameter | Environment variable | Value |
|---|---|---|
| `SsoEntraTenantId` | `SSO_ENTRA_TENANT_ID` | Directory (tenant) ID. Must be a GUID: `common` / `organizations` are refused |
| `SsoEntraClientId` | `SSO_ENTRA_CLIENT_ID` | Application (client) ID |
| `SsoEntraClientSecret` | `SSO_ENTRA_CLIENT_SECRET` | Client secret **value** (`NoEcho`) |
| `SsoEntraDomains` | `SSO_ENTRA_DOMAINS` | Email domains the tenant owns, comma-separated (e.g. `uic.edu`) |

All four empty (the default), or a tenant id that isn't a GUID (a deploy pipeline can pass `off`), means SSO is off: no button, and the routes
answer "unavailable". Then turn the **Microsoft Entra SSO** plugin on in
Admin → Plugins (it ships off). Turning it off again removes the button at
once; password sign-in is never affected.

App registration (per environment; use a separate registration for a test
environment so a leaked test secret never touches production):
1. Entra ID → App registrations → New registration. Single tenant. Redirect
   URI (Web): `https://<your-host>/v1/auth/sso/entra/callback`.
2. Certificates & secrets → New client secret. Note its expiry; rotate before
   it (redeploy with the new value).
3. Token configuration → optional ID-token claims: `email`, `given_name`,
   `family_name`, `preferred_username`, and `xms_edov` if offered.
4. API permissions: the delegated `openid`, `profile`, `email` only.

The first deploy that includes SSO adds the `ssoKey-index` to the users table
(online; no downtime). Local development (`node dev-sqlite.js` serves the same
routes): set the four `SSO_ENTRA_*` variables in `server/.env` with a
registration whose redirect URI is
`http://localhost:3000/v1/auth/sso/entra/callback`, and `APP_URL` to the
address your browser uses (the redirect URI and the return to `/sso/complete`
are built from it).

## For admins

Everything here appears only once single sign-on is in play (a provider is
on, or an account is linked). Until then Admin → Users looks as it always did.

- **Users → Sign-in column.** For each signed-up user: "Password", the
  provider's name, or both. The name is the sign-in button's label without
  "Sign in with" ("Sign in with UIC" → "UIC"); a provider that's switched off
  shows as "SSO". The **Download CSV** file gets the same column.
- **Users → Filters → Sign-in.** Password / SSO, signed-up users only. Someone
  with both matches both.
- **Edit User → Sign-in.** Whether a password is set, and the linked identity:
  its email and the date it was connected. **Unlink** (`users.write`) asks
  first, then calls `DELETE /v1/admin/users/:userId/sso`. The person signs in
  with their password afterwards; if they have none, they use "Forgot
  password". The result message says which.
- **Wait list → Verified.** An entry whose address the provider vouched for
  (rule 6) carries a "Verified" mark, and Filters → Status offers "Wait list:
  verified".
- **Plugins → Microsoft Entra SSO.** Shows whether the deployment configured
  it, with the masked tenant and client ids, the owned domains, and the
  redirect URI to register (with a copy button). These are read-only: they
  come from the deployment. The settings are the sign-in button's look: its
  **label** (up to 40 characters; empty means "Sign in with Microsoft"), an
  **icon** (PNG, JPEG, or WebP; resized to fit 64 × 64), and a **background
  and text color**. The panel shows the pair's contrast ratio and won't save
  one under 4.5:1, with **Remove icon**, **Reset colors**, and a preview that
  is the login page's own button. Rules: [Button style](#button-style).

Code: `client/src/lib/signIn.js`, `client/src/lib/userFilters.js`,
`client/src/pages/admin/AdminUsers.jsx`,
`plugins/entra-sso/client/EntraSettingsPanel.jsx`.

## Security review (2026-11-18)

An independent adversarial review found the protocol core sound and six
issues where an identity meets plato's accounts; all are fixed and have
regression tests in `server/tests/routes/sso.test.js`:
1. Pre-registering someone's address to capture their first sign-in (rule 3's
   `emailVerifiedAt` and takeover).
2. Connecting from Settings with only a stolen session, and the link
   surviving a password reset (current password required; link finished
   behind authentication; reset and admin unlink end it).
3. An open redirect through a tab character in `next`.
4. "One identity, one account" not enforced by DynamoDB (guard item +
   transaction; verified against real tables).
5. A planted wait-list entry looking verified (name replaced; "Email verified").
6. A shareable-link account under an address the provider didn't vouch for.

Also hardened: the test-only authority override is honored only for
localhost; the callback has its own rate limit; logs carry reason codes only.

**Rollback:** code from before SSO meeting an account that has no password
answers a password attempt with a 500, not a sign-in. Turn the plugin off
before rolling back past this feature.

## Tests

`e2e/tests/sso-admin.spec.js` covers the admin screens above against stubbed
responses (keyboard and axe), and `client/tests/signIn.test.js`,
`userFilters.test.js`, and `csv.test.js` cover the labels, the filter, and the
CSV column.


`server/tests/routes/sso.test.js` runs the real routes and rules against a
real SQLite database and a fake identity provider that signs real tokens
(`server/tests/helpers/fake-idp.js`): every rule above, plus forged state, a
missing cookie, another tenant, wrong audience / issuer / key / nonce, an
expired token, and a stolen or replayed one-time code.

`e2e/tests/sso.spec.js` drives the whole thing in a browser, by keyboard,
against the same fake provider run as a server (`e2e/fake-idp-server.js`, with
an authorize endpoint that approves at once as whoever the test chose): no
account → wait list, an invited address, a matching password account, a
cancelled sign-in, connect and disconnect in Settings, and signup from an
invite link. `e2e/tests/a11y.spec.js` runs axe on every `/sso/complete`
screen. `client/tests/sso.test.js` covers the messages and the one-shot
exchange.

Button style: `server/tests/lib/sso-button-style.test.js` (colors, contrast,
icon type and size, SVG and remote addresses refused), the providers payload
in `sso.test.js`, the same rules in `client/tests/sso.test.js`, the styled
login and signup buttons in `e2e/tests/sso.spec.js` (axe, focus ring, same
size as before), and the panel's controls in `sso-admin.spec.js`.
