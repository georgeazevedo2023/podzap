/**
 * Audit spec — /home "mandar no zap" button + sidebar logo fidelity.
 *
 * Runs against the URL in PLAYWRIGHT_BASE_URL (prod by default via the
 * command line), captures evidence into `e2e/audit-output/` so the
 * orchestrator can show the user exactly what the app is doing.
 *
 * Checks:
 *   1. Sidebar logo screenshot vs the standalone prototype
 *      (`file:///.../podZAP _standalone_.html`).
 *   2. "mandar no zap" button — does clicking open the dropdown? What
 *      console errors fire? Are there network calls?
 */
import { test, expect, type ConsoleMessage, type Request } from './fixtures';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT_DIR = resolve(process.cwd(), 'e2e/audit-output');

test.describe('audit /home — dropdown + logo', () => {
  test.setTimeout(120_000);

  test('captura logo prod + protótipo + comportamento do botão', async ({
    authedPage: page,
  }) => {
    mkdirSync(OUT_DIR, { recursive: true });

    // ── logs ────────────────────────────────────────────────────────────
    const consoleLog: Array<{ type: string; text: string }> = [];
    page.on('console', (msg: ConsoleMessage) => {
      consoleLog.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err: Error) => {
      consoleLog.push({ type: 'pageerror', text: err.message });
    });
    const requestLog: Array<{ method: string; url: string; status?: number }> =
      [];
    page.on('request', (req: Request) => {
      // filter to our own API calls to keep noise low
      const u = req.url();
      if (u.includes('/api/') || u.includes('/redeliver') || u.includes('/me/phone')) {
        requestLog.push({ method: req.method(), url: u });
      }
    });
    page.on('response', async (res) => {
      const u = res.url();
      if (u.includes('/api/') || u.includes('/redeliver') || u.includes('/me/phone')) {
        const idx = requestLog.findIndex(
          (r) => r.url === u && r.status === undefined,
        );
        if (idx >= 0) requestLog[idx].status = res.status();
      }
    });

    // ── 1. /home ────────────────────────────────────────────────────────
    await page.goto('/home');
    await expect(page).toHaveURL(/\/home/);
    await page.waitForLoadState('networkidle');

    // Full-page screenshot for context.
    await page.screenshot({
      path: resolve(OUT_DIR, '01-home-full.png'),
      fullPage: true,
    });

    // Sidebar locator: <aside> with the sidebar role.
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    const logoBox = await sidebar.boundingBox();
    if (logoBox) {
      await page.screenshot({
        path: resolve(OUT_DIR, '02-prod-sidebar.png'),
        clip: {
          x: Math.max(0, logoBox.x),
          y: Math.max(0, logoBox.y),
          width: Math.min(260, logoBox.width),
          height: 120,
        },
      });
    }

    // ── 2. abrir o protótipo local numa segunda página ──────────────────
    const protoPath = resolve(
      process.cwd(),
      'podZAP _standalone_.html',
    );
    const protoUrl = pathToFileURL(protoPath).toString();
    const protoPage = await page.context().newPage();
    await protoPage.goto(protoUrl);
    await protoPage.waitForLoadState('networkidle');
    // Full screenshot of prototype for reference.
    await protoPage.screenshot({
      path: resolve(OUT_DIR, '03-proto-full.png'),
      fullPage: false,
    });
    // Prototype sidebar — <aside> too if it was preserved.
    const protoSidebar = protoPage.locator('aside').first();
    if (await protoSidebar.count()) {
      const box = await protoSidebar.boundingBox();
      if (box) {
        await protoPage.screenshot({
          path: resolve(OUT_DIR, '04-proto-sidebar.png'),
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.min(260, box.width),
            height: 120,
          },
        });
      }
    } else {
      // Prototype might just have a div.sidebar; screenshot left 260px.
      await protoPage.screenshot({
        path: resolve(OUT_DIR, '04-proto-sidebar.png'),
        clip: { x: 0, y: 0, width: 260, height: 160 },
      });
    }
    await protoPage.close();

    // ── 3. clicar "mandar no zap" no HeroPlayer ─────────────────────────
    // Button text contains "mandar no zap" per SendToMenu label.
    const sendBtn = page.getByRole('button', { name: /mandar no zap/i });
    const btnCount = await sendBtn.count();

    const audit: Record<string, unknown> = {
      url: page.url(),
      button: {
        locatorCount: btnCount,
        found: btnCount > 0,
      },
    };

    if (btnCount > 0) {
      const btn = sendBtn.first();
      await expect(btn).toBeVisible();
      await btn.scrollIntoViewIfNeeded();

      // Screenshot the hero player + button before click.
      await page.screenshot({
        path: resolve(OUT_DIR, '05-hero-before-click.png'),
        clip: await (async () => {
          const b = await btn.boundingBox();
          if (!b) return { x: 0, y: 0, width: 1200, height: 600 };
          return {
            x: Math.max(0, b.x - 900),
            y: Math.max(0, b.y - 200),
            width: 1400,
            height: 500,
          };
        })(),
      });

      // Note aria-expanded state BEFORE click.
      const ariaBefore = await btn.getAttribute('aria-expanded');
      audit.button = {
        ...(audit.button as object),
        ariaExpandedBefore: ariaBefore,
      };

      await btn.click();
      await page.waitForTimeout(400);

      // State after click.
      const ariaAfter = await btn.getAttribute('aria-expanded');
      // Look for a role=menu rendered by SendToMenu.
      const menu = page.locator('[role="menu"]');
      const menuCount = await menu.count();
      const menuVisible = menuCount > 0 ? await menu.first().isVisible() : false;
      // MenuItems inside.
      const itemLabels: string[] = [];
      if (menuCount > 0) {
        const items = menu.first().locator('[role="menuitem"]');
        const n = await items.count();
        for (let i = 0; i < n; i += 1) {
          itemLabels.push(((await items.nth(i).textContent()) ?? '').trim());
        }
      }

      // Screenshot after click (menu should be visible if working).
      await page.screenshot({
        path: resolve(OUT_DIR, '06-hero-after-click.png'),
        clip: await (async () => {
          const b = await btn.boundingBox();
          if (!b) return { x: 0, y: 0, width: 1200, height: 600 };
          return {
            x: Math.max(0, b.x - 900),
            y: Math.max(0, b.y - 200),
            width: 1400,
            height: 600,
          };
        })(),
      });

      audit.button = {
        ...(audit.button as object),
        ariaExpandedAfter: ariaAfter,
        menuRendered: menuCount,
        menuVisible,
        itemLabels,
      };
    }

    audit.consoleLog = consoleLog;
    audit.requestLog = requestLog;

    writeFileSync(
      resolve(OUT_DIR, 'audit-report.json'),
      JSON.stringify(audit, null, 2),
    );

    // The test doesn't fail on findings — it's an audit, not an assertion
    // suite. Print summary to stdout so the orchestrator can read it.
    // eslint-disable-next-line no-console
    console.log('=== AUDIT REPORT ===');
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(audit, null, 2));
    // eslint-disable-next-line no-console
    console.log('=== END REPORT ===');
  });
});
