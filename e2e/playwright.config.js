// End-to-end + accessibility suite. Starts a fresh dev-sqlite server with the
// deterministic mock AI provider (server/src/lib/ai-mock.js) on its own port
// and throwaway db, serving the built client (run `npm run build` in client/
// first; CI does). See e2e/README.md.
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT || 3490);
export const BASE_URL = `http://localhost:${PORT}`;
export const DB_PATH = process.env.E2E_DB || '/tmp/plato-e2e.db';
// Single sign-on (docs/SSO.md): a local stand-in identity provider
// (fake-idp-server.js) and the settings that point the app at it. The values
// are made up; nothing here reaches a real tenant.
export const IDP_URL = `http://127.0.0.1:${Number(process.env.E2E_IDP_PORT || PORT + 1)}`;
export const SSO_DOMAIN = 'sso.example.edu';
const SSO_ENV = {
  SSO_ENTRA_TENANT_ID: '11111111-2222-4333-8444-555555555555',
  SSO_ENTRA_CLIENT_ID: 'e2e-client',
  SSO_ENTRA_CLIENT_SECRET: 'e2e-client-secret',
};

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './global-setup.js',
  use: {
    baseURL: BASE_URL,
    // Tailwind's animate-in classes respect reduced motion; without it axe can
    // sample a card mid-fade and report false color-contrast failures.
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /a11y\.spec\.js/ },
  ],
  webServer: [{
    command: 'node fake-idp-server.js',
    url: `${IDP_URL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...SSO_ENV, FAKE_IDP_PORT: new URL(IDP_URL).port },
  }, {
    command: `rm -f ${DB_PATH} ${DB_PATH}-wal ${DB_PATH}-shm && node dev-sqlite.js`,
    cwd: '../server',
    url: `${BASE_URL}/v1/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      SQLITE_PATH: DB_PATH,
      AI_PROVIDER: 'mock',
      SKIP_EMAIL: 'true',
      // Stands in for SES's bounce/complaint list (lib/email-suppression.js).
      SUPPRESSED_EMAILS: 'bounced@example.com:BOUNCE,spam@example.com:COMPLAINT',
      ADMIN_EMAIL: 'admin@plato.dev',
      ADMIN_PASSWORD: 'admin123',
      JWT_SECRET: 'e2e-secret',
      // The sign-in redirect URI and the /sso/complete redirect are built from
      // this, so it must be the address the browser uses.
      APP_URL: BASE_URL,
      ...SSO_ENV,
      SSO_ENTRA_DOMAINS: SSO_DOMAIN,
      SSO_ENTRA_AUTHORITY: IDP_URL,
    },
  }],
});
