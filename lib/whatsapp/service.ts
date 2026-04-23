/**
 * WhatsApp service layer — wraps the UAZAPI client with multi-tenant Supabase
 * persistence. This is the single contract used by API routes and Next.js
 * server components in Fase 2.
 *
 * Responsibilities:
 *   - Create / read / refresh / disconnect UAZAPI instances scoped to a
 *     tenant (tenant_id check is always enforced in the WHERE clause even
 *     when using the service-role admin client).
 *   - Encrypt the per-instance UAZAPI token at rest (`lib/crypto`).
 *   - Translate the UAZAPI status strings into our narrower runtime enum
 *     (`disconnected | connecting | connected`). QR/intermediate states
 *     collapse to `connecting` so the UI has a single "keep polling" branch.
 *   - Surface all failures via a typed `WhatsappError` so route handlers can
 *     branch cleanly (404 / 409 / 500).
 *
 * Uses the service-role admin client on purpose: these helpers run from
 * trusted server code (API routes, server components) that already resolved
 * the authenticated tenant via `getCurrentUserAndTenant`. Bypassing RLS here
 * lets us still select/update rows that the caller owns while keeping a
 * mandatory `tenant_id = $1` filter everywhere below — belt-and-suspenders.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt, CryptoError } from "@/lib/crypto";
import { UazapiClient, UazapiError } from "@/lib/uazapi/client";
import type { Database } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type InstanceStatus = "disconnected" | "connecting" | "connected";

export type InstanceView = {
  id: string;
  tenantId: string;
  uazapiInstanceId: string;
  status: InstanceStatus;
  phone: string | null;
  /** Base64 PNG WITHOUT the `data:image/png;base64,` prefix. */
  qrCodeBase64: string | null;
  lastSeenAt: string | null;
  connectedAt: string | null;
};

/**
 * Narrow error class so route handlers can `instanceof` and map to HTTP
 * status codes. `cause` preserves the original exception for logging.
 */
export class WhatsappError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "ALREADY_CONNECTED"
      | "UAZAPI_ERROR"
      | "ENCRYPTION_ERROR"
      | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "WhatsappError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

type InstanceRow = Database["public"]["Tables"]["whatsapp_instances"]["Row"];
type DbStatus = Database["public"]["Enums"]["whatsapp_instance_status"];

/**
 * Collapse the UAZAPI status string into our public 3-state enum.
 * Any intermediate/QR/unknown state is treated as `connecting` so the UI
 * can keep polling without a third explicit path.
 */
function normaliseStatus(raw: string | undefined | null): InstanceStatus {
  switch (raw) {
    case "connected":
      return "connected";
    case "disconnected":
      return "disconnected";
    case "connecting":
    case "qrcode":
    case "qr":
      return "connecting";
    default:
      return "disconnected";
  }
}

/** Our 3 public enum values are all valid DB enum values. */
function toDbStatus(s: InstanceStatus): DbStatus {
  return s;
}

/** Hydrate a DB row into the view returned to callers (never exposes the
 * encrypted token). */
function toView(
  row: InstanceRow,
  qrCodeBase64: string | null = null,
): InstanceView {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    uazapiInstanceId: row.uazapi_instance_id,
    status: normaliseStatus(row.status),
    phone: row.phone ?? null,
    qrCodeBase64,
    lastSeenAt: row.last_seen_at ?? null,
    connectedAt: row.connected_at ?? null,
  };
}

/**
 * Resolve the UAZAPI client at call time (not module load) so tests can
 * stub it via `vi.mock` and so env-missing errors surface at the first
 * actual call rather than at import.
 */
function getUazapiClient(): UazapiClient {
  const baseUrl = process.env.UAZAPI_BASE_URL ?? "https://wsmart.uazapi.com";
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN ?? "";
  return new UazapiClient(baseUrl, adminToken);
}

async function loadRow(
  tenantId: string,
  instanceId: string,
): Promise<InstanceRow> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new WhatsappError(
      "DB_ERROR",
      `Failed to load instance: ${error.message}`,
      error,
    );
  }
  if (!data) {
    throw new WhatsappError(
      "NOT_FOUND",
      `WhatsApp instance ${instanceId} not found for tenant ${tenantId}`,
    );
  }
  return data as InstanceRow;
}

