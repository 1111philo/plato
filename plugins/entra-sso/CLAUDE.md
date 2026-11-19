# plugins/entra-sso/ — Claude / agent instructions

Supplies the Microsoft Entra ID sign-in provider (`auth.provider`). Read `docs/SSO.md` first: core owns the flow, accounts, and sessions; this plugin only configures the issuer and maps claims (`server/provider.js`).

## Local invariants
- **Trust settings come from the environment** (`SSO_ENTRA_*`, set at deploy time), never from plugin settings and never from the repo. Don't add a tenant, client id, or secret field to `settingsSchema`.
- **Single tenant only.** `configure` returns `null` unless the tenant id is a GUID; `common` / `organizations` would accept any Microsoft account.
- **`mapClaims` decides which emails are vouched for**: only addresses whose domain is in `SSO_ENTRA_DOMAINS`, and never the `email` claim when `xms_edov` is false. Loosening this lets one directory account claim another person's plato account.
- The admin status route never returns the secret, and masks the ids.
- **The admin panel (`client/EntraSettingsPanel.jsx`, the `adminSettingsPanel` slot) only displays trust settings.** What it edits is the button's look, saved through `onSave`: `buttonLabel`, `buttonBackground` + `buttonTextColor`, and `buttonIcon`. Don't add an input for anything the status route reports.
- **Button style is cosmetic and never trusted.** `configure` passes the three style settings through as stored (`cfg.style`); core validates them for every provider (`server/src/lib/sso-button-style.js`, mirrored in `client/src/lib/sso.js`) and drops what fails, so the button falls back to the site's default:
  - Colors: both `#rrggbb`, with a contrast ratio of at least 4.5:1 (WCAG AA). One alone, or a failing pair, drops both. The panel shows the live ratio and won't save a failing pair.
  - Icon: a `data:image/(png|jpeg|webp);base64,…` URL of at most 20,480 characters whose first bytes are that format. **No SVG** (script) and **no remote URL** (tracking, mixed content). The panel redraws an upload to fit 64 × 64 (`client/icon.js`); the settings route refuses a longer value (`maxLength` in `plugin.json`), because every plugin's settings share one stored record.
  - Colors reach the page only through the `style` prop, never as CSS text. The icon is decorative (`alt=""`, `aria-hidden`); the label stays the button's name.
  - The preview renders `client/src/components/SsoButton.jsx`, the same component Login and Signup use. Keep it that way so they can't drift. Settings' "Connect …" stays a standard outline button.
- Never issue sessions, create users, or link accounts here.

## Tests
`server/tests/routes/sso.test.js` (the whole flow with this provider) and `server/tests/lib/entra-provider.test.js`. The panel: `e2e/tests/sso-admin.spec.js` (stubbed status; keyboard and axe). Button style: `server/tests/lib/sso-button-style.test.js`, `client/tests/sso.test.js`, and the styled login button in `e2e/tests/sso.spec.js`.
