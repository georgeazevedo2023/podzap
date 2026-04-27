/**
 * Visual proof for Fase 2 — /approval list + detail at mobile and desktop.
 */
import { test } from './fixtures';

test.describe('approval visual proof', () => {
  test('list mobile @390x844', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.goto('/approval?status=approved');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });

  test('detail mobile @390x844', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.goto('/approval?status=approved');
    await authedPage.locator('a[href^="/approval/"]').first().click();
    await authedPage.waitForURL(/\/approval\/[^/]+$/);
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });

  test('detail desktop @1280x800', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 1280, height: 800 });
    await authedPage.goto('/approval?status=approved');
    await authedPage.locator('a[href^="/approval/"]').first().click();
    await authedPage.waitForURL(/\/approval\/[^/]+$/);
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });
});