function decryptToken(row: InstanceRow): string {
  const cipher = row.uazapi_token_encrypted;
  if (!cipher) {
    throw new WhatsappError(
      "ENCRYPTION_ERROR",
      `Instance ${row.id} has no token stored (possibly already disconnected).`,
    );
  }
  try {
    return decrypt(cipher);
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new WhatsappError(
        "ENCRYPTION_ERROR",
        `Failed to decrypt instance token: ${err.message}`,
        err,
      );
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Return the most-recently-created instance row for a tenant, or null.
 * Multiple rows are possible historically; we only surface the latest.
 */
export async function getCurrentInstance(
  tenantId: string,
): Promise<InstanceView | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new WhatsappError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${error.message}`,
      error,
    );
  }
  const row = (data?.[0] ?? null) as InstanceRow | null;
  if (!row) return null;
  return toView(row);
}

/**
 * Allocate a new UAZAPI instance for a tenant.
 *
 * Refuses to create when an existing `connected` instance is already live,
 * to avoid the UX footgun of "scan QR again while already logged in". On
 * success the row is inserted with `status='connecting'`; the QR code is
 * fetched separately via `getQrCodeForInstance` so the caller can choose
 * when to render it.
 */
export async function createInstanceForTenant(
  tenantId: string,
  name?: string,
): Promise<InstanceView> {
  const existing = await getCurrentInstance(tenantId);
  if (existing && existing.status === "connected") {
    throw new WhatsappError(
      "ALREADY_CONNECTED",
      `Tenant ${tenantId} already has a connected WhatsApp instance (${existing.id}). Disconnect first.`,
    );
  }

  const client = getUazapiClient();
  const instanceName = name ?? defaultInstanceName(tenantId);

  let created;
  try {
    created = await client.createInstance(instanceName);
  } catch (err) {
    throw new WhatsappError(
      "UAZAPI_ERROR",
      `UAZAPI createInstance failed: ${(err as Error).message}`,
      err,
    );
  }

  if (!created?.id || !created?.token) {
    throw new WhatsappError(
      "UAZAPI_ERROR",
      "UAZAPI createInstance returned no id/token (shape changed?)",
      created,
    );
  }

  let tokenEncrypted: string;
  try {
    tokenEncrypted = encrypt(created.token);
  } catch (err) {
    throw new WhatsappError(
      "ENCRYPTION_ERROR",
      `Failed to encrypt UAZAPI token: ${(err as Error).message}`,
      err,
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("whatsapp_instances")
    .insert({
      tenant_id: tenantId,
      uazapi_instance_id: created.id,
      uazapi_token_encrypted: tokenEncrypted,
      status: "connecting",
      phone: null,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new WhatsappError(
      "DB_ERROR",
      `Failed to insert whatsapp_instances row: ${error?.message ?? "unknown"}`,
      error,
    );
  }

  return toView(data as InstanceRow);
}

/**
 * Poll UAZAPI for the current status and persist the result. Sets
 * `connected_at` only on the first transition to `connected` — once set it
 * is never cleared here (cleared on disconnect via row deletion).
 */
export async function refreshInstanceStatus(
  tenantId: string,
  instanceId: string,
): Promise<InstanceView> {
  const row = await loadRow(tenantId, instanceId);
  const token = decryptToken(row);
  const client = getUazapiClient();

  let uazapiStatus: string;
  try {
    uazapiStatus = await client.getInstanceStatus(token);
  } catch (err) {
    if (err instanceof UazapiError && err.status === 404) {
      // The instance is gone server-side. Mark as disconnected locally so
      // the UI can offer a reconnect CTA.
      uazapiStatus = "disconnected";
    } else {
      throw new WhatsappError(
        "UAZAPI_ERROR",
        `UAZAPI getInstanceStatus failed: ${(err as Error).message}`,
        err,
      );
    }
  }

  const newStatus = normaliseStatus(uazapiStatus);
  const shouldMarkConnectedAt =
    newStatus === "connected" && !row.connected_at;

  const supabase = createAdminClient();
  const patch: Database["public"]["Tables"]["whatsapp_instances"]["Update"] = {
    status: toDbStatus(newStatus),
    last_seen_at: new Date().toISOString(),
  };
  if (shouldMarkConnectedAt) patch.connected_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("whatsapp_instances")
    .update(patch)
    .eq("id", instanceId)
    .eq("tenant_id", tenantId)
    .select("*")
    .single();

  if (error || !data) {
    throw new WhatsappError(
      "DB_ERROR",
      `Failed to update whatsapp_instances: ${error?.message ?? "unknown"}`,
      error,
    );
  }

  return toView(data as InstanceRow);
}

/**
 * Fetch a fresh QR code for the UI to render. Once the instance has
 * transitioned to `connected`, returns `null` — exposing the QR after login
 * makes no sense and could confuse auto-refresh UIs.
 */
export async function getQrCodeForInstance(
  tenantId: string,
  instanceId: string,
): Promise<{ qrCodeBase64: string | null; status: InstanceStatus }> {
  const row = await loadRow(tenantId, instanceId);
  const token = decryptToken(row);
  const client = getUazapiClient();

  let qr;
  try {
    qr = await client.getQrCode(token);
  } catch (err) {
    throw new WhatsappError(
      "UAZAPI_ERROR",
      `UAZAPI getQrCode failed: ${(err as Error).message}`,
      err,
    );
  }

  const status = normaliseStatus(qr.status);
  if (status === "connected") {
    return { qrCodeBase64: null, status: "connected" };
  }
  return {
    qrCodeBase64: qr.qrCodeBase64 ? qr.qrCodeBase64 : null,
    status,
  };
}

/**
 * Disconnect an instance. DELETEs the DB row (rather than UPDATEing to
 * `disconnected`) because:
 *
 *   1. `groups.instance_id` has `on delete cascade` (migration 0001:128),
 *      so deleting the instance cascades away its groups/messages — which
 *      is what the user actually wants when they "disconnect": start fresh,
 *      not keep stale groups referencing a dead instance.
 *   2. The UNIQUE constraint is `(tenant_id, uazapi_instance_id)`, so a
 *      soft-deleted row would block re-creating with the same id on
 *      retry. DELETE sidesteps that edge.
 *   3. If the tenant re-connects, `createInstanceForTenant` makes a fresh
 *      row with a new uazapi_instance_id; there is no reason to reuse.
 *
 * UAZAPI server-side `DELETE /instance` is best-effort: if it returns 404
 * (already removed), we swallow and proceed with local deletion. If the
 * stored token can't be decrypted (rotated key / corruption) we still
 * delete the local row — the UAZAPI admin reaps orphaned instances.
 */
export async function disconnectInstance(
  tenantId: string,
  instanceId: string,
): Promise<void> {
  const row = await loadRow(tenantId, instanceId);

  let decrypted: string | null = null;
  try {
    decrypted = decrypt(row.uazapi_token_encrypted ?? "");
  } catch {
    // Token unreadable — proceed with local cleanup only.
    decrypted = null;
  }

  if (decrypted) {
    const client = getUazapiClient();
    try {
      await client.deleteInstance(decrypted);
    } catch (err) {
      if (err instanceof UazapiError && err.status === 404) {
        // Already gone upstream — fall through to local delete.
      } else {
        throw new WhatsappError(
          "UAZAPI_ERROR",
          `UAZAPI deleteInstance failed: ${(err as Error).message}`,
          err,
        );
      }
    }
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", instanceId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new WhatsappError(
      "DB_ERROR",
      `Failed to delete whatsapp_instances row: ${error.message}`,
      error,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * `podzap-<tenantShort>-<epoch>`. UAZAPI only uses the name for display,
 * so we keep it short but tenant-identifiable for support/log-grepping.
 */
function defaultInstanceName(tenantId: string): string {
  const shortId = tenantId.replace(/-/g, "").slice(0, 8);
  return `podzap-${shortId}-${Date.now()}`;
}

/**
 * Legacy alias kept during the Fase 2 parallel rollout. Onboarding server
 * actions import `createOrReuseInstance` — the name is misleading (it does
 * NOT reuse; see createInstanceForTenant's ALREADY_CONNECTED guard) but we
 * keep it so parallel agents don't have to refactor their imports. Safe to
 * drop once the onboarding refactor lands.
 */
export const createOrReuseInstance = createInstanceForTenant;
