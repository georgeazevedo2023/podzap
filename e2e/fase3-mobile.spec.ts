/**
 * Fase 3 smoke — /home + /podcasts mobile-first.
 *
 * Validates at iPhone 13 viewport (390×844):
 *   - /home grid is 1-col, .home-stats is 2-up, .home-episodes is 2-up
 *   - /podcasts copy button hits ≥44px tap target
 *   - SendToMenu menu spans the viewport (left/right ~12px) on mobile
 * And on desktop (1280×800):
 *   - /home grid is 2-col, .home-stats and .home-episodes are 4-up
 */
import { test, expect } from './fixtures';

async function gridTrackCount(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<number> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return -1;
    return getComputedStyle(el).gridTemplateColumns.split(/\s+/).filter(Boolean)
      .length;
  }, selector);
}

test.describe('home — mobile @390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('home grid + stats + episodes collapse correctly', async ({
    authedPage,
  }) => {
    await authedPage.goto('/home');
    await authedPage.waitForLoadState('networkidle');

    expect(await gridTrackCount(authedPage, '.home-grid')).toBe(1);
    expect(await gridTrackCount(authedPage, '.home-stats')).toBe(2);
    expect(await gridTrackCount(authedPage, '.home-episodes')).toBe(2);

    const overflow = await authedPage.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('home — desktop @1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('home grid + stats + episodes are 2-col / 4-up', async ({
    authedPage,
  }) => {
    await authedPage.goto('/home');
    await authedPage.waitForLoadState('networkidle');

    expect(await gridTrackCount(authedPage, '.home-grid')).toBe(2);
    expect(await gridTrackCount(authedPage, '.home-stats')).toBe(4);
    expect(await gridTrackCount(authedPage, '.home-episodes')).toBe(4);
  });
});

test.describe('podcasts — mobile @390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('copy button hits ≥44px', async ({ authedPage }) => {
    await authedPage.goto('/podcasts');
    await authedPage.waitForLoadState('networkidle');

    // CopyableCaption renders multiple buttons; pick the first one.
    const copy = authedPage
      .getByRole('button', { name: /copiar/i })
      .first();
    const cnt = await copy.count();
    test.skip(cnt === 0, 'tenant has no episodes with caption');
    const box = await copy.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('SendToMenu menu opens spanning the mobile viewport', async ({
    authedPage,
  }) => {
    await authedPage.goto('/podcasts');
    await authedPage.waitForLoadState('networkidle');

    const sendBtn = authedPage
      .getByRole('button', { name: /enviar/i })
      .first();
    const cnt = await sendBtn.count();
    test.skip(cnt === 0, 'tenant has no episodes with delivery controls');
    await sendBtn.click();

    // Wait for the portaled menu role=menu to appear in the body.
    const menu = authedPage.getByRole('menu');
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    // Mobile menu spans most of the viewport (left=12, right=12 → width
    // ~366 of 390). Desktop variant minWidth: 260 wouldn't apply here.
    expect(box?.width ?? 0).toBeGreaterThan(300);
    // And first menu item is tap-friendly.
    const item = menu.getByRole('menuitem').first();
    const itemBox = await item.boundingBox();
    expect(itemBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
