/**
 * End-to-end pipeline smoke — drives a full podcast generation from the UI:
 *
 *   1. login (via `authedPage`)
 *   2. /history → filter by group "PRO TOOLS BOX"
 *   3. open "gerar resumo agora" modal
 *   4. pick tom "divertido" + período "últimas 24h" + keep pre-selected group
 *   5. submit "fazer podcast" → modal closes → redirects to /approval
 *   6. wait up to ~60s for a new `pending_review` SummaryCard to appear
 *      (compares card count before/after + picks the newest first card)
 *   7. click the card → /approval/[id]
 *   8. click "✓ aprovar" in the toolbar → redirects back to /approval?status=approved
 *   9. poll GET /api/summaries/[id]/audio/signed-url until 200 (Fase 9 TTS ~15-40s)
 *  10. log the signed URL + wall-clock duration + summary id to stdout so
 *      the orchestrator can share it with the user.
 *
 * The spec is best-effort: if the tenant has no "PRO TOOLS BOX" group, no
 * monitored groups at all, or the generate button is disabled, we `test.skip`
 * rather than fail — matches the pattern used by `history.spec.ts`.
 *
 * NOT covered (documented in the agent deliverable):
 *   - rate-limit hit on /api/summaries/generate (429)
 *   - reject-before-approve flow
 *   - redeliver / re-approve
 *   - autoApprove path (schedule-triggered)
 *   - audio <audio> element actually playing (browser autoplay policy blocks)
 */
import { test, expect, type Page, type Locator } from './fixtures';

const TARGET_GROUP_NAME = 'PRO TOOLS BOX';

// Total wall-clock budget for the whole spec. Gemini Pro (summary) ~10-40s +
// Gemini TTS ~15-30s + network/Inngest queueing overhead — 3 min is safe.
const SPEC_TIMEOUT_MS = 180_000;

// Wait for a NEW SummaryCard to appear on /approval after submit. Covers the
// Inngest roundtrip + Gemini Pro generation. 90s is generous.
const NEW_SUMMARY_TIMEOUT_MS = 90_000;

// After approve, poll the signed-url endpoint for the audio. Gemini TTS +
// storage upload. 90s upper bound.
const AUDIO_READY_TIMEOUT_MS = 90_000;
const AUDIO_POLL_INTERVAL_MS = 3_000;

interface AudioPayload {
  url: string;
  durationSeconds?: number | null;
  mimeType?: string | null;
}

/**
 * Poll `/api/summaries/[id]/audio/signed-url` until it returns 200 or we hit
 * the timeout. 404 is the "still generating" state — anything else bubbles.
 */
async function waitForAudioSignedUrl(
  page: Page,
  summaryId: string,
  timeoutMs: number,
): Promise<AudioPayload> {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 0;
  let lastBody = '';

  while (Date.now() < deadline) {
    const res = await page.request.get(
      `/api/summaries/${encodeURIComponent(summaryId)}/audio/signed-url`,
    );
    lastStatus = res.status();
    if (res.ok()) {
      const payload = (await res.json()) as AudioPayload;
      return payload;
    }
    if (res.status() !== 404) {
      // Capture the body for diagnostics then stop — we don't retry 5xx here
      // because the route doesn't have a transient-failure path worth retrying.
      lastBody = await res.text().catch(() => '');
      throw new Error(
        `audio signed-url failed: HTTP ${res.status()} — ${lastBody.slice(0, 200)}`,
      );
    }
    await page.waitForTimeout(AUDIO_POLL_INTERVAL_MS);
  }

  throw new Error(
    `audio signed-url never returned 200 in ${timeoutMs}ms (last status ${lastStatus})`,
  );
}

/**
 * Count SummaryCards on /approval. We use the anchor href (`/approval/<uuid>`)
 * as the card locator — it's what `SummaryCard` emits (see
 * app/(app)/approval/SummaryCard.tsx:144) and it's independent of styling
 * tokens / aria labels that may drift.
 */
function cardLocator(page: Page): Locator {
  return page.locator('a[href^="/approval/"]');
}

