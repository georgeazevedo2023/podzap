/**
 * GET  /api/me/phone   → `{ phone: string | null }`
 * PATCH /api/me/phone  body: `{ phone: string | null }` → same shape
 *
 * Stores/reads the current tenant_member's WhatsApp phone (E.164).
 * Used by the destination picker in HeroPlayer + RedeliverButton to
 * offer "Enviar pro meu WhatsApp" as a target. `null` clears it.
 *
 * Validation + normalisation live in `lib/profile/phone.ts`. Invalid
 * input lands as `PhoneError('VALIDATION_ERROR')` → 400.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getMemberPhone,
  PhoneError,
  setMemberPhone,
} from "@/lib/profile/phone";
import {
  errorResponse,
  mapErrorToResponse,
  readJsonBody,
  requireAuth,
} from "../../whatsapp/_shared";

export async function GET() {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant, user } = auth;

  try {
    const phone = await getMemberPhone(tenant.id, user.id);
    return NextResponse.json({ phone });
  } catch (err) {
    return mapPhoneError(err);
  }
}

const PatchBodySchema = z.object({
  phone: z.string().nullable(),
});

export async function PATCH(req: Request) {
  const auth = await requireAuth();
  if ("response" in auth) return auth.response;
  const { tenant, user } = auth;

  const raw = await readJsonBody<unknown>(req);
  const parsed = PatchBodySchema.safeParse(raw);
  if (!parsed.success) {
    return errorResponse(400, "VALIDATION_ERROR", "Invalid body.", {
      issues: parsed.error.issues,
    });
  }

  try {
    const phone = await setMemberPhone(tenant.id, user.id, parsed.data.phone);
    return NextResponse.json({ phone });
  } catch (err) {
    return mapPhoneError(err);
  }
}

function mapPhoneError(err: unknown): Response {
  if (err instanceof PhoneError) {
    switch (err.code) {
      case "VALIDATION_ERROR":
        return errorResponse(400, "VALIDATION_ERROR", err.message);
      case "NOT_FOUND":
        return errorResponse(404, "NOT_FOUND", err.message);
      case "DB_ERROR":
      default:
        return errorResponse(500, "INTERNAL_ERROR", err.message);
    }
  }
  return mapErrorToResponse(err);
}
