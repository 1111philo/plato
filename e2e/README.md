# End-to-end & accessibility tests

Playwright + [axe](https://github.com/dequelabs/axe-core) against the real app:
a fresh `dev-sqlite` server on port 3490 with a throwaway database and the
**mock AI provider** (`AI_PROVIDER=mock`, `server/src/lib/ai-mock.js`), so chat
flows are deterministic and need no AWS credentials.

```bash
cd client && npm run build      # the server serves client/dist
cd ../e2e && npm install && npx playwright install chromium
npx playwright test             # or: npm run test:headed
```

The bar (`helpers.js` `expectAccessible`): **no serious or critical WCAG 2.1
A/AA violations** on any page or dialog, at desktop (1280×800) and mobile
(Pixel 7) sizes.

- `tests/a11y.spec.js`: axe on every public, learner, and admin page, every
  admin dialog, and the lesson chat both while the coach streams and after.
- `tests/flows.spec.js`: keyboard-only flows. A learner completes a lesson
  (Cmd/Ctrl+Enter to send, Alt+Arrow through messages); the admin skip link;
  long dialogs fit the viewport.

- `tests/sso.spec.js`: single sign-on (docs/SSO.md), by keyboard, against a
  stand-in identity provider. Playwright starts `fake-idp-server.js` next to
  the app (port 3491; it is `server/tests/helpers/fake-idp.js`, which signs
  real tokens and checks PKCE, with an authorize endpoint that approves at
  once). A test says who signs in next with
  `POST /__control/next { claims }`, or `{ cancel: true }`. The app gets
  made-up `SSO_ENTRA_*` settings pointing at it, and `global-setup.js` turns
  the `entra-sso` plugin on with the label "Sign in with UIC", so the login
  page has two "Sign in…" buttons: match the password one exactly
  (`{ name: 'Sign in', exact: true }`).

- `tests/trace-admin.spec.js`: Trace mode's admin controls (#595), by
  keyboard: the Edit User checkbox, the Users filter and column, and the bulk
  On / Off. Each test turns Trace mode back off for everyone.

Ports and the database can be moved when 3490 is taken:
`E2E_PORT=3590 E2E_DB=/tmp/other.db npx playwright test` (the identity
provider uses the next port up, or `E2E_IDP_PORT`).

`global-setup.js` seeds data through the real API (a course, two lessons, a
group, a custom field) plus a learner via `server/scripts/create-dev-user.js`.
The mock coach adds 3 progress points per learner turn; a message containing
`MOCK_COMPLETE` awards 10 and completes the lesson.

**Adding a page or dialog?** Add it to `a11y.spec.js` in the same PR. axe
catches markup problems, not everything; still walk new UI with the keyboard
and a screen reader (see CLAUDE.md "Accessibility is required").
