/**
 * Phase 7 — Summary generator orchestrator.
 *
 * Glue between the Phase 6 pipeline, the Phase 7 prompt builder, the
 * Gemini 2.5 Pro LLM wrapper, the `summaries` row insert, and the
 * `ai_calls` cost-tracking table.
 *
 * Flow:
 *   1. `buildNormalizedConversation(...)` — pulls messages + transcripts +
 *      group name, filters + clusters into `Topic[]`. Empty conversations
 *      short-circuit with `SummaryError('EMPTY_CONVERSATION')` because
 *      feeding the LLM zero topics would either waste a call or produce
 *      hallucinated narrative.
 *   2. `buildSummaryPrompt(conv, tone)` — tone-aware system/user prompt
 *      pair with a versioned identifier.
 *   3. `generateSummaryFromPrompt(...)` — Gemini 2.5 Pro structured-JSON
 *      call. Wrapped in a duration timer so we can track it in `ai_calls`.
 *   4. Insert into `summaries` with `status='pending_review'`. Any DB error
 *      here rolls up as `SummaryError('DB_ERROR')` — tracking still fires
 *      for the AI call so we don't lose cost attribution even when persist
 *      fails.
 *   5. Best-effort `trackAiCall(...)` on both success and AI-error paths.
 *      Tracking never throws (service-level guarantee); we don't need to
 *      guard here.
 *
 * Why a service-role admin client: this module runs inside Inngest workers
 * and manual POST handlers that are already trusted. Bypassing RLS avoids
 * a misconfigured policy silently blocking inserts and masking bugs in
 * dev.
 *
 * See `docs/plans/fase-7-plan.md` and the contract in the phase prompt.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { buildNormalizedConversation } from "@/lib/pipeline/normalize";
import {
  buildSummaryPrompt,
  type SummaryTone,
  type VoiceMode,
} from "@/lib/summary/prompt";
import { generateSummaryFromPrompt } from "@/lib/ai/gemini-llm";
import { trackAiCall } from "@/lib/ai-tracking/service";

export type { SummaryTone };

export type GenerateSummaryInput = {
  tenantId: string;
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
  tone?: SummaryTone;
  /** 'single' narrator (default) or 'duo' Ana+Beto dialog. */
  voiceMode?: VoiceMode;
};

export type SummaryRecord = {
  id: string;
  tenantId: string;
  groupId: string;
  periodStart: Date;
  periodEnd: Date;
  text: string;
  tone: SummaryTone;
  status: "pending_review" | "approved" | "rejected";
  model: string;
  promptVersion: string;
  createdAt: Date;
};

export type SummaryErrorCode = "EMPTY_CONVERSATION" | "AI_ERROR" | "DB_ERROR";

/**
 * Dedicated error type so Inngest/route callers can branch by `code`
 * without string-matching messages. `cause` preserves the original
 * Supabase / Gemini error for logging.
 */
export class SummaryError extends Error {
  public readonly code: SummaryErrorCode;
  public readonly cause?: unknown;

  constructor(code: SummaryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "SummaryError";
    this.code = code;
    this.cause = cause;
  }
}

const DEFAULT_TONE: SummaryTone = "fun";
const DEFAULT_VOICE_MODE: VoiceMode = "single";

/**
 * Orchestrate a single summary generation end-to-end. See module comment
 * for the pipeline. Throws `SummaryError` with a narrow `code` on any
 * failure; never leaks raw Supabase / Gemini errors to callers.
 */
export async function generateSummary(
  input: GenerateSummaryInput,
): Promise<SummaryRecord> {
  const tone: SummaryTone = input.tone ?? DEFAULT_TONE;
  const voiceMode: VoiceMode = input.voiceMode ?? DEFAULT_VOICE_MODE;

  // ── Step 1: normalized conversation ────────────────────────────────
  // The pipeline throws on invalid ranges / DB errors; we let those
  // surface as-is (they're developer bugs, not AI failures).
  const conv = await buildNormalizedConversation(
    input.tenantId,
    input.groupId,
    input.periodStart,
    input.periodEnd,
  );

  if (conv.topics.length === 0) {
    throw new SummaryError(
      "EMPTY_CONVERSATION",
      `No topics to summarize for group ${input.groupId} in window ${input.periodStart.toISOString()}..${input.periodEnd.toISOString()}`,
    );
  }

  // ── Step 2: prompt bundle ──────────────────────────────────────────
  const { systemPrompt, userPrompt, promptVersion } = buildSummaryPrompt(
    conv,
    tone,
    { voiceMode },
  );

  // ── Step 3: Gemini call (with duration timing) ─────────────────────
  const startedAt = Date.now();
  let llmResult: Awaited<ReturnType<typeof generateSummaryFromPrompt>>;
  try {
    llmResult = await generateSummaryFromPrompt({
      systemPrompt,
      userPrompt,
      promptVersion,
    });
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    // Track the failed call for cost/latency visibility. `model` may be
    // unknown (we failed before resolving it); use the env default so
    // the row is still queryable.
    const modelName = process.env.GEMINI_LLM_MODEL ?? "gemini-2.5-pro";
    await trackAiCall({
      tenantId: input.tenantId,
      provider: "gemini",
      model: modelName,
      operation: "summarize",
      durationMs,
      error: err instanceof Error ? err.message : String(err),
    });

    throw new SummaryError(
      "AI_ERROR",
      err instanceof Error ? err.message : "Unknown Gemini error",
      err,
    );
  }
  const durationMs = Date.now() - startedAt;

  // ── Step 4: persist to `summaries` ─────────────────────────────────
  const supabase = createAdminClient();
  const { data: inserted, error: insertErr } = await supabase
    .from("summaries")
    .insert({
      tenant_id: input.tenantId,
      group_id: input.groupId,
      period_start: input.periodStart.toISOString(),
      period_end: input.periodEnd.toISOString(),
      text: llmResult.text,
      tone,
      voice_mode: voiceMode,
      status: "pending_review",
      model: llmResult.model,
      // Override the wrapper's echoed version with the one WE built —
      // they agree today but the orchestrator is the source of truth
      // (e.g. future prompt A/B tests will vary here, not inside the
      // Gemini wrapper).
      prompt_version: promptVersion,
    })
    .select("id, created_at")
    .maybeSingle();

  if (insertErr || !inserted) {
    // Track the successful AI call even though persist failed — we
    // still paid for it, and debugging a 500 without a cost row would
    // be painful.
    await trackAiCall({
      tenantId: input.tenantId,
      provider: "gemini",
      model: llmResult.model,
      operation: "summarize",
      durationMs,
      error: insertErr
        ? `db_insert_failed: ${insertErr.message}`
        : "db_insert_returned_no_row",
    });

    throw new SummaryError(
      "DB_ERROR",
      insertErr
        ? `Failed to insert summary row: ${insertErr.message}`
        : "Insert returned no row",
      insertErr,
    );
  }

  const row = inserted as { id: string; created_at: string };

  // ── Step 5: track the AI call ──────────────────────────────────────
  await trackAiCall({
    tenantId: input.tenantId,
    provider: "gemini",
    model: llmResult.model,
    operation: "summarize",
    durationMs,
    summaryId: row.id,
  });

  return {
    id: row.id,
    tenantId: input.tenantId,
    groupId: input.groupId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    text: llmResult.text,
    tone,
    status: "pending_review",
    model: llmResult.model,
    promptVersion,
    createdAt: new Date(row.created_at),
  };
}
