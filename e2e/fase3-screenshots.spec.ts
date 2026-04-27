/**
 * Visual proof for Fase 3 — /home + /podcasts mobile + desktop.
 */
import { test } from './fixtures';

test.describe('fase3 visual proof', () => {
  test('/home mobile @390x844', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.goto('/home');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });

  test('/podcasts mobile @390x844', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await authedPage.goto('/podcasts');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });

  test('/home desktop @1280x800', async ({ authedPage }, testInfo) => {
    await authedPage.setViewportSize({ width: 1280, height: 800 });
    await authedPage.goto('/home');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.screenshot({
      path: testInfo.outputPath('shot.png'),
      fullPage: true,
    });
  });
});
