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

`global-setup.js` seeds data through the real API (a course, two lessons, a
group, a custom field) plus a learner via `server/scripts/create-dev-user.js`.
The mock coach adds 3 progress points per learner turn; a message containing
`MOCK_COMPLETE` awards 10 and completes the lesson.

**Adding a page or dialog?** Add it to `a11y.spec.js` in the same PR. axe
catches markup problems, not everything; still walk new UI with the keyboard
and a screen reader (see CLAUDE.md "Accessibility is required").
