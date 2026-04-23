/**
 * Admin service for the UAZAPI gateway — the superadmin's cross-tenant view
 * onto all WhatsApp instances running on the UAZAPI server.
 *
 * Responsibilities:
 *   - Enumerate every instance that exists on the UAZAPI server (source of
 *     truth), join it against the local `whatsapp_instances` table, and
 *     surface "attached / unattached" + "which tenant" info to the UI.
 *   - Attach an existing UAZAPI instance to a tenant (1:1 — uniqueness
 *     enforced at the DB level by `uniq_whatsapp_instances_tenant`).
 *   - Detach from a tenant (local-only; the UAZAPI row is preserved so it
 *     can be re-attached to a different tenant without re-scanning QR).
 *   - Create a new UAZAPI instance AND immediately attach it to a tenant in
 *     one operation (the common onboarding case for a brand-new customer).
 *
 * Uses service-role (admin) Supabase client on purpose: F13's policy split
 * only widens SELECT for superadmins; writes to `whatsapp_instances` stay
 * tenant-scoped. All write paths in this module go through service_role
 * and bypass RLS.
 *
 * Errors are wrapped in `UazapiAdminError` so API routes can map `code` to
 * an HTTP status consistently in the shared mapper.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { encrypt, CryptoError } from "@/lib/crypto";
import { UazapiClient, UazapiError } from "@/lib/uazapi/client";
import type { Instance } from "@/lib/uazapi/types";
import type { Database } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type UazapiInstanceAdminView = {
  // From UAZAPI API (source of truth)
  uazapiInstanceId: string;
  name: string;
  status: "connected" | "connecting" | "disconnected";
  phone: string | null;
  profileName: string | null;
  /** UAZAPI's own "created" timestamp if exposed; null when not returned. */
  createdAt: string | null;
  // Local attachment info
  attachedTenantId: string | null;
  attachedTenantName: string | null;
  /** whatsapp_instances.id */
  localInstanceId: string | null;
  /** whatsapp_instances.created_at */
  attachedAt: string | null;
};

export class UazapiAdminError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "TENANT_NOT_FOUND"
      | "ALREADY_ATTACHED"
      | "TENANT_ALREADY_HAS_INSTANCE"
      | "UAZAPI_ERROR"
      | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "UazapiAdminError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

type InstanceRow = Database["public"]["Tables"]["whatsapp_instances"]["Row"];
type DbStatus = Database["public"]["Enums"]["whatsapp_instance_status"];

/**
 * Collapse the UAZAPI status string into our public 3-state enum. QR /
 * intermediate states flatten into `connecting`. Anything unrecognised
 * becomes `disconnected` so the admin UI never guesses.
 */
