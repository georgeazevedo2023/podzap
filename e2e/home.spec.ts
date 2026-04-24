/**
 * /home hero + "gerar resumo agora" modal coverage.
 *
 * The hero is stateful: it picks one of five onboarding stages
 * (needs-whatsapp / needs-groups / waiting-messages / needs-approval /
 * ready-to-generate) based on tenant signals. We don't try to force a stage
 * here — the tenant configured via PLAYWRIGHT_TEST_EMAIL drives it. We just
 * assert that SOME hero is rendered and that the modal works when reachable.
 */
import { test, expect } from './fixtures';

test.describe('/home', () => {
  test('renderiza layout do dashboard autenticado', async ({
    authedPage: page,
  }) => {
    await page.goto('/home');

    // Stats row always renders (zeros when tenant is fresh). "resumos /
    // semana" is the first stat — decent anchor.
    await expect(page.getByText(/resumos/i).first()).toBeVisible();
  });

  test('abre modal de "gerar resumo agora" quando disponível', async ({
    authedPage: page,
  }) => {
    await page.goto('/home');

    // The button lives in multiple places (hero CTA when ready-to-generate,
    // GenerateQuickCard in sidebar). Grab the first visible one.
    const btn = page
      .getByRole('button', { name: /gerar resumo agora/i })
      .first();

    const visible = await btn.isVisible().catch(() => false);
    test.skip(
      !visible,
      'tenant stage does not surface the "gerar resumo agora" button',
    );

    await btn.click();

    // Modal contents: group select + tone pills + period pills.
    await expect(page.getByText(/divertido/i).first()).toBeVisible();
    await expect(page.getByText(/últimas 24h/i)).toBeVisible();
    await expect(page.getByText(/últimos 7 dias/i)).toBeVisible();
  });

  test('hero mostra CTA de onboarding quando tenant ainda não conectou zap', async ({
    authedPage: page,
  }) => {
    await page.goto('/home');

    // If the tenant IS connected, this spec is moot — skip silently. The
    // heuristic: look for "conectar zap" / "conectar whatsapp" text anywhere
    // on the hero card.
    const onboardingCta = page.getByText(/conectar (zap|whatsapp)/i);
    const hasCta = (await onboardingCta.count()) > 0;
    test.skip(!hasCta, 'tenant already past the needs-whatsapp stage');

    await expect(onboardingCta.first()).toBeVisible();
  });
});
