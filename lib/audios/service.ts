/**
 * `lib/audios/service.ts` — Fase 9.
 *
 * Orchestrates TTS generation + Storage upload + DB persistence for
 * approved summaries. The worker (`inngest/functions/generate-tts.ts`)
 * is the primary caller; API routes that need to re-fetch the generated
 * audio use `getAudioBySummary` / `listAudios`.
 *
 * Design mirrors `lib/summaries/service.ts`:
 *   - Service-role admin client for every DB + Storage call (these paths
 *     are all trusted server code; tenants are resolved upstream and the
 *     `tenant_id` filter is applied defensively on every WHERE).
 *   - Narrow `AudiosError` with a fixed `code` enum so route handlers
 *     and Inngest retry logic can discriminate without string matching.
 *   - `createAudioForSummary` is deliberately NOT idempotent at the
 *     happy-path level: if a row already exists we throw ALREADY_EXISTS.
 *     The caller (worker) decides whether to retry or skip — silently
 *     overwriting a row would also require re-uploading to Storage,
 *     which costs money and is rarely what we want.
 */

import path from "node:path";

import { createAdminClient } from "@/lib/supabase/admin";
import { generateAudio } from "@/lib/ai/gemini-tts";
import { trackAiCall } from "@/lib/ai-tracking/service";
import { mixWithBackgroundMusic, MixError } from "@/lib/audios/mix";

const AUDIOS_BUCKET = "audios";

// Trilha de fundo do podcast. Mora em `assets/` no root do repo e vai no
// imagem Docker (COPY . . no builder stage). 3s de intro + loop durante a
// voz + fade out 1s — ver `lib/audios/mix.ts`.
const BACKGROUND_MUSIC_PATH = path.join(
  process.cwd(),
  "assets",
  "podcast-music.mp3",
);

export type AudioView = {
  id: string;
  tenantId: string;
  summaryId: string;
  storagePath: string;
  durationSeconds: number | null;
  voice: string | null;
  speed: number | null;
  model: string | null;
  sizeBytes: number | null;
  deliveredToWhatsapp: boolean;
  deliveredAt: string | null;
  createdAt: string;
};

export class AudiosError extends Error {
  constructor(
    public code: "NOT_FOUND" | "ALREADY_EXISTS" | "TTS_ERROR" | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "AudiosError";
  }
}

type AudioRow = {
  id: string;
  tenant_id: string;
  summary_id: string;
  storage_path: string;
  duration_seconds: number | null;
  voice: string | null;
  speed: number | null;
  model: string | null;
  size_bytes: number | null;
  delivered_to_whatsapp: boolean;
  delivered_at: string | null;
  created_at: string;
};

const AUDIO_SELECT_COLUMNS = `
  id,
  tenant_id,
  summary_id,
  storage_path,
  duration_seconds,
  voice,
  speed,
  model,
  size_bytes,
  delivered_to_whatsapp,
  delivered_at,
  created_at
` as const;

function rowToView(row: AudioRow): AudioView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    summaryId: row.summary_id,
    storagePath: row.storage_path,
    durationSeconds: row.duration_seconds,
    voice: row.voice,
    speed: row.speed,
    model: row.model,
    sizeBytes: row.size_bytes,
    deliveredToWhatsapp: row.delivered_to_whatsapp,
    deliveredAt: row.delivered_at,
    createdAt: row.created_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Reads
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fetch the single audio row attached to a summary (the `summary_id`
 * column is UNIQUE). Returns `null` if no row exists or if it belongs to
 * another tenant.
 */
