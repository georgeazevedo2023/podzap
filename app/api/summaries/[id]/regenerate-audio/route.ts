/**
 * POST /api/summaries/[id]/regenerate-audio
 *
 * Editor de transcrição do /podcasts: salva o texto revisado de um
 * summary JÁ APROVADO, apaga o áudio antigo (Storage + row) e reemite
 * `summary.approved` pro worker `generate-tts` gerar o áudio de novo.
 *
 * O clique em "salvar e gerar áudio" é a reaprovação humana do texto.
 * Aprovar ≠ enviar: nada é mandado ao grupo — o novo áudio aparece no
 * card e a entrega continua exigindo o SendToMenu.
 *
 * Body: `{ text: string }`
 * Reply: `200 { summary: SummaryView }`
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { summaryApproved } from "@/inngest/events";
import { deleteAudioForSummary } from "@/lib/audios/service";
import { reviseApprovedSummaryText } from "@/lib/summaries/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

const BodySchema = z.object({
  text: z.string().min(1, "text is required"),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return errorResponse(400, "VALIDATION_ERROR", "`id` must be a UUID.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid body.",
    );
  }

  try {
    const summary = await reviseApprovedSummaryText(
      tenant.id,
      id,
      parsed.data.text,
    );
    await deleteAudioForSummary(tenant.id, id);
    await inngest.send(
      summaryApproved.create({ summaryId: summary.id, tenantId: tenant.id }),
    );
    return NextResponse.json({ summary });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