function normaliseStatus(
  raw: string | undefined | null,
): "connected" | "connecting" | "disconnected" {
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

function toDbStatus(
  s: "connected" | "connecting" | "disconnected",
): DbStatus {
  return s;
}

/**
 * Lazy UAZAPI client — created per call so (a) env vars mutated in tests
 * take effect and (b) a missing UAZAPI_ADMIN_TOKEN blows up at call time
 * with a clear stack, not at module import.
 */
function getUazapiClient(): UazapiClient {
  const baseUrl = process.env.UAZAPI_BASE_URL ?? "https://wsmart.uazapi.com";
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN ?? "";
  return new UazapiClient(baseUrl, adminToken);
}

/**
 * Extract a likely phone number from a UAZAPI Instance. UAZAPI stores the
 * full JID ("5511999999999@s.whatsapp.net") in `owner`. We split on `@` and
 * keep the number-like part; missing / malformed values fall back to null.
 */
function phoneFromOwner(owner: string | undefined | null): string | null {
  if (!owner || typeof owner !== "string") return null;
  const [num] = owner.split("@");
  return num && num.length > 0 ? num : null;
}

/**
 * Build a view object by combining UAZAPI's instance payload with the
 * (optional) local attachment row + tenant name. Used by every operation
 * that returns a view to keep shape consistent.
 */
function toView(
  inst: Instance,
  local: {
    localInstanceId: string | null;
    attachedTenantId: string | null;
    attachedTenantName: string | null;
    attachedAt: string | null;
  },
): UazapiInstanceAdminView {
  // `Instance` doesn't surface a created timestamp in our zod schema but the
  // raw payload sometimes includes one as `created`. Since we've already
  // parsed through zod the extra field is dropped — we keep this null for
  // now and let callers override via `extraCreatedAt` if they have the raw.
  return {
    uazapiInstanceId: inst.id,
    name: inst.name,
    status: normaliseStatus(inst.status),
    phone: phoneFromOwner(inst.owner),
    profileName: inst.profileName ?? null,
    createdAt: null,
    attachedTenantId: local.attachedTenantId,
    attachedTenantName: local.attachedTenantName,
    localInstanceId: local.localInstanceId,
    attachedAt: local.attachedAt,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * List every UAZAPI instance on the server, joined with the local
 * `whatsapp_instances` table so the caller can see which instances are
 * attached (and to whom) versus floating. Ordered by UAZAPI instance
 * name ascending.
 */
export async function listAllInstances(): Promise<UazapiInstanceAdminView[]> {
  const client = getUazapiClient();

  let remote: Instance[];
  try {
    remote = await client.listInstances();
  } catch (err) {
    throw new UazapiAdminError(
      "UAZAPI_ERROR",
      `UAZAPI listInstances failed: ${(err as Error).message}`,
      err,
    );
  }

  const supabase = createAdminClient();
  const { data: localRows, error: localErr } = await supabase
    .from("whatsapp_instances")
    .select("id, tenant_id, uazapi_instance_id, created_at");
  if (localErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${localErr.message}`,
      localErr,
    );
  }

  const { data: tenantRows, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name");
  if (tenantErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query tenants: ${tenantErr.message}`,
      tenantErr,
    );
  }

  const tenantsById = new Map<string, string>(
    (tenantRows ?? []).map((t) => [t.id, t.name]),
  );
  const localByUazapiId = new Map<
    string,
    { id: string; tenant_id: string; created_at: string }
  >();
  for (const row of localRows ?? []) {
    localByUazapiId.set(row.uazapi_instance_id, {
      id: row.id,
      tenant_id: row.tenant_id,
      created_at: row.created_at,
    });
  }

  const out: UazapiInstanceAdminView[] = remote.map((inst) => {
    const local = localByUazapiId.get(inst.id);
    if (!local) {
      return toView(inst, {
        localInstanceId: null,
        attachedTenantId: null,
        attachedTenantName: null,
        attachedAt: null,
      });
    }
    return toView(inst, {
      localInstanceId: local.id,
      attachedTenantId: local.tenant_id,
      attachedTenantName: tenantsById.get(local.tenant_id) ?? null,
      attachedAt: local.created_at,
    });
  });

  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Attach an existing UAZAPI instance to a tenant.
 *
 * Five validation layers, in order:
 *   1. Tenant row exists.
 *   2. Tenant has no `whatsapp_instances` row yet (DB's `uniq_whatsapp_
 *      instances_tenant` would also catch this but we want a clean 409
 *      before we hit UAZAPI).
 *   3. UAZAPI instance with this id exists on the server.
 *   4. UAZAPI instance isn't already attached to a different tenant.
 *   5. The instance has a non-empty `token` we can encrypt. (Otherwise we'd
 *      insert a dead row.)
 */
export async function attachInstance(
  uazapiInstanceId: string,
  tenantId: string,
): Promise<UazapiInstanceAdminView> {
  const supabase = createAdminClient();

  // 1. Tenant exists.
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query tenants: ${tenantErr.message}`,
      tenantErr,
    );
  }
  if (!tenant) {
    throw new UazapiAdminError(
      "TENANT_NOT_FOUND",
      `Tenant ${tenantId} not found.`,
    );
  }

  // 2. Tenant has no instance yet.
  const { data: existing, error: existingErr } = await supabase
    .from("whatsapp_instances")
    .select("id, uazapi_instance_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existingErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${existingErr.message}`,
      existingErr,
    );
  }
  if (existing) {
    throw new UazapiAdminError(
      "TENANT_ALREADY_HAS_INSTANCE",
      `Tenant ${tenantId} already has an attached instance (${existing.uazapi_instance_id}). Detach first.`,
    );
  }

  // 3. UAZAPI instance exists.
  const client = getUazapiClient();
  let remote: Instance[];
  try {
    remote = await client.listInstances();
  } catch (err) {
    throw new UazapiAdminError(
      "UAZAPI_ERROR",
      `UAZAPI listInstances failed: ${(err as Error).message}`,
      err,
    );
  }
  const inst = remote.find((r) => r.id === uazapiInstanceId);
  if (!inst) {
    throw new UazapiAdminError(
      "NOT_FOUND",
      `UAZAPI instance ${uazapiInstanceId} not found on server.`,
    );
  }

  // 4. Not already attached to another tenant.
  const { data: attached, error: attachedErr } = await supabase
    .from("whatsapp_instances")
    .select("id, tenant_id")
    .eq("uazapi_instance_id", uazapiInstanceId)
    .maybeSingle();
  if (attachedErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${attachedErr.message}`,
      attachedErr,
    );
  }
  if (attached) {
    throw new UazapiAdminError(
      "ALREADY_ATTACHED",
      `UAZAPI instance ${uazapiInstanceId} is already attached to tenant ${attached.tenant_id}.`,
    );
  }

  // 5. Encrypt token.
  if (!inst.token) {
    throw new UazapiAdminError(
      "UAZAPI_ERROR",
      `UAZAPI instance ${uazapiInstanceId} has no token (cannot attach).`,
    );
  }
  let tokenEncrypted: string;
  try {
    tokenEncrypted = encrypt(inst.token);
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new UazapiAdminError(
        "DB_ERROR",
        `Failed to encrypt UAZAPI token: ${err.message}`,
        err,
      );
    }
    throw err;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("whatsapp_instances")
    .insert({
      tenant_id: tenantId,
      uazapi_instance_id: inst.id,
      uazapi_token_encrypted: tokenEncrypted,
      status: toDbStatus(normaliseStatus(inst.status)),
      phone: phoneFromOwner(inst.owner),
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to insert whatsapp_instances row: ${insertErr?.message ?? "unknown"}`,
      insertErr,
    );
  }
  const row = inserted as InstanceRow;

  return toView(inst, {
    localInstanceId: row.id,
    attachedTenantId: tenantId,
    attachedTenantName: tenant.name,
    attachedAt: row.created_at,
  });
}

