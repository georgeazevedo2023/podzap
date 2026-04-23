/**
 * GET /api/summaries/[id]/audio/signed-url
 *
 * Returns a short-lived signed URL the browser can use to play or download
 * the TTS audio generated for a given summary. Returns 404 when either:
 *   - the summary has no audio yet (worker still running, or TTS failed), or
 *   - the summary belongs to another tenant (we don't leak existence by
 *     distinguishing the two cases).
 *
 * Reply: `200 { url: string; expiresIn: number; audio: AudioView }`
 *
 * The UI polls this endpoint after approval until it flips from 404 → 200
 * (see Fase 9 plan, Agente 4).
 *
 * Note: this was moved from `/api/audios/[summaryId]/signed-url` to resolve
 * a Next.js dynamic-segment conflict (`[id]` vs `[summaryId]` under the same
 * parent). The semantics are cleaner too — this is about a summary's audio.
 */

import { NextResponse } from "next/server";

import { getAudioBySummary } from "@/lib/audios/service";
import { getSignedUrl } from "@/lib/media/signedUrl";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../../../whatsapp/_shared";

const EXPIRES_IN_SECONDS = 3600;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return errorResponse(400, "VALIDATION_ERROR", "`id` must be a UUID.");
  }

  try {
    const audio = await getAudioBySummary(tenant.id, id);
    if (!audio) {
      return errorResponse(404, "NOT_FOUND", "Audio not found for summary.");
    }

    const url = await getSignedUrl(audio.storagePath, {
      bucket: "audios",
      expiresInSeconds: EXPIRES_IN_SECONDS,
    });

    return NextResponse.json(
      { url, expiresIn: EXPIRES_IN_SECONDS, audio },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
