/**
 * Smoke test for the mobile-first shell (Fase 1 of the mobile migration).
 *
 * Validates that on a phone-sized viewport (iPhone X — 375×812):
 *   - mobile header (hamburger + brand) is visible
 *   - bottom nav is fixed at the bottom with all 4 items
 *   - tapping the hamburger opens the drawer with the full sidebar
 *   - bottom nav "Mais" toggles the same drawer
 *
 * And on desktop (1280×800):
 *   - hamburger and bottom nav are hidden
 *   - sidebar is visible (the legacy desktop chrome)
 *
 * Runs against the same target as the rest of the suite (PLAYWRIGHT_BASE_URL,
 * defaults to localhost:3001).
 */
import { expect, test } from './fixtures';

test.describe('mobile shell @375x812', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('renders mobile header + bottom nav, hides desktop sidebar', async ({
    authedPage,
  }) => {
    await authedPage.goto('/home');

    const hamburger = authedPage.getByRole('button', {
      name: /abrir menu/i,
    });
    await expect(hamburger).toBeVisible();

    const bottomNav = authedPage.getByRole('navigation', {
      name: /navegação principal/i,
    });
    await expect(bottomNav).toBeVisible();
    for (const label of ['Home', 'Aprovar', 'Podcasts', 'Mais']) {
      await expect(bottomNav.getByText(label, { exact: true })).toBeVisible();
    }

    // The persistent desktop sidebar is hidden via CSS at <md. We assert via
    // computed style on the wrapper div (display:none).
    const desktopWrapperDisplay = await authedPage.evaluate(() => {
      const el = document.querySelector('[data-desktop-only]');
      return el ? getComputedStyle(el).display : null;
    });
    expect(desktopWrapperDisplay).toBe('none');
  });

  test('opens drawer on hamburger tap', async ({ authedPage }) => {
    await authedPage.goto('/home');

    await authedPage.getByRole('button', { name: /abrir menu/i }).click();

    const drawer = authedPage.getByRole('dialog', {
      name: /menu de navegação/i,
    });
    await expect(drawer).toBeVisible();
    // Inside the drawer we should see at least one nav item from the sidebar.
    await expect(drawer.getByText(/aprovação/i).first()).toBeVisible();
  });

  test('bottom nav "Mais" opens the same drawer', async ({ authedPage }) => {
    await authedPage.goto('/home');

    await authedPage
      .getByRole('navigation', { name: /navegação principal/i })
      .getByRole('button', { name: /^mais$/i })
      .click();

    await expect(
      authedPage.getByRole('dialog', { name: /menu de navegação/i }),
    ).toBeVisible();
  });
});

test.describe('desktop shell @1280x800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('shows persistent sidebar, hides mobile chrome', async ({
    authedPage,
  }) => {
    await authedPage.goto('/home');

    // Mobile header / bottom nav are display:none at md+.
    await expect(
      authedPage.getByRole('button', { name: /abrir menu/i }),
    ).toBeHidden();
    await expect(
      authedPage.getByRole('navigation', { name: /navegação principal/i }),
    ).toBeHidden();

    // Desktop sidebar wrapper computes to display:flex (data-as="flex").
    const desktopWrapperDisplay = await authedPage.evaluate(() => {
      const el = document.querySelector('[data-desktop-only]');
      return el ? getComputedStyle(el).display : null;
    });
    expect(desktopWrapperDisplay).toBe('flex');
  });
});
