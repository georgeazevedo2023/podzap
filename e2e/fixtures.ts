/**
 * Shared Playwright fixtures for the podZAP E2E suite.
 *
 * ## Required envs
 *
 *   PLAYWRIGHT_BASE_URL       (optional) override target host.
 *                             Defaults to `http://localhost:3001`.
 *   PLAYWRIGHT_TEST_EMAIL     Account email for the authenticated fixture.
 *                             Must be a real row in `auth.users` AND a member
 *                             of a tenant (superadmin-provisioned in F13).
 *   PLAYWRIGHT_TEST_PASSWORD  Password for the above email.
 *
 * We do NOT bake credentials into the repo — add them to `.env.local` and
 * source it before running (`set -a; . ./.env.local; set +a; npm run test:e2e`
 * on bash; `$env:PLAYWRIGHT_TEST_EMAIL = "..."` on PowerShell) or pass inline.
 *
 * The fixture does a real password login through `/login` → waits for the
 * redirect to `/home`. That exercises the actual server action (`loginAction`
 * in `app/login/actions.ts`) and middleware session wiring, so we catch auth
 * regressions "for free" on every run of an authenticated spec.
 *
 * We keep a single storage-state-less approach (no JSON artifact) because
 * Supabase access tokens are short-lived and we want every spec to go through
 * the real sign-in path — storage-state would mask cookie/middleware changes.
 */

import { test as base, expect, type Page } from '@playwright/test';

export interface AuthEnv {
  email: string;
  password: string;
}

function readAuthEnv(): AuthEnv {
  const email = process.env.PLAYWRIGHT_TEST_EMAIL;
  const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD must be set for ' +
        'authenticated specs. See e2e/fixtures.ts for details.',
    );
  }
  return { email, password };
}

/**
 * Submit the /login form and wait for the post-login /home redirect.
 *
 * Isolated so individual specs can drive login themselves (e.g. to assert
 * on the error banner path) without the fixture beforeEach stealing the
 * navigation.
 */
export async function loginViaUi(
  page: Page,
  { email, password }: AuthEnv,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/senha/i).fill(password);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL(/\/home(\?|$)/, { timeout: 15_000 });
}

/**
 * `test` extended with an `authedPage` fixture that is already logged in.
 *
 * Usage:
 *   test('shows hero', async ({ authedPage }) => { ... })
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const creds = readAuthEnv();
    await loginViaUi(page, creds);
    await use(page);
  },
});

export { expect };
