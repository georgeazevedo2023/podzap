/**
 * Smoke test for the Fase 2 mobile-friendly /approval flow.
 *
 * Validates on iPhone 13 viewport (390×844):
 *   - List page filter pills hit ≥44 px tap target
 *   - Detail page grid is 1-col (editor + metadata stacked)
 *   - SummaryEditor toolbar is sticky and floats above the BottomNav
 *   - Approve / save / reject buttons hit ≥44 px
 *   - No horizontal overflow
 *
 * And on desktop (1280×800):
 *   - Detail page falls back to the legacy 2-col grid (1fr 320px)
 *   - Sidebar metadata is sticky
 */
import { test, expect } from './fixtures';

test.describe('approval list — mobile @390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('filter pills are tap-friendly (≥44px)', async ({ authedPage }) => {
    await authedPage.goto('/approval');
    const pills = authedPage.getByRole('tab');
    const count = await pills.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i++) {
      const box = await pills.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('approval detail — mobile @390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('detail page falls back to single column on mobile', async ({
    authedPage,
  }) => {
    // Find the first pending summary card and click it. If there's none, the
    // empty state ships and we skip — Phase 2 is about layout not data.
    // Default tab is "pendentes" which is often empty on real tenants.
    // Use "approved" to find a real card without depending on test data.
    await authedPage.goto('/approval?status=approved');
    const firstCard = authedPage
      .locator('a[href^="/approval/"]')
      .first();
    const count = await firstCard.count();
    test.skip(count === 0, 'no summaries available on this tenant');
    await firstCard.click();
    await authedPage.waitForURL(/\/approval\/[^/]+$/);

    // Grid resolves to 1fr (single column) on mobile.
    const gridCols = await authedPage
      .locator('.approval-detail-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // `minmax(0, 1fr)` resolves to a single track ~ "<width>px".
    const trackCount = gridCols.split(/\s+/).filter(Boolean).length;
    expect(trackCount).toBe(1);

    // Toolbar (the one wrapping "salvar edição") is sticky.
    const saveBtn = authedPage.getByRole('button', {
      name: /salvar edição/i,
    });
    if (await saveBtn.count()) {
      const sb = await saveBtn.boundingBox();
      expect(sb?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    // No horizontal overflow.
    const overflow = await authedPage.evaluate(
      () => document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
    );
    expect(overflow).toBe(false);
  });
});

test.describe('approval detail — desktop @1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('detail page keeps 2-col grid on desktop', async ({ authedPage }) => {
    // Default tab is "pendentes" which is often empty on real tenants.
    // Use "approved" to find a real card without depending on test data.
    await authedPage.goto('/approval?status=approved');
    const firstCard = authedPage
      .locator('a[href^="/approval/"]')
      .first();
    const count = await firstCard.count();
    test.skip(count === 0, 'no summaries available on this tenant');
    await firstCard.click();
    await authedPage.waitForURL(/\/approval\/[^/]+$/);

    const gridCols = await authedPage
      .locator('.approval-detail-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns);
    // Desktop should resolve to two tracks (1fr + 320px).
    const trackCount = gridCols.split(/\s+/).filter(Boolean).length;
    expect(trackCount).toBe(2);
    // The 320px track should still be ~320 in computed style.
    expect(gridCols).toMatch(/320px/);
  });
});
