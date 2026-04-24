/**
 * Smoke tests — the "is the app even responding?" tier.
 *
 * Nothing here requires auth. If any of these fail, everything else will too
 * — treat them as the first line of defense.
 */
import { test, expect } from './fixtures';

test.describe('smoke', () => {
  test('/login renderiza formulário de entrada', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.ok(), 'GET /login should return 2xx').toBeTruthy();

    await expect(page.getByRole('button', { name: /entrar/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/senha/i)).toBeVisible();
  });

  test('landing / responde 200 ou redireciona pra /login', async ({ page }) => {
    // `/` is the landing page that redirects to /login for anon users. Either
    // a direct 200 (landing) or a 30x followed by a 200 on /login is fine —
    // what we are asserting is "server is up, no 500".
    const response = await page.goto('/');
    expect(response?.status(), 'landing should not 5xx').toBeLessThan(500);
  });

  test('rota protegida sem sessão redireciona pro login', async ({ page }) => {
    await page.goto('/home');
    // proxy.ts redirects unauthenticated hits on /home → /login.
    await expect(page).toHaveURL(/\/login(\?|$)/);
  });
});
