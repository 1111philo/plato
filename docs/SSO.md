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

1. **Connecting from Settings** (already signed in): the identity is linked to
   that account.
2. **The identity is already linked** → that account. A stored link always
   wins, even if emails have changed on either side since.
3. **An email the provider vouches for matches an account** → it's linked and
   signed in (everyone, staff included), and the account gets an email saying
   so.
4. **They came from an invite link** → the account is made from the invite.
   An email invite keeps the *invite's* email (holding the link is the proof,
   as with password signup) and must not be expired. A shareable link uses the
   identity's email and counts against its usage limit.
5. **A vouched-for email has an invite, pending or expired** → the account is
   made from it, with the invite's name, group, and answers. The identity
   proves the address, so the emailed link isn't needed.
6. **Otherwise nobody is created** (invite only). The app shows "You don't
   have an account yet", with a wait-list join that carries the verified name
   and email (a signed 15-minute ticket, `ssoTicket` on `POST /v1/waitlist`).
   If a vouched-for email is already on the wait list, the entry is marked
   verified (`profile.ssoVerified`) and the person keeps waiting.

Other rules:
- One identity belongs to one account, and an account has one identity
  (`ssoKey` = `<provider>:<tenant>:<subject>` on the user, found through the
  sparse `ssoKey-index`). Connecting an identity that's on another account is
  refused; accounts can't be merged.
- **Which emails are vouched for** is the provider's call. Entra: the `email`
  claim and the sign-in name, only when the domain is one the tenant owns
  (`SSO_ENTRA_DOMAINS`), and never when Entra says the email's domain owner
  isn't verified. A guest account's outside address matches nothing.
- An account made by SSO has **no password**. Password sign-in answers
  "Invalid credentials" (in the same time as a wrong password); "Forgot
  password" lets the person add one. Disconnecting SSO from your own account
  needs a password first; an admin can unlink anyone
  (`DELETE /v1/admin/users/:userId/sso`).
- Roles never come from the provider. New accounts are learners.
- Sign-out ends the plato session only. When someone's institutional account
  is disabled, SSO stops working for them and their plato session runs out by
  itself (up to 30 days).

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
- `next` is a local path only; anything else becomes `/`.
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
(online; no downtime). Local development: set the four `SSO_ENTRA_*` variables
in `server/.env` with a registration whose redirect URI is
`http://localhost:3000/v1/auth/sso/entra/callback`.

## Tests

`server/tests/routes/sso.test.js` runs the real routes and rules against a
real SQLite database and a fake identity provider that signs real tokens
(`server/tests/helpers/fake-idp.js`): every rule above, plus forged state, a
missing cookie, another tenant, wrong audience / issuer / key / nonce, an
expired token, and a stolen or replayed one-time code.
