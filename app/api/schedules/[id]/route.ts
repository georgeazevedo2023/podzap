/**
 * GET /api/schedules/[id]
 *
 * Fetches a single schedule by id, tenant-scoped. Missing or cross-tenant
 * rows return 404 — we never leak existence to the caller.
 *
 * Reply: `200 { schedule: ScheduleView }`
 *
 * ────────────────────────────────────────────────────────────────────
 *
 * PATCH /api/schedules/[id]
 *
 * Partial update. Any subset of the mutable fields may be provided; the
 * service layer only touches what's in the payload. `id`, `tenantId`,
 * `createdAt`, and `updatedAt` are read-only and cannot be patched.
 *
 * Body (zod, all optional):
 *   { groupId?, frequency?, timeOfDay?, dayOfWeek?, triggerType?,
 *     approvalMode?, voice?, tone?, isActive? }
 *
 * Reply: `200 { schedule: ScheduleView }`
 *
 * ────────────────────────────────────────────────────────────────────
 *
 * DELETE /api/schedules/[id]
 *
 * Removes the schedule. 204 on success; 404 if missing / cross-tenant.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteSchedule,
  getSchedule,
  updateSchedule,
} from "@/lib/schedules/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

const TimeOfDaySchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    "timeOfDay must be HH:MM or HH:MM:SS",
  );

// Partial of ScheduleView without id/tenantId/createdAt/updatedAt. We use
// a shape object (not `.partial()` on the POST schema) because several
// fields here are nullable-but-optional — the distinction matters for the
// service's `patch[key] !== undefined` check.
const PatchBodySchema = z
  .object({
    groupId: z.string().uuid().optional(),
    frequency: z.enum(["daily", "weekly", "custom"]).optional(),
    timeOfDay: TimeOfDaySchema.nullable().optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    triggerType: z
      .enum(["fixed_time", "inactivity", "dynamic_window"])
      .optional(),
    approvalMode: z.enum(["auto", "optional", "required"]).optional(),
    voice: z.string().min(1).nullable().optional(),
    tone: z.enum(["formal", "fun", "corporate"]).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing schedule id.");
  }

  try {
    const schedule = await getSchedule(tenant.id, id);
    if (!schedule) {
      return errorResponse(404, "NOT_FOUND", "Schedule not found.");
    }
    return NextResponse.json({ schedule });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing schedule id.");
  }

  const raw = await readJsonBody<unknown>(req);
  const parsed = PatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  try {
    const schedule = await updateSchedule(tenant.id, id, parsed.data);
    return NextResponse.json({ schedule });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const { id } = await ctx.params;
  if (!id || typeof id !== "string") {
    return errorResponse(400, "VALIDATION_ERROR", "Missing schedule id.");
  }

  try {
    await deleteSchedule(tenant.id, id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
