/**
 * AI tracking service — persist every LLM / STT / TTS / vision call to the
 * `ai_calls` table so we can:
 *   - attribute cost per tenant (billing / budget alerts)
 *   - compute usage aggregates by provider + operation
 *   - debug regressions (model swap → latency spikes)
 *
 * Contract:
 *   - `trackAiCall` is BEST-EFFORT. Any failure (DB error, network blip,
 *     missing env) is swallowed + logged; the function always resolves
 *     with either `{ id }` on success or `null` on any failure. It MUST
 *     NOT throw, because the caller is usually a worker that already
 *     produced the expensive artefact (audio, summary) and billing
 *     tracking failing shouldn't roll back the primary work.
 *   - `getAiUsageForTenant` aggregates a date window. This one DOES
 *     throw on DB errors — it's called from dashboards/admin routes
 *     where an error page is the correct behaviour.
 *
 * Uses the service-role admin client on purpose: Fase 7 workers run
 * trusted server-side and we want to bypass RLS so inserts can't be
 * blocked by a misconfigured policy. RLS on `ai_calls` still blocks
 * any client-side path.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type AiProvider = "groq" | "gemini" | "openai";
export type AiOperation =
  | "transcribe"
  | "describe"
  | "summarize"
  | "tts"
  | "other";

export type TrackAiCallInput = {
  tenantId: string;
  provider: AiProvider;
  model: string;
  operation: AiOperation;
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
  durationMs?: number;
  messageId?: string;
  summaryId?: string;
  error?: string;
};

export type AiUsageByProvider = Record<
  AiProvider,
  { calls: number; costCents: number }
>;

export type AiUsageReport = {
  totalCalls: number;
  totalCostCents: number;
  byProvider: AiUsageByProvider;
};

// ──────────────────────────────────────────────────────────────────────────
//  Constants
// ──────────────────────────────────────────────────────────────────────────

const PROVIDERS: AiProvider[] = ["groq", "gemini", "openai"];

function emptyByProvider(): AiUsageByProvider {
  // Seed every known provider with zeroes so callers can always safely
  // read `report.byProvider.openai.calls` without undefined checks.
  const out = {} as AiUsageByProvider;
  for (const p of PROVIDERS) {
    out[p] = { calls: 0, costCents: 0 };
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Persist a single AI call. Best-effort — returns `{ id }` on success or
 * `null` on any failure (DB error, env missing, network, etc.) and logs
 * the error via `console.error`.
 *
 * Never throws. Callers can `void trackAiCall(...)` and keep going.
 */
export async function trackAiCall(
  input: TrackAiCallInput,
): Promise<{ id: string } | null> {
  try {
    const supabase = createAdminClient();

    // Normalise optional numeric fields: undefined → column default
    // (tokens_* / cost_cents) or null (duration_ms).
    const row = {
      tenant_id: input.tenantId,
      provider: input.provider,
      model: input.model,
      operation: input.operation,
      tokens_in: input.tokensIn ?? 0,
      tokens_out: input.tokensOut ?? 0,
      cost_cents: input.costCents ?? 0,
      duration_ms: input.durationMs ?? null,
      message_id: input.messageId ?? null,
      summary_id: input.summaryId ?? null,
      error: input.error ?? null,
    };

    const { data, error } = await supabase
      .from("ai_calls")
      .insert(row)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[ai-tracking] insert failed:", error.message);
      return null;
    }
    if (!data) {
      // Shouldn't happen with .select("id").maybeSingle() after a
      // successful insert, but handle defensively.
      console.error("[ai-tracking] insert returned no row");
      return null;
    }
    return { id: (data as { id: string }).id };
  } catch (err) {
    // Includes env-missing errors from createAdminClient(), network
    // failures, JSON errors, etc. We never surface these to callers.
    console.error(
      "[ai-tracking] unexpected error:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Aggregate AI usage for one tenant across a date window. Used by the
 * billing dashboard and internal ops tooling.
 *
 * Throws on DB error — the caller path is admin/dashboard where a 500
 * is the right response (vs. silently returning zeroes that would
 * under-report usage).
 */
export async function getAiUsageForTenant(
  tenantId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<AiUsageReport> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("ai_calls")
    .select("provider,cost_cents")
    .eq("tenant_id", tenantId)
    .gte("created_at", periodStart.toISOString())
    .lt("created_at", periodEnd.toISOString());

  if (error) {
    throw new Error(`Failed to load ai usage: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    provider: string;
    cost_cents: number;
  }>;

  const byProvider = emptyByProvider();
  let totalCalls = 0;
  let totalCostCents = 0;

  for (const r of rows) {
    totalCalls += 1;
    const cost = Number(r.cost_cents) || 0;
    totalCostCents += cost;

    // Row might carry a provider we no longer recognise (schema drift).
    // Only count it in byProvider when it matches a known label so the
    // returned shape is always clean.
    if ((PROVIDERS as string[]).includes(r.provider)) {
      const p = r.provider as AiProvider;
      byProvider[p].calls += 1;
      byProvider[p].costCents += cost;
    }
  }

  return { totalCalls, totalCostCents, byProvider };
}
