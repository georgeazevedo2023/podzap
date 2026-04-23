/**
 * GET  /api/settings  → return the current tenant's delivery settings.
 * PATCH /api/settings → update `includeCaptionOnDelivery` and/or
 *                       `deliveryTarget`.
 *
 * Fase 10, lean scope: no separate settings table yet — the two knobs
 * live directly on `tenants` (see migration 0006_tenant_settings.sql).
 * Auth + tenant scoping reuse the same helpers as every other route.
 *
 * Reply shape:
 *   { settings: { includeCaptionOnDelivery: boolean; deliveryTarget: DeliveryTarget } }
 */

import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../whatsapp/_shared";

type DeliveryTarget = "group" | "owner_dm" | "both";

const VALID_TARGETS: readonly DeliveryTarget[] = ["group", "owner_dm", "both"];

type SettingsView = {
  includeCaptionOnDelivery: boolean;
  deliveryTarget: DeliveryTarget;
};

type PatchBody = {
  includeCaptionOnDelivery?: unknown;
  deliveryTarget?: unknown;
};

function rowToView(row: {
  include_caption_on_delivery: boolean | null;
  delivery_target: string | null;
}): SettingsView {
  const target = row.delivery_target;
  return {
    includeCaptionOnDelivery: row.include_caption_on_delivery ?? true,
    deliveryTarget:
      target === "owner_dm" || target === "both" || target === "group"
        ? target
        : "group",
  };
}

export async function GET() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .select("include_caption_on_delivery, delivery_target")
      .eq("id", tenant.id)
      .single();

    if (error || !data) {
      return errorResponse(
        404,
        "NOT_FOUND",
        `Tenant ${tenant.id} not found.`,
      );
    }

    return NextResponse.json({ settings: rowToView(data) });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant } = auth;

  const body = await readJsonBody<PatchBody>(req);

  const patch: {
    include_caption_on_delivery?: boolean;
    delivery_target?: DeliveryTarget;
  } = {};

  if (body.includeCaptionOnDelivery !== undefined) {
    if (typeof body.includeCaptionOnDelivery !== "boolean") {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        "`includeCaptionOnDelivery` must be a boolean.",
      );
    }
    patch.include_caption_on_delivery = body.includeCaptionOnDelivery;
  }

  if (body.deliveryTarget !== undefined) {
    if (
      typeof body.deliveryTarget !== "string" ||
      !(VALID_TARGETS as readonly string[]).includes(body.deliveryTarget)
    ) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        `\`deliveryTarget\` must be one of ${VALID_TARGETS.join(", ")}.`,
      );
    }
    patch.delivery_target = body.deliveryTarget as DeliveryTarget;
  }

  if (Object.keys(patch).length === 0) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "At least one of `includeCaptionOnDelivery` or `deliveryTarget` is required.",
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .update(patch)
      .eq("id", tenant.id)
      .select("include_caption_on_delivery, delivery_target")
      .single();

    if (error || !data) {
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        error?.message ?? "Failed to update tenant settings.",
      );
    }

    return NextResponse.json({ settings: rowToView(data) });
  } catch (err) {
    return mapErrorToResponse(err);
  }
}
