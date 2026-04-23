/**
 * Schedules service — Fase 11 foundations.
 *
 * This module owns the `schedules` table. One schedule per group (enforced
 * at the DB level by a UNIQUE constraint on `group_id`). Schedules are
 * consumed by the Inngest cron worker `inngest/functions/run-schedules.ts`
 * which fires every 5 minutes, calls {@link dueSchedulesNow}, and fans out
 * `summary.requested` events for every schedule that matches the current
 * wall-clock window.
 *
 * Design notes:
 *
 *   - Uses the admin client across the board. The background worker path
 *     is unauthenticated, and the CRUD routes (Agente A2) already resolve
 *     the authenticated tenant before calling in — we still WHERE-scope
 *     every query by `tenant_id` for defence-in-depth.
 *
 *   - `dueSchedulesNow(now, windowMinutes=5)` uses America/Sao_Paulo as
 *     the canonical timezone for `time_of_day` / `day_of_week`. The
 *     schedules schema stores times without a tz; the PRD (Fase 11 plan,
 *     "Riscos") documents this assumption explicitly. When the worker
 *     ticks every 5 min the window must be >= the cron cadence so a
 *     schedule at 18:00 doesn't get missed by a tick that lands at
 *     18:00:03 vs 17:59:58.
 *
 *   - `createSchedule` validates `groupId` belongs to the same tenant
 *     before the insert. The DB has no `(tenant_id, group_id)` FK (only
 *     `group_id → groups.id`), so a malicious caller could theoretically
 *     slip in a cross-tenant group id — the explicit check closes that.
 *     The `group_id` UNIQUE constraint handles the one-schedule-per-group
 *     rule; we map that error to `CONFLICT`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type ScheduleFrequency = Database["public"]["Enums"]["schedule_frequency"];
export type ScheduleTriggerType = Database["public"]["Enums"]["schedule_trigger_type"];
export type ScheduleApprovalMode = Database["public"]["Enums"]["schedule_approval_mode"];
export type SummaryTone = Database["public"]["Enums"]["summary_tone"];

export type ScheduleView = {
  id: string;
  tenantId: string;
  groupId: string;
  frequency: ScheduleFrequency;
  timeOfDay: string | null; // HH:MM:SS (no tz)
  dayOfWeek: number | null; // 0-6 (Sun-Sat) for weekly
  triggerType: ScheduleTriggerType;
  approvalMode: ScheduleApprovalMode;
  voice: string | null;
  tone: SummaryTone;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SchedulesErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "DB_ERROR";

export class SchedulesError extends Error {
  constructor(
    public code: SchedulesErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SchedulesError";
  }
}

type ScheduleRow = Database["public"]["Tables"]["schedules"]["Row"];

function rowToView(row: ScheduleRow): ScheduleView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    groupId: row.group_id,
    frequency: row.frequency,
    timeOfDay: row.time_of_day ?? null,
    dayOfWeek: row.day_of_week ?? null,
    triggerType: row.trigger_type,
    approvalMode: row.approval_mode,
    voice: row.voice ?? null,
    tone: row.tone,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Reads
// ──────────────────────────────────────────────────────────────────────────

/**
 * List every schedule for a tenant, newest first.
 */
export async function listSchedules(
  tenantId: string,
): Promise<ScheduleView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to list schedules: ${error.message}`,
      error,
    );
  }
  return ((data ?? []) as ScheduleRow[]).map(rowToView);
}

/**
 * Fetch a single schedule by id, scoped to the tenant. Returns `null`
 * when the row doesn't exist or belongs to a different tenant — callers
 * map `null` to HTTP 404.
 */
export async function getSchedule(
  tenantId: string,
  id: string,
): Promise<ScheduleView | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to load schedule: ${error.message}`,
      error,
    );
  }
  if (!data) return null;
  return rowToView(data as ScheduleRow);
}

// ──────────────────────────────────────────────────────────────────────────
//  Writes
// ──────────────────────────────────────────────────────────────────────────

