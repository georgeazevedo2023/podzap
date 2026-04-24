/**
 * UI Parity Audit — prototype vs production sidebar (focus: logo).
 *
 * Opens:
 *   1. `file:///C:/Projetos/Claude/podzap/podZAP%20_standalone_.html`
 *   2. `https://podzap.wsmart.com.br/home` (logged in)
 *
 * Captures sidebar screenshots side-by-side. Also dumps the computed
 * styles of the logo element on both so we can do pixel-math diffs.
 *
 * Output:
 *   e2e/parity/prototype-sidebar.png
 *   e2e/parity/prod-sidebar.png
 *   e2e/parity/prototype-logo.png
 *   e2e/parity/prod-logo.png
 *   e2e/parity/report.md
 *
 * Run: npx playwright test e2e/ui-parity-audit.spec.ts --project=chromium --workers=1
 */
import { test, expect } from './fixtures';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PROTO_URL =
  'file:///C:/Projetos/Claude/podzap/podZAP%20_standalone_.html';

const OUT_DIR = 'e2e/parity';

interface ElementMeta {
  tag: string;
  text: string;
  bbox: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>;
}

async function inspectLogo(page: import('@playwright/test').Page) {
  // Try common logo container patterns. Prototype uses text containing "podZAP".
  const handle = await page.evaluateHandle(() => {
    // Pick the first element whose text starts with "podZAP" and is roughly
    // in the upper-left sidebar region.
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const t = (el as HTMLElement).innerText?.trim() ?? '';
      if (
        (t === 'podZAP' || t.startsWith('podZAP\n') || t === 'podZAP\nzap → podcast' || t.toLowerCase().startsWith('podzap')) &&
        (el as HTMLElement).offsetWidth > 30 &&
        (el as HTMLElement).offsetHeight > 10
      ) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.left < 300 && r.top < 200) {
          return el;
        }
      }
    }
    return null;
  });

  const elem = handle.asElement();
  if (!elem) return null;

  const meta: ElementMeta | null = await elem.evaluate((el: Element) => {
    const box = (el as HTMLElement).getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const pickStyles = (names: string[]) =>
      Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n)]));
    return {
      tag: el.tagName.toLowerCase(),
      text: (el as HTMLElement).innerText.trim(),
      bbox: {
        x: Math.round(box.left),
        y: Math.round(box.top),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      styles: pickStyles([
        'color',
        'font-family',
        'font-size',
        'font-weight',
        'letter-spacing',
        'line-height',
        'text-shadow',
        'text-transform',
        'background',
        'background-color',
        'padding',
        'gap',
        'display',
        'flex-direction',
        'border',
        'border-radius',
      ]),
    } as ElementMeta;
  });

  return { elem, meta };
}

test('parity: prototype vs prod sidebar logo', async ({ authedPage: page }) => {
  test.setTimeout(90_000);
  mkdirSync(OUT_DIR, { recursive: true });

  // ── PROD ────────────────────────────────────────────────────────────
  await page.goto('/home');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);

  const prodSidebar = page.locator('aside, nav[class*="Sidebar"], [class*="sidebar"]').first();
  const prodBuffer = await prodSidebar.screenshot({
    path: resolve(OUT_DIR, 'prod-sidebar.png'),
  });
  console.log('PROD sidebar screenshot:', prodBuffer.length, 'bytes');

  const prodLogo = await inspectLogo(page);
  if (prodLogo) {
    await prodLogo.elem.screenshot({
      path: resolve(OUT_DIR, 'prod-logo.png'),
    });
    console.log('PROD logo:', JSON.stringify(prodLogo.meta, null, 2));
  }

  // ── PROTOTYPE ───────────────────────────────────────────────────────
  const protoPage = await page.context().newPage();
  await protoPage.goto(PROTO_URL);
  await protoPage.waitForLoadState('networkidle');
  await protoPage.waitForTimeout(800);

  const protoSidebar = protoPage
    .locator('aside, nav[class*="Sidebar"], [class*="sidebar"]')
    .first();
  const protoBuffer = await protoSidebar.screenshot({
    path: resolve(OUT_DIR, 'prototype-sidebar.png'),
  });
  console.log('PROTOTYPE sidebar screenshot:', protoBuffer.length, 'bytes');

  const protoLogo = await inspectLogo(protoPage);
  if (protoLogo) {
    await protoLogo.elem.screenshot({
      path: resolve(OUT_DIR, 'prototype-logo.png'),
    });
    console.log('PROTOTYPE logo:', JSON.stringify(protoLogo.meta, null, 2));
  }

  // ── Diff relatório ───────────────────────────────────────────────────
  const lines: string[] = [];
  lines.push('# UI Parity Audit — sidebar logo');
  lines.push('');
  lines.push(`Data: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('## Protótipo');
  lines.push('```json');
  lines.push(JSON.stringify(protoLogo?.meta ?? null, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Produção');
  lines.push('```json');
  lines.push(JSON.stringify(prodLogo?.meta ?? null, null, 2));
  lines.push('```');
  lines.push('');

  if (protoLogo?.meta && prodLogo?.meta) {
    lines.push('## Diffs por estilo');
    const keys = Object.keys(protoLogo.meta.styles);
    for (const k of keys) {
      const a = protoLogo.meta.styles[k];
      const b = prodLogo.meta.styles[k];
      if (a !== b) {
        lines.push(`- **${k}**: protótipo \`${a}\` → prod \`${b}\``);
      }
    }
  }

  writeFileSync(resolve(OUT_DIR, 'report.md'), lines.join('\n'));
  console.log('Report written:', resolve(OUT_DIR, 'report.md'));

  expect(true).toBe(true);
});
