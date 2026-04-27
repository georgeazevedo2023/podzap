/**
 * POST /api/groups/[id]/duplicate-config
 *
 * Copia config (template/hosts/defaults/promptOverride) do grupo source
 * pra uma lista de targets. Tenant-scoped, atômico — se um target não
 * pertencer ao tenant, falha sem aplicar nada.
 *
 * Body:
 *   { targetGroupIds: string[] }   // 1..50 grupos
 *
 * Reply: `200 { updated: number }`
 *
 * Decisão de design: NÃO retornar a view atualizada de cada target —
 * cliente faz `router.refresh()` que reidrata o /groups via server
 * component. Evita payload gigante quando duplica pra 30 grupos.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { duplicateGroupConfig } from "@/lib/groups/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../../whatsapp/_shared";

const BodySchema = z.object({
  targetGroupIds: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id: sourceId } = await ctx.params;
  if (!sourceId) {
    return errorResponse(400, "VALIDATION_ERROR", "Missing source group id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const result = await duplicateGroupConfig(
      tenant.id,
      sourceId,
      parsed.data.targetGroupIds,
    );
    return NextResponse.json(result);
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
