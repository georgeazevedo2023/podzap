/**
 * Auth path coverage:
 *   - Valid credentials → /home.
 *   - Invalid credentials → stays on /login with the generic error banner
 *     (we explicitly do NOT assert "user not found" vs "wrong password" —
 *     the server action collapses both into the same message on purpose,
 *     see app/login/actions.ts).
 */
import { test, expect, loginViaUi } from './fixtures';

test.describe('auth', () => {
  test('login válido redireciona pra /home', async ({ page }) => {
    const email = process.env.PLAYWRIGHT_TEST_EMAIL;
    const password = process.env.PLAYWRIGHT_TEST_PASSWORD;
    test.skip(
      !email || !password,
      'PLAYWRIGHT_TEST_EMAIL / PLAYWRIGHT_TEST_PASSWORD not set',
    );

    await loginViaUi(page, { email: email!, password: password! });
    await expect(page).toHaveURL(/\/home(\?|$)/);
  });

  test('credenciais inválidas mostram banner de erro', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('naoexiste@example.invalid');
    await page.getByLabel(/senha/i).fill('senha-errada-123');
    await page.getByRole('button', { name: /entrar/i }).click();

    // Server action redirects to /login?error=... — wait for the URL to flip.
    await page.waitForURL(/\/login\?.*error=/, { timeout: 10_000 });

    // Banner is role="alert" and starts with "✗ erro:".
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/erro/i);
  });

  test('email vazio não submete (required HTML5)', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/senha/i).fill('whatever');
    await page.getByRole('button', { name: /entrar/i }).click();
    // Browser's built-in validation keeps us on /login without a query string.
    await expect(page).toHaveURL(/\/login$/);
  });
});