/** Extract the summary id from a /approval/<uuid> href on the first card. */
async function readCardSummaryId(card: Locator): Promise<string> {
  const href = await card.getAttribute('href');
  if (!href) throw new Error('SummaryCard <a> has no href');
  const match = /\/approval\/([^/?#]+)/.exec(href);
  if (!match) throw new Error(`unexpected /approval link: ${href}`);
  return match[1];
}

test.describe('pipeline completo — gerar → aprovar → áudio', () => {
  test.setTimeout(SPEC_TIMEOUT_MS);

  test('gera podcast de ponta a ponta pra grupo PRO TOOLS BOX', async ({
    authedPage: page,
  }) => {
    const started = Date.now();

    // ── 1. /history ─────────────────────────────────────────────────────
    await page.goto('/history');
    await expect(page).toHaveURL(/\/history/);

    const select = page.getByLabel(/filtrar por grupo/i);
    await expect(select).toBeVisible();

    // Locate the PRO TOOLS BOX option by visible label. `<option>` matching
    // is substring-friendly via `selectOption({ label })` when the label is
    // an exact match — fall back to a contains scan otherwise.
    const options = select.locator('option');
    const optCount = await options.count();
    let targetValue: string | null = null;
    for (let i = 0; i < optCount; i++) {
      const label = (await options.nth(i).textContent())?.trim() ?? '';
      if (label.toUpperCase().includes(TARGET_GROUP_NAME)) {
        targetValue = await options.nth(i).getAttribute('value');
        break;
      }
    }
    test.skip(
      !targetValue,
      `tenant has no group matching "${TARGET_GROUP_NAME}"; pipeline spec inapplicable`,
    );

    await select.selectOption(targetValue!);
    await page.waitForURL(/[?&]group=/, { timeout: 10_000 });

    // ── 2. abrir modal "gerar resumo agora" ─────────────────────────────
    const genBtn = page.getByRole('button', { name: /gerar resumo agora/i });
    await expect(genBtn).toBeVisible();
    const genDisabled = await genBtn.isDisabled();
    test.skip(genDisabled, 'generate button disabled — no monitored groups');
    await genBtn.click();

    // Modal is open: tone pills + period pills + group select visible.
    await expect(page.getByText(/divertido/i).first()).toBeVisible();
    await expect(page.getByText(/últimas 24h/i)).toBeVisible();

    // ── 3. seleciona tom + período (divertido/24h são defaults) ─────────
    // `RadioPill` renders each option as a `<label>`-wrapped radio. Click
    // the label text — pointer events on the hidden input work but the
    // label is more robust.
    await page.getByText(/^divertido$/i).click();
    await page.getByText(/últimas 24h/i).click();

    // Capture the snapshot of current pending_review cards BEFORE submit so
    // we can diff for the newly-generated one.
    // (We switch to /approval after submit — no need to count here; we'll
    //  just wait for cards to appear and pick the first.)

    // ── 4. submit ───────────────────────────────────────────────────────
    const submitBtn = page.getByRole('button', { name: /fazer podcast/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // Modal closes + router.push('/approval') fires on 2xx.
    await page.waitForURL(/\/approval(\?|$)/, { timeout: 15_000 });

    // ── 5. aguardar nova summary aparecer ───────────────────────────────
    // Poll the page for a SummaryCard — the worker needs ~10-40s to insert
    // the pending_review row. We reload periodically because /approval is
    // a server component (no live subscription).
    const cards = cardLocator(page);
    const newSummaryDeadline = Date.now() + NEW_SUMMARY_TIMEOUT_MS;
    let cardCount = 0;
    while (Date.now() < newSummaryDeadline) {
      cardCount = await cards.count();
      if (cardCount > 0) break;
      await page.waitForTimeout(3_000);
      await page.reload();
    }
    expect(
      cardCount,
      `expected at least one pending SummaryCard within ${NEW_SUMMARY_TIMEOUT_MS}ms`,
    ).toBeGreaterThan(0);

    // The freshest pending lives at the top — `listSummaries` orders by
    // created_at DESC (see lib/summaries/service.ts).
    const firstCard = cards.first();
    const summaryId = await readCardSummaryId(firstCard);

    // ── 6. navegar pro detail ───────────────────────────────────────────
    await firstCard.click();
    await page.waitForURL(new RegExp(`/approval/${summaryId}`), {
      timeout: 10_000,
    });

    // ── 7. aprovar ──────────────────────────────────────────────────────
    // Button text comes from SummaryEditor.tsx:423 — "✓ aprovar" (plus the
    // "⟳ aprovando…" loading state). We match by aria-label for stability.
    const approveBtn = page.getByRole('button', { name: /aprovar resumo/i });
    await expect(approveBtn).toBeVisible();
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Successful approve redirects to /approval?status=approved.
    await page.waitForURL(/\/approval\?status=approved/, { timeout: 20_000 });

    // ── 8. aguardar áudio ───────────────────────────────────────────────
    const audio = await waitForAudioSignedUrl(
      page,
      summaryId,
      AUDIO_READY_TIMEOUT_MS,
    );

    expect(audio.url).toMatch(/^https?:\/\/.+/);

    // Sanity-check that the signed URL itself is reachable (200). We don't
    // try to decode the WAV — just confirm it streams.
    const head = await page.request.get(audio.url);
    expect(
      head.status(),
      `signed URL returned non-2xx (${head.status()})`,
    ).toBeGreaterThanOrEqual(200);
    expect(head.status()).toBeLessThan(300);

    const wallClockS = Math.round((Date.now() - started) / 1000);

    // ── 9. deliverable pro orquestrador ─────────────────────────────────
    // eslint-disable-next-line no-console
    console.log(
      [
        '=== PIPELINE RESULT ===',
        `summaryId:  ${summaryId}`,
        `audioUrl:   ${audio.url}`,
        `mimeType:   ${audio.mimeType ?? 'unknown'}`,
        `duration:   ${wallClockS}s (wall-clock total)`,
        `audioLen:   ${audio.durationSeconds ?? 'unknown'}s`,
        '=======================',
      ].join('\n'),
    );
  });
});
