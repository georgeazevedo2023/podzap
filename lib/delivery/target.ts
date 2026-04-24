/**
 * `lib/delivery/target.ts`
 *
 * Resolve a destination choice from the UI into the concrete UAZAPI
 * JID string that `lib/uazapi/client.ts#sendAudio` expects.
 *
 * Four targets (matches the HeroPlayer dropdown):
 *   - `listen`  → UI-side only, never reaches this module.
 *   - `group`   → use the source group's JID (stored in `groups.uazapi_group_jid`).
 *   - `me`      → use the current user's `tenant_members.phone_e164` →
 *                 `<digits>@s.whatsapp.net`.
 *   - `contact` → use a user-typed phone (E.164 normalisation via
 *                 `normalizePhoneBR`, then `<digits>@s.whatsapp.net`).
 *
 * Kept separate from `delivery/service.ts` so unit tests can exercise
 * resolution without mocking Storage / UAZAPI.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getMemberPhone,
  normalizePhoneBR,
  phoneToWhatsappJid,
  PhoneError,
} from "@/lib/profile/phone";

export type DeliveryTarget = "group" | "me" | "contact";

export type TargetResolutionErrorCode =
  | "PHONE_NOT_SET"
  | "INVALID_CONTACT"
  | "GROUP_NOT_FOUND"
  | "DB_ERROR";

export class TargetResolutionError extends Error {
  constructor(
    public code: TargetResolutionErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "TargetResolutionError";
  }
}

export type ResolveTargetInput = {
  tenantId: string;
  userId: string;
  target: DeliveryTarget;
  /** Required when `target === 'contact'`. */
  contactPhone?: string;
  /** Required when `target === 'group'` — we read the JID from here. */
  groupId?: string;
};

/**
 * Map a UI destination choice to a concrete UAZAPI JID string.
 *
 * Errors map 1:1 to user-facing HTTP codes:
 *   - `PHONE_NOT_SET`    → 400 "Cadastre seu WhatsApp no perfil"
 *   - `INVALID_CONTACT`  → 400 "Número inválido"
 *   - `GROUP_NOT_FOUND`  → 404 "Grupo não encontrado"
 *   - `DB_ERROR`         → 500
 */
export async function resolveTargetJid(
  input: ResolveTargetInput,
): Promise<string> {
  switch (input.target) {
    case "group":
      return resolveGroupJid(input.tenantId, input.groupId);
    case "me":
      return resolveMyPhoneJid(input.tenantId, input.userId);
    case "contact":
      return resolveContactJid(input.contactPhone);
    default: {
      // Exhaustiveness guard — if someone adds a new target the compiler
      // will force them to handle it here.
      const _never: never = input.target;
      throw new TargetResolutionError(
        "INVALID_CONTACT",
        `Unknown delivery target: ${String(_never)}`,
      );
    }
  }
}

async function resolveGroupJid(
  tenantId: string,
  groupId: string | undefined,
): Promise<string> {
  if (!groupId) {
    throw new TargetResolutionError(
      "GROUP_NOT_FOUND",
      "groupId is required when target='group'",
    );
  }
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("groups")
    .select("uazapi_group_jid")
    .eq("tenant_id", tenantId)
    .eq("id", groupId)
    .maybeSingle();
  if (error) {
    throw new TargetResolutionError(
      "DB_ERROR",
      `Failed to load group ${groupId}: ${error.message}`,
      error,
    );
  }
  if (!data?.uazapi_group_jid) {
    throw new TargetResolutionError(
      "GROUP_NOT_FOUND",
      `Group ${groupId} not found or missing JID`,
    );
  }
  return data.uazapi_group_jid;
}

async function resolveMyPhoneJid(
  tenantId: string,
  userId: string,
): Promise<string> {
  let phone: string | null;
  try {
    phone = await getMemberPhone(tenantId, userId);
  } catch (err) {
    if (err instanceof PhoneError) {
      throw new TargetResolutionError(
        "DB_ERROR",
        `Failed to load member phone: ${err.message}`,
        err,
      );
    }
    throw err;
  }
  if (!phone) {
    throw new TargetResolutionError(
      "PHONE_NOT_SET",
      "Cadastre seu WhatsApp no perfil antes de enviar pra você mesmo.",
    );
  }
  return phoneToWhatsappJid(phone);
}

function resolveContactJid(raw: string | undefined): string {
  if (!raw || !raw.trim()) {
    throw new TargetResolutionError(
      "INVALID_CONTACT",
      "Número do contato é obrigatório.",
    );
  }
  const e164 = normalizePhoneBR(raw);
  if (!e164) {
    throw new TargetResolutionError(
      "INVALID_CONTACT",
      "Número inválido. Ex.: +55 11 99999-9999 ou 11999999999.",
    );
  }
  return phoneToWhatsappJid(e164);
}
