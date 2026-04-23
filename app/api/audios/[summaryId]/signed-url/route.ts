/**
 * GET /api/audios/[summaryId]/signed-url
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
 */

import { NextResponse } from "next/server";

import { getAudioBySummary } from "@/lib/audios/service";
import { getSignedUrl } from "@/lib/media/signedUrl";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../../whatsapp/_shared";

const EXPIRES_IN_SECONDS = 3600;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ summaryId: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { summaryId } = await ctx.params;
  if (!summaryId || typeof summaryId !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing summary id.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(summaryId)) {
    return errorResponse(400, "VALIDATION_ERROR", "`summaryId` must be a UUID.");
  }

  try {
    const audio = await getAudioBySummary(tenant.id, summaryId);
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