export async function getAudioBySummary(
  tenantId: string,
  summaryId: string,
): Promise<AudioView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audios")
    .select(AUDIO_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("summary_id", summaryId)
    .maybeSingle();

  if (error) {
    throw new AudiosError(
      "DB_ERROR",
      `Failed to load audio for summary ${summaryId}: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return rowToView(data as AudioRow);
}

/**
 * List all audios for a tenant, newest first. `limit` defaults to 20 and
 * is clamped to [1, 100].
 */
export async function listAudios(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<AudioView[]> {
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audios")
    .select(AUDIO_SELECT_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new AudiosError(
      "DB_ERROR",
      `Failed to list audios for tenant ${tenantId}: ${error.message}`,
      error,
    );
  }
  return (data ?? []).map((r) => rowToView(r as AudioRow));
}

// ──────────────────────────────────────────────────────────────────────────
//  Write path
// ──────────────────────────────────────────────────────────────────────────

type SummaryLookupRow = {
  id: string;
  tenant_id: string;
  text: string;
  status: string;
  prompt_version: string | null;
  voice_mode: "single" | "duo";
};

/**
 * Orchestrate the full TTS flow for one approved summary:
 *
 *   1. Load summary (must exist, must belong to tenant, must be approved).
 *   2. Bail if an audio already exists (ALREADY_EXISTS — caller decides
 *      whether to retry or report success).
 *   3. Call Gemini TTS.
 *   4. Upload the resulting WAV to `<tenantId>/<yyyy>/<summaryId>.wav`.
 *   5. Insert the `audios` row.
 *   6. Best-effort `trackAiCall` for billing/observability.
 *
 * Any Storage or DB failure surfaces as `AudiosError('DB_ERROR')` after
 * the original `AiError` is wrapped; a TTS failure surfaces as
 * `AudiosError('TTS_ERROR')`. The worker's `retries: 2` + Inngest backoff
 * then cover transient Gemini 5xx / rate-limit errors.
 */
export async function createAudioForSummary(
  tenantId: string,
  summaryId: string,
  opts?: { voice?: "male" | "female"; speed?: number },
): Promise<AudioView> {
  const admin = createAdminClient();

  // ── 1. Load summary ───────────────────────────────────────────────────
  const { data: summary, error: summaryErr } = await admin
    .from("summaries")
    .select("id, tenant_id, text, status, prompt_version, voice_mode")
    .eq("tenant_id", tenantId)
    .eq("id", summaryId)
    .maybeSingle();

  if (summaryErr) {
    throw new AudiosError(
      "DB_ERROR",
      `Failed to load summary ${summaryId}: ${summaryErr.message}`,
      summaryErr,
    );
  }
  if (!summary) {
    throw new AudiosError(
      "NOT_FOUND",
      `Summary ${summaryId} not found for tenant ${tenantId}`,
    );
  }

  const summaryRow = summary as SummaryLookupRow;
  if (summaryRow.status !== "approved") {
    // Defensive — the worker only fires on `summaryApproved`, but if this
    // helper is ever called from an admin tool we don't want to synthesize
    // un-approved text.
    throw new AudiosError(
      "NOT_FOUND",
      `Summary ${summaryId} is not approved (status=${summaryRow.status})`,
    );
  }

  // ── 2. Short-circuit if audio already exists ─────────────────────────
  const existing = await getAudioBySummary(tenantId, summaryId);
  if (existing) {
    throw new AudiosError(
      "ALREADY_EXISTS",
      `Audio already exists for summary ${summaryId}`,
    );
  }

  // ── 3. Call Gemini TTS ────────────────────────────────────────────────
  // voice_mode lido do summary row — foi decidido no tempo da request
  // (modal /home). Legado / retries caem em 'single' via default do schema.
  const voice = opts?.voice;
  const speed = opts?.speed;
  const mode = summaryRow.voice_mode ?? "single";
  const startedAt = Date.now();

  let ttsResult;
  try {
    ttsResult = await generateAudio({
      text: summaryRow.text,
      voice,
      speed,
      mode,
    });
  } catch (err) {
    throw new AudiosError(
      "TTS_ERROR",
      `Gemini TTS failed for summary ${summaryId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      err,
    );
  }
  const durationMs = Date.now() - startedAt;

  // ── 3b. Mixa voz + música de fundo (best-effort) ──────────────────────
  // Se ffmpeg não estiver disponível ou falhar, caímos pra voz pura. A
  // música é enhancement, não requisito — não vale travar a entrega
  // porque o binário sumiu do container.
  let finalAudio = ttsResult.audio;
  let finalDurationSeconds = ttsResult.durationSeconds;
  try {
    const mixed = await mixWithBackgroundMusic(ttsResult.audio, {
      musicPath: BACKGROUND_MUSIC_PATH,
    });
    finalAudio = mixed.mixed;
    finalDurationSeconds = mixed.durationSeconds;
  } catch (err) {
    const code = err instanceof MixError ? err.code : "UNKNOWN";
    const msg = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(
      `[audios] background music mix failed (${code}), falling back to voice-only: ${msg}`,
    );
  }

  // ── 4. Upload to Storage ──────────────────────────────────────────────
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const storagePath = `${tenantId}/${yyyy}/${summaryId}.wav`;
  const { error: uploadErr } = await admin.storage
    .from(AUDIOS_BUCKET)
    .upload(storagePath, finalAudio, {
      contentType: ttsResult.mimeType,
      upsert: false,
    });
  if (uploadErr) {
    throw new AudiosError(
      "DB_ERROR",
      `Storage upload failed for summary ${summaryId}: ${uploadErr.message}`,
      uploadErr,
    );
  }

  // ── 5. Insert audios row ──────────────────────────────────────────────
  const durationSeconds = finalDurationSeconds
    ? Math.round(finalDurationSeconds)
    : null;

  const { data: inserted, error: insertErr } = await admin
    .from("audios")
    .insert({
      tenant_id: tenantId,
      summary_id: summaryId,
      storage_path: storagePath,
      duration_seconds: durationSeconds,
      voice: voice ?? null,
      speed: speed ?? null,
      model: ttsResult.model,
      size_bytes: finalAudio.byteLength,
      delivered_to_whatsapp: false,
    })
    .select(AUDIO_SELECT_COLUMNS)
    .maybeSingle();

  if (insertErr) {
    // Best-effort: try to delete the orphaned storage object so a retry
    // can re-upload cleanly. Any failure here is swallowed — the row
    // insert is the source of truth.
    try {
      await admin.storage.from(AUDIOS_BUCKET).remove([storagePath]);
    } catch {
      /* ignore */
    }
    throw new AudiosError(
      "DB_ERROR",
      `Failed to insert audio row for summary ${summaryId}: ${insertErr.message}`,
      insertErr,
    );
  }
  if (!inserted) {
    throw new AudiosError(
      "DB_ERROR",
      `Audio insert returned no row for summary ${summaryId}`,
    );
  }

  // ── 6. Best-effort tracking ──────────────────────────────────────────
  // `trackAiCall` never throws; `void` the promise so we don't block.
  void trackAiCall({
    tenantId,
    provider: "gemini",
    model: ttsResult.model,
    operation: "tts",
    durationMs,
    summaryId,
  });

  return rowToView(inserted as AudioRow);
}
