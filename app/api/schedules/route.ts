/**
 * GET /api/schedules
 *
 * Lists every schedule for the current tenant, newest first.
 *
 * Reply: `200 { schedules: ScheduleView[] }`
 *
 * ────────────────────────────────────────────────────────────────────
 *
 * POST /api/schedules
 *
 * Creates a schedule for one of the tenant's groups. The `schedules`
 * table enforces one schedule per `group_id`; duplicates surface as
 * `SchedulesError('CONFLICT')` → 409. Cross-tenant group ids surface
 * as `SchedulesError('VALIDATION_ERROR')` → 400.
 *
 * Body (zod-validated):
 *   { groupId, frequency, timeOfDay, dayOfWeek?, triggerType,
 *     approvalMode, voice?, tone, isActive }
 *
 * Reply: `201 { schedule: ScheduleView }`
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { createSchedule, listSchedules } from "@/lib/schedules/service";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../whatsapp/_shared";

// `time_of_day` in Postgres is stored tz-less; we accept HH:MM or HH:MM:SS
// to match what the DB will round-trip.
const TimeOfDaySchema = z
  .string()
  .regex(
    /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
    "timeOfDay must be HH:MM or HH:MM:SS",
  );

const CreateBodySchema = z.object({
  groupId: z.string().uuid(),
  frequency: z.enum(["daily", "weekly", "custom"]),
  timeOfDay: TimeOfDaySchema.nullable(),
  dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
  triggerType: z.enum(["fixed_time", "inactivity", "dynamic_window"]),
  approvalMode: z.enum(["auto", "optional", "required"]),
  voice: z.string().min(1).nullable().optional(),
  tone: z.enum(["formal", "fun", "corporate"]),
  isActive: z.boolean(),
});

export async function GET() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  try {
    const schedules = await listSchedules(tenant.id);
    return NextResponse.json({ schedules });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const raw = await readJsonBody<unknown>(req);
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "Invalid request body.",
      { issues: parsed.error.issues },
    );
  }

  const body = parsed.data;

  try {
    const schedule = await createSchedule({
      tenantId: tenant.id,
      groupId: body.groupId,
      frequency: body.frequency,
      timeOfDay: body.timeOfDay,
      dayOfWeek: body.dayOfWeek ?? null,
      triggerType: body.triggerType,
      approvalMode: body.approvalMode,
      voice: body.voice ?? null,
      tone: body.tone,
      isActive: body.isActive,
    });
    return NextResponse.json({ schedule }, { status: 201 });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
