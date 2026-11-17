# plugins/entra-sso/ — Claude / agent instructions

Supplies the Microsoft Entra ID sign-in provider (`auth.provider`). Read `docs/SSO.md` first: core owns the flow, accounts, and sessions; this plugin only configures the issuer and maps claims (`server/provider.js`).

## Local invariants
- **Trust settings come from the environment** (`SSO_ENTRA_*`, set at deploy time), never from plugin settings and never from the repo. Don't add a tenant, client id, or secret field to `settingsSchema`.
- **Single tenant only.** `configure` returns `null` unless the tenant id is a GUID; `common` / `organizations` would accept any Microsoft account.
- **`mapClaims` decides which emails are vouched for**: only addresses whose domain is in `SSO_ENTRA_DOMAINS`, and never the `email` claim when `xms_edov` is false. Loosening this lets one directory account claim another person's plato account.
- The admin status route never returns the secret, and masks the ids.
- Never issue sessions, create users, or link accounts here.

## Tests
`server/tests/routes/sso.test.js` (the whole flow with this provider) and `server/tests/lib/entra-provider.test.js`.
