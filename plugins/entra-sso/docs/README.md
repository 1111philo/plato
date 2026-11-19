# Microsoft Entra SSO

Adds "Sign in with Microsoft" (the label is a plugin setting, e.g. "Sign in
with UIC") for one Entra tenant, alongside plato's own sign-in.

- **Setup, account rules, and security:** [`docs/SSO.md`](../../../docs/SSO.md).
- **Settings in Admin → Plugins:** how the sign-in button looks, and nothing
  else. The tenant, client id, secret, and owned email domains are deployment
  config (`SsoEntra*` template parameters).

  | Setting | Value | Empty means |
  |---|---|---|
  | `buttonLabel` | Up to 40 characters | "Sign in with Microsoft" |
  | `buttonBackground`, `buttonTextColor` | Hex colors like `#001E62`, set together, with a contrast ratio of at least **4.5:1** (WCAG AA) | The site's standard button |
  | `buttonIcon` | A PNG, JPEG, or WebP image. The panel resizes an upload to fit 64 × 64 and stores it as a data URL of at most 20 KB (20,480 characters). No SVG, no image address | No icon |

  The button keeps the site's size, shape, font, spacing, and focus ring; only
  the icon (20 px, left of the label, decorative) and the two colors change.
  They apply to "Sign in with …" on the login page and "Continue with …" on
  signup. Settings → Sign-in methods keeps the site's standard buttons. The
  server checks every value again and ignores what fails: a pair under 4.5:1
  or one color alone drops both colors, and an icon of another type or size
  is dropped, so the button falls back to the default
  ([`docs/SSO.md`](../../../docs/SSO.md#button-style)).
- **Status:** `GET /v1/plugins/entra-sso/admin/status` (admins) reports
  whether the deployment configured it, the masked ids, the owned domains,
  and the redirect URI to register.
- **Panel:** the plugin's card in Admin → Plugins
  (`client/EntraSettingsPanel.jsx`) shows that status read-only, with a copy
  button for the redirect URI, and has the button's label, icon (with
  **Remove icon**), and colors (with **Reset colors** and the live contrast
  ratio), above a preview that is the login page's own button.
- It ships **off**. Turn it on after the deployment is configured; turn it
  off to remove the button at once.
