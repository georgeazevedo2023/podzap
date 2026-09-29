/**
 * GET /api/summaries/[id]/audio/mp3
 *
 * Download do episódio em MP3. O acervo fica em OGG/Opus no Storage
 * (menor, nativo do PTT do WhatsApp); aqui baixamos o objeto e
 * transcodamos sob demanda via ffmpeg (`transcodeToMp3`).
 *
 * Reply: `200 audio/mpeg` com `Content-Disposition: attachment`.
 */

import { downloadAudioBytes } from "@/lib/audios/service";
import { transcodeToMp3 } from "@/lib/audios/mix";
import { getSummary } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  requireAuth,
} from "../../../../whatsapp/_shared";

export const runtime = "nodejs";

/** "Time Campanha AC" → "time-campanha-ac" (seguro pra nome de arquivo). */
function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return errorResponse(400, "VALIDATION_ERROR", "`id` must be a UUID.");
  }

  try {
    const summary = await getSummary(tenant.id, id);
    if (!summary) {
      return errorResponse(404, "NOT_FOUND", "Summary not found.");
    }
    const { bytes } = await downloadAudioBytes(tenant.id, id);
    const mp3 = await transcodeToMp3(bytes);

    const group = slugify(summary.groupName ?? "grupo") || "grupo";
    const date = summary.periodEnd.slice(0, 10);
    const filename = `podzap-${group}-${date}.mp3`;

    return new Response(new Uint8Array(mp3), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
