# Microsoft Entra SSO

Adds "Sign in with Microsoft" (the label is a plugin setting, e.g. "Sign in
with UIC") for one Entra tenant, alongside plato's own sign-in.

- **Setup, account rules, and security:** [`docs/SSO.md`](../../../docs/SSO.md).
- **Settings in Admin → Plugins:** the button label only. The tenant, client
  id, secret, and owned email domains are deployment config
  (`SsoEntra*` template parameters).
- **Status:** `GET /v1/plugins/entra-sso/admin/status` (admins) reports
  whether the deployment configured it, the masked ids, the owned domains,
  and the redirect URI to register.
- **Panel:** the plugin's card in Admin → Plugins
  (`client/EntraSettingsPanel.jsx`) shows that status read-only, with a copy
  button for the redirect URI, and has the button label field with a preview.
- It ships **off**. Turn it on after the deployment is configured; turn it
  off to remove the button at once.