/**
 * Detach the UAZAPI instance currently attached to `tenantId`.
 *
 * WARNING: deleting the `whatsapp_instances` row cascades into every table
 * that references it via `instance_id` with `on delete cascade` — most
 * notably `groups`, which in turn cascades into `messages`, `transcripts`,
 * `summaries`, `audios`, and `schedules`. The UI MUST surface this before
 * calling. We do NOT call `UazapiClient.deleteInstance` here: the UAZAPI
 * row is preserved so the instance remains available for re-attachment
 * (potentially to a different tenant) without re-scanning QR.
 */
export async function detachInstance(tenantId: string): Promise<void> {
  const supabase = createAdminClient();

  const { data: row, error: findErr } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (findErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${findErr.message}`,
      findErr,
    );
  }
  if (!row) {
    throw new UazapiAdminError(
      "NOT_FOUND",
      `No WhatsApp instance attached to tenant ${tenantId}.`,
    );
  }

  const { error: deleteErr } = await supabase
    .from("whatsapp_instances")
    .delete()
    .eq("id", row.id)
    .eq("tenant_id", tenantId);
  if (deleteErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to delete whatsapp_instances row: ${deleteErr.message}`,
      deleteErr,
    );
  }
}

/**
 * Create a brand-new UAZAPI instance AND immediately attach it to a tenant.
 * Convenience for the "new customer onboarding" flow — avoids two round
 * trips through the admin UI (create-on-UAZAPI then attach).
 *
 * Validation: tenant must exist and have no current instance (same reason
 * as `attachInstance`). The new UAZAPI instance is never leaked — if the
 * DB insert fails after creation we still throw, and operator cleanup is
 * to reap orphans via the UAZAPI admin console or subsequent
 * `listAllInstances`.
 */
export async function createAndAttach(
  tenantId: string,
  name: string,
): Promise<UazapiInstanceAdminView> {
  const supabase = createAdminClient();

  // Tenant exists + no instance yet (same two guards as attachInstance;
  // duplicated intentionally so this entry point is self-contained).
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .select("id, name")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query tenants: ${tenantErr.message}`,
      tenantErr,
    );
  }
  if (!tenant) {
    throw new UazapiAdminError(
      "TENANT_NOT_FOUND",
      `Tenant ${tenantId} not found.`,
    );
  }

  const { data: existing, error: existingErr } = await supabase
    .from("whatsapp_instances")
    .select("id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existingErr) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to query whatsapp_instances: ${existingErr.message}`,
      existingErr,
    );
  }
  if (existing) {
    throw new UazapiAdminError(
      "TENANT_ALREADY_HAS_INSTANCE",
      `Tenant ${tenantId} already has an attached instance. Detach first.`,
    );
  }

  const client = getUazapiClient();
  let created: Instance;
  try {
    created = await client.createInstance(name);
  } catch (err) {
    throw new UazapiAdminError(
      "UAZAPI_ERROR",
      `UAZAPI createInstance failed: ${(err as Error).message}`,
      err,
    );
  }
  if (!created?.id || !created?.token) {
    throw new UazapiAdminError(
      "UAZAPI_ERROR",
      "UAZAPI createInstance returned no id/token (shape changed?).",
      created,
    );
  }

  let tokenEncrypted: string;
  try {
    tokenEncrypted = encrypt(created.token);
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new UazapiAdminError(
        "DB_ERROR",
        `Failed to encrypt UAZAPI token: ${err.message}`,
        err,
      );
    }
    throw err;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("whatsapp_instances")
    .insert({
      tenant_id: tenantId,
      uazapi_instance_id: created.id,
      uazapi_token_encrypted: tokenEncrypted,
      status: toDbStatus(normaliseStatus(created.status)),
      phone: phoneFromOwner(created.owner),
    })
    .select("*")
    .single();
  if (insertErr || !inserted) {
    throw new UazapiAdminError(
      "DB_ERROR",
      `Failed to insert whatsapp_instances row: ${insertErr?.message ?? "unknown"}`,
      insertErr,
    );
  }
  const row = inserted as InstanceRow;

  return toView(created, {
    localInstanceId: row.id,
    attachedTenantId: tenantId,
    attachedTenantName: tenant.name,
    attachedAt: row.created_at,
  });
}
