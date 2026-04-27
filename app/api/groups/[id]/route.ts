/**
 * PATCH /api/groups/[id]
 *
 * Atualiza settings do grupo (defaults Fase A + template/hosts Fase B+C).
 * Tenant-scoped via `requireAuth`. Cada campo é opcional — só os passados
 * são gravados (patch parcial).
 *
 * Body:
 *   {
 *     defaultTone?:        "formal" | "fun" | "corporate";
 *     defaultVoiceMode?:   "single" | "duo";
 *     defaultPeriod?:      "24h" | "7d";
 *     promptTemplateId?:   "default-duo" | "default-solo" | "divertido"
 *                          | "informativo" | "fofoca" | "esportivo"
 *                          | "rapido";
 *     host1Name?:          string (1-60 chars);
 *     host2Name?:          string (1-60 chars);
 *   }
 *
 * Reply: `200 { group: GroupView }` com a row pós-update.
 *
 * NOT_FOUND surge como 404 quando o grupo é de outro tenant ou não existe
 * — não distinguimos pra não vazar existência cross-tenant.
 *
 * `is_monitored` continua sendo mexido só via POST /monitor pra manter o
 * fluxo do toggle no card auditável separadamente.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { updateGroupSettings } from "@/lib/groups/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

const PatchSchema = z.object({
  defaultTone: z.enum(["formal", "fun", "corporate"]).optional(),
  defaultVoiceMode: z.enum(["single", "duo"]).optional(),
  defaultPeriod: z.enum(["24h", "7d"]).optional(),
  promptTemplateId: z
    .enum([
      "default-duo",
      "default-solo",
      "divertido",
      "informativo",
      "fofoca",
      "esportivo",
      "rapido",
    ])
    .optional(),
  host1Name: z.string().trim().min(1).max(60).optional(),
  host2Name: z.string().trim().min(1).max(60).optional(),
  promptOverride: z
    .union([z.string().min(100).max(6000), z.null()])
    .optional(),
  voice1Id: z
    .enum(['Kore', 'Leda', 'Sadachbia', 'Aoede', 'Charon', 'Puck', 'Orus', 'Fenrir'])
    .optional(),
  voice2Id: z
    .enum(['Kore', 'Leda', 'Sadachbia', 'Aoede', 'Charon', 'Puck', 'Orus', 'Fenrir'])
    .optional(),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing group id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const group = await updateGroupSettings(tenant.id, id, parsed.data);
    return NextResponse.json({ group });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
