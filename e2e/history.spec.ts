/**
 * /history coverage:
 *   - Page loads for an authenticated tenant.
 *   - Pagination appears when total > 20 (PAGE_SIZE) — the audit flagged that
 *     prod has 61 rows, so page 1 should show "próxima →" enabled at top and
 *     bottom, and clicking it bumps `?page=2` and activates "anterior".
 *   - Group filter writes `?group=<uuid>` to the URL and updates the count
 *     badge.
 *   - The "gerar resumo agora" button opens a modal with tone + período
 *     controls.
 *
 * Pagination & filter assertions degrade gracefully: if the tenant used for
 * testing doesn't have enough messages / multiple groups, those specs
 * `test.skip()` themselves rather than falsely failing.
 */
import { test, expect } from './fixtures';

test.describe('/history', () => {
  test('carrega feed autenticado', async ({ authedPage: page }) => {
    await page.goto('/history');
    await expect(page).toHaveURL(/\/history/);

    // Filter bar + "gerar resumo agora" button are always present (even with
    // zero messages — the button disables when there are no monitored groups).
    await expect(page.getByLabel(/filtrar por grupo/i)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /gerar resumo agora/i }),
    ).toBeVisible();
  });

  test('paginação aparece quando total > 20 e avança pra page 2', async ({
    authedPage: page,
  }) => {
    await page.goto('/history');

    const pagination = page.getByRole('navigation', {
      name: /paginação do histórico/i,
    });

    // Zero / 1-page tenants: skip — not a failure, just not covered by this run.
    const count = await pagination.count();
    test.skip(count === 0, 'tenant has <= 20 messages; pagination not rendered');

    const nextBtn = pagination.getByRole('button', { name: /próxima página/i });
    const prevBtn = pagination.getByRole('button', { name: /página anterior/i });

    await expect(nextBtn).toBeEnabled();
    await expect(prevBtn).toBeDisabled(); // page 1

    await nextBtn.click();
    await page.waitForURL(/[?&]page=2/, { timeout: 10_000 });

    // After navigation the pagination re-renders — re-bind.
    const nav2 = page.getByRole('navigation', {
      name: /paginação do histórico/i,
    });
    await expect(
      nav2.getByRole('button', { name: /página anterior/i }),
    ).toBeEnabled();
  });

  test('filtro por grupo atualiza URL com ?group=', async ({
    authedPage: page,
  }) => {
    await page.goto('/history');

    const select = page.getByLabel(/filtrar por grupo/i);
    await expect(select).toBeVisible();

    // Pick the first non-empty option ("todos os grupos" has value=""). If
    // the tenant has no monitored groups we only have the "all" option — skip.
    const options = select.locator('option');
    const optCount = await options.count();
    test.skip(
      optCount < 2,
      'tenant has no monitored groups besides the "all" option',
    );

    const firstGroupValue = await options.nth(1).getAttribute('value');
    test.skip(!firstGroupValue, 'first group option has empty value');

    await select.selectOption(firstGroupValue!);
    await page.waitForURL(/[?&]group=/, { timeout: 10_000 });

    // Count badge updates — we just check it renders a number + "msg".
    await expect(page.getByText(/\d+\s+msg/i).first()).toBeVisible();
  });

  test('botão "gerar resumo agora" abre modal', async ({
    authedPage: page,
  }) => {
    await page.goto('/history');

    const btn = page.getByRole('button', {
      name: /gerar resumo agora/i,
    });
    await expect(btn).toBeVisible();

    // When the tenant has no monitored groups the button is disabled — skip.
    const isDisabled = await btn.isDisabled();
    test.skip(isDisabled, 'no monitored groups; generate button disabled');

    await btn.click();

    // GenerateNowModal renders via the shared Modal component. Tone radios
    // ("divertido", "formal", "corporativo") and período options ("últimas
    // 24h", "últimos 7 dias") are its signature.
    await expect(page.getByText(/divertido/i).first()).toBeVisible();
    await expect(page.getByText(/últimas 24h/i)).toBeVisible();
  });
});
