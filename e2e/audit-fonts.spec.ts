/**
 * Quick Playwright check: which font actually renders for the sidebar
 * logo in prod? Compared against what the prototype expects (Archivo
 * Black). If prod falls back to system-ui, the logo lettering looks
 * different vs the standalone HTML.
 */
import { test } from './fixtures';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('computed font for sidebar logo', async ({ authedPage: page }) => {
  test.setTimeout(60_000);
  await page.goto('/home');
  await page.waitForLoadState('networkidle');

  const podZap = page
    .locator('aside')
    .first()
    .locator('text=/^pod/i')
    .first();

  const info = await podZap.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    const fonts = Array.from(document.fonts).map((f) => ({
      family: f.family,
      weight: f.weight,
      status: f.status,
    }));
    return {
      computedFontFamily: cs.fontFamily,
      computedFontWeight: cs.fontWeight,
      computedFontSize: cs.fontSize,
      fontsInDocument: fonts,
    };
  });

  // eslint-disable-next-line no-console
  console.log('=== FONT REPORT ===');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(info, null, 2));
  // eslint-disable-next-line no-console
  console.log('=== END FONT REPORT ===');
  writeFileSync(
    resolve(process.cwd(), 'e2e/audit-output/font-report.json'),
    JSON.stringify(info, null, 2),
  );
});
