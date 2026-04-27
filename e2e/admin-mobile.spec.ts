/**
 * Fase 4 (mobile-first /admin) — verifica que as 3 telas admin com tabela
 * (tenants, users, uazapi) renderizam como cards stacked em <md, e que o
 * footer dos modais empilha vertical com CTAs full-width.
 *
 * Roda contra prod por default. Pra rodar contra local:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001 npx playwright test e2e/admin-mobile.spec.ts
 */
import { test, expect } from './fixtures';

test.use({ viewport: { width: 390, height: 844 } });

const ROUTES = [
  { path: '/admin/tenants', addBtn: '+ novo tenant' },
  { path: '/admin/users', addBtn: '+ novo usuário' },
  { path: '/admin/uazapi', addBtn: '+ criar e atribuir' },
] as const;

test.describe('admin mobile @390x844 — list as cards', () => {
  for (const { path } of ROUTES) {
    test(`${path}: tabela escondida, cards visíveis`, async ({
      authedPage,
    }, testInfo) => {
      await authedPage.goto(path);
      await authedPage.waitForLoadState('networkidle');

      // Desktop wrapper exists but should be hidden by data-desktop-only.
      const desktopVisible = await authedPage
        .locator('[data-desktop-only]')
        .first()
        .isVisible()
        .catch(() => false);
      expect(desktopVisible, '[data-desktop-only] should be hidden in <md').toBe(
        false,
      );

      // Mobile wrapper should be visible.
      const mobileVisible = await authedPage
        .locator('[data-mobile-only]')
        .first()
        .isVisible()
        .catch(() => false);
      expect(mobileVisible, '[data-mobile-only] must show in <md').toBe(true);

      await authedPage.screenshot({
        path: testInfo.outputPath('list.png'),
        fullPage: true,
      });
    });
  }
});

test.describe('admin mobile @390x844 — modais empilham CTAs', () => {
  test('/admin/tenants: footer do modal "novo tenant" é column full-width', async ({
    authedPage,
  }, testInfo) => {
    await authedPage.goto('/admin/tenants');
    await authedPage.waitForLoadState('networkidle');

    await authedPage.getByRole('button', { name: /novo tenant/i }).click();

    // Footer existe e aplica column em <md.
    const footer = authedPage.locator('.admin-modal-footer').first();
    await expect(footer).toBeVisible();

    const computed = await footer.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        flexDir: cs.flexDirection,
        children: Array.from(el.children).map((c) => {
          const r = (c as HTMLElement).getBoundingClientRect();
          return Math.round(r.width);
        }),
      };
    });

    expect(computed.flexDir, 'footer deve ser column em <md').toBe('column');
    // Cada CTA precisa ocupar quase toda a largura (≥85% do viewport menos
    // padding do modal).
    for (const w of computed.children) {
      expect(w, `CTA com ${w}px (esperado ≥280)`).toBeGreaterThanOrEqual(280);
    }

    await authedPage.screenshot({
      path: testInfo.outputPath('modal-tenant.png'),
      fullPage: false,
    });
  });
});
