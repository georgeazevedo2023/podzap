/**
 * `lib/profile/phone.ts`
 *
 * Per-tenant-member phone number storage + validation. Used by the
 * "mandar pro meu WhatsApp" destination option in HeroPlayer +
 * RedeliverButton — the admin saves their own E.164 phone once in
 * the profile, then every podcast can target it without re-asking.
 *
 * Data lives in `tenant_members.phone_e164` (nullable, CHECK for
 * E.164 format, migration 0012). We deliberately don't use
 * `auth.users.phone` because (a) the Supabase auth column has its
 * own semantics (SMS verification etc.) we don't want to interact
 * with, and (b) users can have different phones per tenant
 * membership.
 *
 * All reads/writes scope by `(user_id, tenant_id)` so a user can't
 * accidentally set their phone for a different tenant.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ──────────────────────────────────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────────────────────────────────

export type PhoneErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "DB_ERROR";

export class PhoneError extends Error {
  constructor(
    public code: PhoneErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "PhoneError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

const E164_RE = /^\+[1-9][0-9]{7,14}$/;

/**
 * Accepts common Brazilian input formats and normalises to E.164:
 *   "(11) 99999-9999"        → "+5511999999999"
 *   "11 99999-9999"          → "+5511999999999"
 *   "+55 11 99999-9999"      → "+5511999999999"
 *   "5511999999999"          → "+5511999999999"
 *   "+5511999999999"         → "+5511999999999" (unchanged)
 *
 * Returns null when the input can't be interpreted. Caller maps null
 * to `VALIDATION_ERROR`.
 *
 * Heuristic: strip all non-digits. If length is 10 or 11, prepend +55.
 * If length is 12 or 13 and starts with "55", prepend +. Otherwise
 * require the original to already have a `+` so the caller intended
 * an international number.
 */
export function normalizePhoneBR(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  let candidate: string;
  if (digits.length === 10 || digits.length === 11) {
    // Local BR without DDD expanded: DDD + number → assume Brazil.
    candidate = `+55${digits}`;
  } else if (
    (digits.length === 12 || digits.length === 13) &&
    digits.startsWith("55")
  ) {
    candidate = `+${digits}`;
  } else if (hadPlus) {
    candidate = `+${digits}`;
  } else {
    return null;
  }

  return E164_RE.test(candidate) ? candidate : null;
}

/**
 * Compose a WhatsApp personal JID from an E.164 phone. UAZAPI accepts
 * both `<digits>@s.whatsapp.net` and bare `<digits>`; we go explicit.
 */
export function phoneToWhatsappJid(e164: string): string {
  // strip the leading '+'; UAZAPI expects digits only in the JID local part.
  const digits = e164.replace(/^\+/, "");
  return `${digits}@s.whatsapp.net`;
}

// ──────────────────────────────────────────────────────────────────────────
//  Service
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fetch the current user's phone for this tenant. Returns `null` when
 * no phone has been set yet. Throws `PhoneError('NOT_FOUND')` only when
 * the membership row itself is missing (which shouldn't happen for
 * authenticated users that hit this endpoint).
 */
export async function getMemberPhone(
  tenantId: string,
  userId: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_members")
    .select("phone_e164")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new PhoneError(
      "DB_ERROR",
      `Failed to load phone for tenant ${tenantId}, user ${userId}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new PhoneError(
      "NOT_FOUND",
      `No tenant_members row for user ${userId} in tenant ${tenantId}`,
    );
  }
  return data.phone_e164 ?? null;
}

/**
 * Set (or clear, when `phone=null`) the current user's phone for this
 * tenant. Validates via `normalizePhoneBR` — invalid input raises
 * `VALIDATION_ERROR` so the caller can return 400.
 */
export async function setMemberPhone(
  tenantId: string,
  userId: string,
  phone: string | null,
): Promise<string | null> {
  let normalized: string | null = null;
  if (phone !== null && phone !== "") {
    normalized = normalizePhoneBR(phone);
    if (!normalized) {
      throw new PhoneError(
        "VALIDATION_ERROR",
        "Telefone inválido. Formato esperado: E.164 (+5511999999999).",
      );
    }
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tenant_members")
    .update({ phone_e164: normalized })
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .select("phone_e164")
    .maybeSingle();

  if (error) {
    throw new PhoneError(
      "DB_ERROR",
      `Failed to update phone for tenant ${tenantId}, user ${userId}: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new PhoneError(
      "NOT_FOUND",
      `No tenant_members row for user ${userId} in tenant ${tenantId}`,
    );
  }
  return data.phone_e164 ?? null;
}
