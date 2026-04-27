/**
 * Visual proof for the Fase 1 mobile-first shell. Captures screenshots of
 * the four most-used routes at iPhone 13 viewport (390×844) so future
 * regressions in the shell are easy to spot.
 *
 * Saved under `e2e/test-results/<test-name>/screenshot.png`. Run on demand
 * (not in CI) when validating shell changes:
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001 \
 *     npx playwright test e2e/mobile-shell-screenshots.spec.ts
 */
import { test } from './fixtures';

test.describe('mobile shell visual proof @390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ['/home', '/approval', '/podcasts', '/groups']) {
    test(`screenshot ${path}`, async ({ authedPage }, testInfo) => {
      await authedPage.goto(path);
      await authedPage.waitForLoadState('networkidle');
      await authedPage.screenshot({
        path: testInfo.outputPath('screenshot.png'),
        fullPage: true,
      });
    });
  }

  test('screenshot drawer open on /home', async ({ authedPage }, testInfo) => {
    await authedPage.goto('/home');
    await authedPage.getByRole('button', { name: /abrir menu/i }).click();
    await authedPage.waitForTimeout(300);
    await authedPage.screenshot({
      path: testInfo.outputPath('screenshot.png'),
      fullPage: true,
    });
  });
});
