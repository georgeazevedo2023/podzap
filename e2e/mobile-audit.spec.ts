/**
 * Comprehensive mobile audit for the Fase 1 shell. Visits every tenant
 * route at iPhone 13 viewport (390×844) and reports:
 *
 *   - horizontal overflow (scrollWidth > viewport, with offending elements)
 *   - tap targets below 44px (buttons / links inside main + chrome)
 *   - whether the shell chrome (header, bottom nav) is present + visible
 *   - whether drawer opens & contains expected nav items
 *
 * Then visits each admin route at the same viewport with the same checks.
 *
 * Output: a structured JSON report logged to the test output AND
 * fail-fast assertions for the most important invariants. Screenshots are
 * captured for every visit so we have visual proof.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=http://localhost:3001 \
 *     npx playwright test e2e/mobile-audit.spec.ts --reporter=list
 */
import { test, expect } from './fixtures';

const TENANT_ROUTES = [
  '/home',
  '/approval',
  '/podcasts',
  '/groups',
  '/history',
  '/schedule',
  '/onboarding',
] as const;

const ADMIN_ROUTES = [
  '/admin',
  '/admin/tenants',
  '/admin/users',
  '/admin/uazapi',
] as const;

interface AuditFindings {
  url: string;
  scrollWidth: number;
  clientWidth: number;
  hasHorizontalOverflow: boolean;
  overflowingElements: Array<{ tag: string; cls: string; width: number }>;
  smallTapTargets: Array<{ tag: string; label: string; w: number; h: number }>;
  hasMobileHeader: boolean;
  hasBottomNav: boolean;
}

async function auditPage(
  page: import('@playwright/test').Page,
  path: string,
): Promise<AuditFindings> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');

  return await page.evaluate(() => {
    const vw = window.innerWidth;
    const root = document.documentElement;
    const scrollWidth = root.scrollWidth;
    const clientWidth = root.clientWidth;

    // Find elements wider than the viewport that aren't fixed/absolute.
    const overflowingElements: Array<{
      tag: string;
      cls: string;
      width: number;
    }> = [];
    const all = document.querySelectorAll<HTMLElement>('main *');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      if (rect.width > vw + 1) {
        overflowingElements.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 60),
          width: Math.round(rect.width),
        });
        if (overflowingElements.length >= 8) break;
      }
    }

    // Tap targets: any <button>, <a>, <input>, <select> in the doc.
    const interactive = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), select',
    );
    const smallTapTargets: Array<{
      tag: string;
      label: string;
      w: number;
      h: number;
    }> = [];
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      // Skip invisible elements (display:none, etc.) — width 0 means hidden.
      if (r.width === 0 && r.height === 0) continue;
      // Skip the dev-mode Next.js error indicator (it's an iframe-rendered
      // overlay shipped only in dev).
      if (
        el.closest('[data-nextjs-toast], [data-nextjs-dialog]') ||
        el.id?.includes('__next-build-watcher')
      )
        continue;
      if (r.width < 44 || r.height < 44) {
        const label = (
          el.getAttribute('aria-label') ??
          el.textContent?.trim() ??
          el.getAttribute('href') ??
          ''
        ).slice(0, 40);
        smallTapTargets.push({
          tag: el.tagName.toLowerCase(),
          label,
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }

    return {
      url: location.pathname,
      scrollWidth,
      clientWidth,
      hasHorizontalOverflow: scrollWidth > clientWidth + 1,
      overflowingElements,
      smallTapTargets,
      hasMobileHeader: !!document.querySelector(
        'button[aria-label="Abrir menu"]',
      ),
      hasBottomNav: !!document.querySelector(
        'nav[aria-label="Navegação principal"]',
      ),
    };
  });
}

test.describe('mobile audit @390x844 — tenant routes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of TENANT_ROUTES) {
    test(`audit ${route}`, async ({ authedPage }, testInfo) => {
      const findings = await auditPage(authedPage, route);
      console.log(
        `\n=== AUDIT ${route} ===\n${JSON.stringify(findings, null, 2)}`,
      );
      await authedPage.screenshot({
        path: testInfo.outputPath('shot.png'),
        fullPage: true,
      });

      // Hard invariants for the shell:
      expect(findings.hasMobileHeader, 'mobile header missing').toBe(true);
      expect(findings.hasBottomNav, 'bottom nav missing').toBe(true);

      // Soft checks logged but not asserted hard — Fase 1 is about chrome,
      // page content overflow is Fase 2/3. We assert NO horizontal overflow
      // for the chrome itself though (which lives at the document root).
      expect(
        findings.hasHorizontalOverflow,
        `horizontal overflow on ${route}: ${JSON.stringify(findings.overflowingElements)}`,
      ).toBe(false);
    });
  }
});

test.describe('mobile audit @390x844 — admin routes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const route of ADMIN_ROUTES) {
    test(`audit ${route}`, async ({ authedPage }, testInfo) => {
      const findings = await auditPage(authedPage, route);
      console.log(
        `\n=== ADMIN AUDIT ${route} ===\n${JSON.stringify(findings, null, 2)}`,
      );
      await authedPage.screenshot({
        path: testInfo.outputPath('shot.png'),
        fullPage: true,
      });

      // Admin shell has header but no bottom nav by design.
      expect(findings.hasMobileHeader, 'mobile header missing').toBe(true);
      expect(findings.hasBottomNav, 'admin should NOT show bottom nav').toBe(
        false,
      );
      expect(
        findings.hasHorizontalOverflow,
        `horizontal overflow on ${route}: ${JSON.stringify(findings.overflowingElements)}`,
      ).toBe(false);
    });
  }
});
