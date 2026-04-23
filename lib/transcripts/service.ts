/**
 * `transcripts` service — thin typed wrapper over the Supabase admin client
 * for the single table that both Fase 5 workers (transcribe-audio and
 * describe-image) write into.
 *
 * Why a service layer instead of calling Supabase inline in each worker:
 *
 *   - The shape of what workers persist is identical (messageId + text +
 *     some metadata) but each worker fills a different subset of the
 *     metadata fields. Centralising the insert shape keeps the DB schema
 *     expectations in one place.
 *
 *   - The `transcripts.message_id` column has a UNIQUE constraint (see
 *     `lib/supabase/types.ts`). An INSERT on re-run would fail; the retry
 *     worker (Agente 4) and manual re-trigger path (`message.transcription.
 *     requested` with `force`) both expect upsert semantics. We implement
 *     that as `INSERT ... ON CONFLICT` via the PostgREST client's
 *     `upsert({ onConflict: 'message_id' })`.
 *
 *   - Gives us a single `TranscriptView` type that the UI (Agente 5 —
 *     MessagesList) can depend on without importing Supabase types.
 *
 * NOTE — row-level security: this module uses the service-role client
 * (`createAdminClient`) and is only ever invoked from Inngest workers or
 * admin tooling running server-side. NEVER import from client code.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type TranscriptView = {
  id: string;
  messageId: string;
  text: string;
  language: string | null;
  confidence: number | null;
  model: string | null;
  createdAt: string;
};

export type UpsertTranscriptInput = {
  messageId: string;
  text: string;
  language?: string | null;
  confidence?: number | null;
  model: string;
};

/**
 * Row shape returned by the `.select()` after upsert/fetch. Narrowed to the
 * columns we actually project to `TranscriptView`, so a future migration
 * that adds columns doesn't silently leak them through.
 */
type TranscriptRow = {
  id: string;
  message_id: string;
  text: string;
  language: string | null;
  confidence: number | null;
  model: string | null;
  created_at: string;
};

function toView(row: TranscriptRow): TranscriptView {
  return {
    id: row.id,
    messageId: row.message_id,
    text: row.text,
    language: row.language,
    confidence: row.confidence,
    model: row.model,
    createdAt: row.created_at,
  };
}

export class TranscriptError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "TranscriptError";
  }
}

/**
 * Insert-or-update a transcript for `messageId`. Conflicts on the unique
 * `message_id` index. Returns the persisted view.
 */
export async function upsertTranscript(
  input: UpsertTranscriptInput,
): Promise<TranscriptView> {
  if (!input.messageId || !input.messageId.trim()) {
    throw new TranscriptError("messageId is required");
  }
  if (!input.text || !input.text.trim()) {
    throw new TranscriptError("text is required and non-empty");
  }
  if (!input.model || !input.model.trim()) {
    throw new TranscriptError("model is required");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transcripts")
    .upsert(
      {
        message_id: input.messageId,
        text: input.text,
        language: input.language ?? null,
        confidence: input.confidence ?? null,
        model: input.model,
      },
      { onConflict: "message_id" },
    )
    .select("id, message_id, text, language, confidence, model, created_at")
    .single();

  if (error) {
    throw new TranscriptError(`upsert failed: ${error.message}`, error);
  }
  if (!data) {
    throw new TranscriptError("upsert returned no row");
  }
  return toView(data as TranscriptRow);
}

/**
 * Fetch the transcript for a message, or `null` if none exists yet.
 * Used by workers as a short-circuit (skip if transcript already present)
 * and by the history UI.
 */
export async function getTranscript(
  messageId: string,
): Promise<TranscriptView | null> {
  if (!messageId || !messageId.trim()) {
    throw new TranscriptError("messageId is required");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("transcripts")
    .select("id, message_id, text, language, confidence, model, created_at")
    .eq("message_id", messageId)
    .maybeSingle();

  if (error) {
    throw new TranscriptError(`getTranscript failed: ${error.message}`, error);
  }
  if (!data) return null;
  return toView(data as TranscriptRow);
}
