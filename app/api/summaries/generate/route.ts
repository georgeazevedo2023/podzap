/**
 * POST /api/summaries/generate
 *
 * Kicks off a background summary generation run. The actual Gemini call
 * is deferred to an Inngest worker (`inngest/functions/generate-summary.ts`)
 * because it routinely takes 10-30s — far too long to block a request.
 *
 * Body (todos opcionais exceto groupId — preenche do grupo quando ausente):
 *   {
 *     groupId,
 *     periodStart?,    // ISO timestamp (com offset)
 *     periodEnd?,      // ISO timestamp (com offset)
 *     period?,         // "24h" | "7d" — atalho pra calcular start/end
 *     tone?,           // override; senão usa group.default_tone
 *     voiceMode?,      // override; senão usa group.default_voice_mode
 *   }
 *
 * Caminhos:
 *   - "1-click gerar" do GroupCard manda só { groupId } e a API resolve
 *     tudo do grupo. Foi a feature que essa API ganhou na Fase A do
 *     mobile-first follow-up.
 *   - GenerateNowModal continua mandando todos os campos quando o usuário
 *     quer override explícito.
 *
 * Reply: `202 { ok: true, dispatched: true }`
 *
 * Rate limited to 10/hour/tenant. Gemini 2.5 Pro runs cost $0.005-0.02 a
 * pop and most user-facing flows only need one summary at a time; the
 * ceiling protects against a UI bug or a runaway script.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { inngest } from "@/inngest/client";
import { summaryRequested } from "@/inngest/events";
import { getGroup } from "@/lib/groups/service";
import {
  applyRateLimit,
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 3_600_000; // 1h

const GenerateBodySchema = z.object({
  groupId: z.string().uuid(),
  periodStart: z.string().datetime({ offset: true }).optional(),
  periodEnd: z.string().datetime({ offset: true }).optional(),
  period: z.enum(["24h", "7d"]).optional(),
  tone: z.enum(["formal", "fun", "corporate"]).optional(),
  voiceMode: z.enum(["single", "duo"]).optional(),
  templateId: z
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
  host1Name: z.string().min(1).max(60).optional(),
  host2Name: z.string().min(1).max(60).optional(),
});

function periodToHours(p: "24h" | "7d"): number {
  return p === "7d" ? 24 * 7 : 24;
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const limited = applyRateLimit(
    tenant.id,
    "summary-generate",
    RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) return limited;

  const raw = await readJsonBody<unknown>(req);
  const parsed = GenerateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  const body = parsed.data;

  let group;
  try {
    group = await getGroup(tenant.id, body.groupId);
  } catch (err) {
    return mapErrorToResponse(err);
  }
  if (!group) {
    return errorResponse(
      404,
      "NOT_FOUND",
      "Grupo não encontrado para este tenant.",
    );
  }

  // Resolve period: explicit start/end > period shortcut > group default.
  let periodStart: string;
  let periodEnd: string;
  if (body.periodStart && body.periodEnd) {
    if (new Date(body.periodEnd) <= new Date(body.periodStart)) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "periodEnd must be after periodStart.",
      );
    }
    periodStart = body.periodStart;
    periodEnd = body.periodEnd;
  } else {
    const shortcut = body.period ?? group.defaultPeriod;
    const hours = periodToHours(shortcut);
    const now = new Date();
    periodEnd = now.toISOString();
    periodStart = new Date(now.getTime() - hours * 3_600_000).toISOString();
  }

  const tone = body.tone ?? group.defaultTone;
  const voiceMode = body.voiceMode ?? group.defaultVoiceMode;
  const templateId = body.templateId ?? group.promptTemplateId;
  const host1Name = body.host1Name ?? group.host1Name;
  const host2Name = body.host2Name ?? group.host2Name;

  try {
    await inngest.send(
      summaryRequested.create({
        tenantId: tenant.id,
        groupId: group.id,
        periodStart,
        periodEnd,
        tone,
        voiceMode,
        templateId,
        host1Name,
        host2Name,
      }),
    );
    return NextResponse.json(
      { ok: true, dispatched: true },
      { status: 202 },
    );
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