type CreateScheduleInput = Omit<
  ScheduleView,
  "id" | "createdAt" | "updatedAt"
>;

/**
 * Verify the group belongs to the tenant. Returns true if so, false
 * otherwise (group missing or cross-tenant). Used by {@link createSchedule}
 * to avoid the DB-level FK silently anchoring a schedule to a group that
 * the caller doesn't actually own.
 */
async function groupBelongsToTenant(
  tenantId: string,
  groupId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("groups")
    .select("id")
    .eq("id", groupId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to validate group ownership: ${error.message}`,
      error,
    );
  }
  return data !== null;
}

/**
 * Create a schedule for a group. The `group_id` column has a UNIQUE
 * constraint so duplicate-per-group inserts raise Postgres error 23505 —
 * we surface that as `CONFLICT`. Cross-tenant group ids surface as
 * `VALIDATION_ERROR` before hitting the DB.
 */
export async function createSchedule(
  input: CreateScheduleInput,
): Promise<ScheduleView> {
  if (!(await groupBelongsToTenant(input.tenantId, input.groupId))) {
    throw new SchedulesError(
      "VALIDATION_ERROR",
      `Group ${input.groupId} does not belong to tenant ${input.tenantId}`,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .insert({
      tenant_id: input.tenantId,
      group_id: input.groupId,
      frequency: input.frequency,
      time_of_day: input.timeOfDay,
      day_of_week: input.dayOfWeek,
      trigger_type: input.triggerType,
      approval_mode: input.approvalMode,
      voice: input.voice,
      tone: input.tone,
      is_active: input.isActive,
    })
    .select("*")
    .maybeSingle();

  if (error) {
    // Postgres unique_violation — Supabase propagates `code: '23505'`.
    if ((error as { code?: string }).code === "23505") {
      throw new SchedulesError(
        "CONFLICT",
        `A schedule already exists for group ${input.groupId}`,
        error,
      );
    }
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to create schedule: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new SchedulesError(
      "DB_ERROR",
      "Insert returned no row",
    );
  }
  return rowToView(data as ScheduleRow);
}

type UpdateSchedulePatch = Partial<
  Omit<ScheduleView, "id" | "tenantId" | "createdAt" | "updatedAt">
>;

/**
 * Patch-update a schedule. Only the provided fields are touched; the
 * `tenant_id` / `group_id` scope is preserved. Returns the updated view
 * (with `updated_at` bumped by the trigger).
 */
export async function updateSchedule(
  tenantId: string,
  id: string,
  patch: UpdateSchedulePatch,
): Promise<ScheduleView> {
  const dbPatch: Database["public"]["Tables"]["schedules"]["Update"] = {};
  if (patch.frequency !== undefined) dbPatch.frequency = patch.frequency;
  if (patch.timeOfDay !== undefined) dbPatch.time_of_day = patch.timeOfDay;
  if (patch.dayOfWeek !== undefined) dbPatch.day_of_week = patch.dayOfWeek;
  if (patch.triggerType !== undefined) dbPatch.trigger_type = patch.triggerType;
  if (patch.approvalMode !== undefined)
    dbPatch.approval_mode = patch.approvalMode;
  if (patch.voice !== undefined) dbPatch.voice = patch.voice;
  if (patch.tone !== undefined) dbPatch.tone = patch.tone;
  if (patch.isActive !== undefined) dbPatch.is_active = patch.isActive;
  if (patch.groupId !== undefined) dbPatch.group_id = patch.groupId;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .update(dbPatch)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to update schedule ${id}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new SchedulesError(
      "NOT_FOUND",
      `Schedule ${id} not found for tenant ${tenantId}`,
    );
  }
  return rowToView(data as ScheduleRow);
}

/**
 * Delete a schedule. NOT_FOUND if the row is missing or cross-tenant.
 */
export async function deleteSchedule(
  tenantId: string,
  id: string,
): Promise<void> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .select("id")
    .maybeSingle();
  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to delete schedule ${id}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new SchedulesError(
      "NOT_FOUND",
      `Schedule ${id} not found for tenant ${tenantId}`,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Cron query — due-now lookup
// ──────────────────────────────────────────────────────────────────────────

/** Parse "HH:MM:SS" (or "HH:MM") to total minutes-of-day. Returns null on malformed input. */
function timeStringToMinutes(value: string | null): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (
    Number.isNaN(hh) ||
    Number.isNaN(mm) ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return null;
  }
  return hh * 60 + mm;
}

/**
 * Convert a UTC `Date` to the wall-clock minutes-of-day + day-of-week
 * **in America/Sao_Paulo**. We use `Intl.DateTimeFormat` rather than
 * shipping a tz library — it's in the Node runtime, stable, and matches
 * what Supabase returns when the UI renders `time_of_day` to users.
 *
 * Returns `{ minutes, dayOfWeek }` where `dayOfWeek` is 0 (Sun) - 6 (Sat).
 */
function nowInSaoPaulo(now: Date): { minutes: number; dayOfWeek: number } {
  // `en-US` gives a predictable "Mon, 04/22/2026, 14:35:02" shape regardless
  // of the host locale.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let weekday = "Sun";
  for (const p of parts) {
    if (p.type === "hour") hour = Number(p.value);
    else if (p.type === "minute") minute = Number(p.value);
    else if (p.type === "weekday") weekday = p.value;
  }
  // Intl can emit "24" for midnight in some locales; normalise.
  if (hour === 24) hour = 0;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = weekdayMap[weekday] ?? 0;
  return { minutes: hour * 60 + minute, dayOfWeek };
}

/**
 * Return every active schedule whose `time_of_day` falls within
 * `[now - windowMinutes, now]` (America/Sao_Paulo). `frequency='weekly'`
 * schedules additionally require `day_of_week` to match the current
 * day.
 *
 * Windowing semantics:
 *   - The cron cadence is `*\/5 * * * *`, so `windowMinutes=5` (default)
 *     guarantees that a schedule at 18:00 gets picked up by the 18:00
 *     tick (matches minute 900..900) AND by the 17:55 tick only if the
 *     latter lands exactly on 17:55 — which it does. We bias "now" to
 *     the tail so we don't double-fire at the ceiling.
 *   - "within window" means `scheduleMinutes > (now - window)` AND
 *     `scheduleMinutes <= now`. Inclusive on the top, exclusive at the
 *     bottom, so adjacent ticks don't both pick up the same schedule.
 */
export async function dueSchedulesNow(
  now: Date,
  windowMinutes: number = 5,
): Promise<ScheduleView[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("schedules")
    .select("*")
    .eq("is_active", true);
  if (error) {
    throw new SchedulesError(
      "DB_ERROR",
      `Failed to load active schedules: ${error.message}`,
      error,
    );
  }

  const { minutes: nowMinutes, dayOfWeek: nowDow } = nowInSaoPaulo(now);
  const windowStart = nowMinutes - windowMinutes;

  const rows = (data ?? []) as ScheduleRow[];
  const due: ScheduleRow[] = [];
  for (const row of rows) {
    // Only `fixed_time` is currently matched against the clock. The other
    // trigger types are reserved for future phases (inactivity,
    // dynamic_window) and are intentionally skipped here.
    if (row.trigger_type !== "fixed_time") continue;

    const schedMinutes = timeStringToMinutes(row.time_of_day);
    if (schedMinutes === null) continue;

    const inWindow =
      schedMinutes > windowStart && schedMinutes <= nowMinutes;
    if (!inWindow) continue;

    if (row.frequency === "weekly") {
      if (row.day_of_week === null || row.day_of_week !== nowDow) continue;
    } else if (row.frequency === "daily") {
      // no extra gating
    } else {
      // `custom` frequency is not yet implemented — skip for now rather
      // than firing unpredictably.
      continue;
    }

    due.push(row);
  }

  return due.map(rowToView);
}
