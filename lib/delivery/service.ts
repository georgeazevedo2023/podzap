/**
 * `lib/delivery/service.ts` — Fase 10.
 *
 * Ships a generated audio artefact to the target WhatsApp group via
 * UAZAPI and records the outcome on the `audios` row. The primary
 * caller is the `deliver-to-whatsapp` Inngest worker, fired from
 * `audio.created`; the redeliver endpoint uses the same helpers to
 * retry manually.
 *
 * Flow:
 *
 *   1. Load the `audios` row + its `summaries` + `groups` rows (scoped
 *      to `tenant_id`). NOT_FOUND if any piece is missing.
 *   2. Resolve the current WhatsApp instance for the tenant. NO_INSTANCE
 *      if there's no row, INSTANCE_NOT_CONNECTED if it isn't live.
 *   3. Download the audio bytes from Storage.
 *   4. Decrypt the UAZAPI token and invoke `sendAudio` (PTT).
 *   5. On success, mark the row `delivered_to_whatsapp=true,
 *      delivered_at=now()`. On UAZAPI error, leave the row alone and
 *      bubble a typed `DeliveryError('UAZAPI_ERROR')` — retry policy
 *      lives in the caller (Inngest retries: 3).
 *
 * `redeliver` is intentionally identical to `deliverAudio` except it
 * skips the "already delivered" short-circuit — the caller (admin
 * tooling, the "Reenviar" button in /podcasts) has already decided
 * retrying is the right move.
 *
 * Error discrimination via `DeliveryError.code` mirrors the rest of
 * the server layer (`AudiosError`, `WhatsappError`), so route handlers
 * can branch to 404/409/502 without string matching.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, CryptoError } from "@/lib/crypto";
import { UazapiClient, UazapiError } from "@/lib/uazapi/client";
import { getCurrentInstance } from "@/lib/whatsapp/service";

const AUDIOS_BUCKET = "audios";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type DeliveryView = {
  audioId: string;
  summaryId: string;
  deliveredToWhatsapp: boolean;
  deliveredAt: string | null;
  targetJid: string | null;
  error: string | null;
};

export class DeliveryError extends Error {
  constructor(
    public code:
      | "NOT_FOUND"
      | "NO_INSTANCE"
      | "INSTANCE_NOT_CONNECTED"
      | "UAZAPI_ERROR"
      | "DB_ERROR",
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "DeliveryError";
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  Internals
// ──────────────────────────────────────────────────────────────────────────

type AudioRow = {
  id: string;
  tenant_id: string;
  summary_id: string;
  storage_path: string;
  delivered_to_whatsapp: boolean;
  delivered_at: string | null;
};

type SummaryRow = {
  id: string;
  tenant_id: string;
  text: string;
  group_id: string;
};

type GroupRow = {
  id: string;
  tenant_id: string;
  uazapi_group_jid: string;
};

type WhatsappInstanceRow = {
  id: string;
  tenant_id: string;
  uazapi_token_encrypted: string | null;
};

/**
 * Construct the UAZAPI client at call time so tests can stub via
 * `vi.mock` and so env-missing errors surface at the first real call
 * rather than at import. Admin token is mandatory at construction
 * time; per-instance tokens are passed to each method call.
 */
function getUazapiClient(): UazapiClient {
  const baseUrl = process.env.UAZAPI_BASE_URL ?? "https://wsmart.uazapi.com";
  const adminToken = process.env.UAZAPI_ADMIN_TOKEN ?? "";
  return new UazapiClient(baseUrl, adminToken);
}

async function loadContext(
  tenantId: string,
  audioId: string,
): Promise<{
  audio: AudioRow;
  summary: SummaryRow;
  group: GroupRow;
}> {
  const admin = createAdminClient();

  // Load audio row (tenant-scoped).
  const { data: audioRow, error: audioErr } = await admin
    .from("audios")
    .select(
      "id, tenant_id, summary_id, storage_path, delivered_to_whatsapp, delivered_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", audioId)
    .maybeSingle();

  if (audioErr) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to load audio ${audioId}: ${audioErr.message}`,
      audioErr,
    );
  }
  if (!audioRow) {
    throw new DeliveryError(
      "NOT_FOUND",
      `Audio ${audioId} not found for tenant ${tenantId}`,
    );
  }
  const audio = audioRow as AudioRow;

  const { data: summaryRow, error: summaryErr } = await admin
    .from("summaries")
    .select("id, tenant_id, text, group_id")
    .eq("tenant_id", tenantId)
    .eq("id", audio.summary_id)
    .maybeSingle();

  if (summaryErr) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to load summary ${audio.summary_id}: ${summaryErr.message}`,
      summaryErr,
    );
  }
  if (!summaryRow) {
    throw new DeliveryError(
      "NOT_FOUND",
      `Summary ${audio.summary_id} not found for tenant ${tenantId}`,
    );
  }
  const summary = summaryRow as SummaryRow;

  const { data: groupRow, error: groupErr } = await admin
    .from("groups")
    .select("id, tenant_id, uazapi_group_jid")
    .eq("tenant_id", tenantId)
    .eq("id", summary.group_id)
    .maybeSingle();

  if (groupErr) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to load group ${summary.group_id}: ${groupErr.message}`,
      groupErr,
    );
  }
  if (!groupRow) {
    throw new DeliveryError(
      "NOT_FOUND",
      `Group ${summary.group_id} not found for tenant ${tenantId}`,
    );
  }
  const group = groupRow as GroupRow;

  return { audio, summary, group };
}

async function loadInstanceToken(tenantId: string): Promise<string> {
  // We need the encrypted token but getCurrentInstance doesn't expose it
  // (on purpose — the InstanceView never leaks the cipher). Round-trip
  // through the admin client directly; `getCurrentInstance` still
  // enforces NO_INSTANCE / INSTANCE_NOT_CONNECTED above this call.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("whatsapp_instances")
    .select("id, tenant_id, uazapi_token_encrypted")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to load whatsapp_instances for tenant ${tenantId}: ${error.message}`,
      error,
    );
  }
  const row = (data?.[0] ?? null) as WhatsappInstanceRow | null;
  if (!row || !row.uazapi_token_encrypted) {
    // Matches the NO_INSTANCE shape from getCurrentInstance. In practice
    // this path is rarely hit because getCurrentInstance already ran.
    throw new DeliveryError(
      "NO_INSTANCE",
      `No WhatsApp instance with a stored token for tenant ${tenantId}`,
    );
  }

  try {
    return decrypt(row.uazapi_token_encrypted);
  } catch (err) {
    if (err instanceof CryptoError) {
      throw new DeliveryError(
        "NO_INSTANCE",
        `Failed to decrypt instance token: ${err.message}`,
        err,
      );
    }
    throw err;
  }
}

async function downloadAudio(storagePath: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(AUDIOS_BUCKET)
    .download(storagePath);

  if (error || !data) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to download audio ${storagePath}: ${
        error?.message ?? "no blob returned"
      }`,
      error,
    );
  }
  // `data` is a Blob-like (supabase-js returns a Blob). Convert to Buffer.
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function markDelivered(
  tenantId: string,
  audioId: string,
): Promise<{ deliveredAt: string }> {
  const deliveredAt = new Date().toISOString();
  const admin = createAdminClient();
  const { error } = await admin
    .from("audios")
    .update({
      delivered_to_whatsapp: true,
      delivered_at: deliveredAt,
    })
    .eq("tenant_id", tenantId)
    .eq("id", audioId);

  if (error) {
    throw new DeliveryError(
      "DB_ERROR",
      `Failed to mark audio ${audioId} delivered: ${error.message}`,
      error,
    );
  }
  return { deliveredAt };
}

async function runDelivery(
  tenantId: string,
  audioId: string,
  opts: {
    includeCaption?: boolean;
    skipAlreadyDelivered: boolean;
    /**
     * Override UAZAPI destination. Default = source group's JID (legacy
     * behaviour). When set, the DB still records delivery against the
     * audio row (delivered flag + delivered_at) but the targetJid in
     * the returned view reflects the actual destination used.
     */
    targetJidOverride?: string;
  },
): Promise<DeliveryView> {
  // 1. Load audio + summary + group, tenant-scoped.
  const { audio, summary, group } = await loadContext(tenantId, audioId);

  // Short-circuit: if already delivered and caller didn't force a retry,
  // return the current view as-is. `redeliver` passes
  // skipAlreadyDelivered=false.
  if (opts.skipAlreadyDelivered && audio.delivered_to_whatsapp) {
    return {
      audioId: audio.id,
      summaryId: audio.summary_id,
      deliveredToWhatsapp: true,
      deliveredAt: audio.delivered_at,
      targetJid: group.uazapi_group_jid,
      error: null,
    };
  }

  // 2. Check instance health.
  const instance = await getCurrentInstance(tenantId);
  if (!instance) {
    throw new DeliveryError(
      "NO_INSTANCE",
      `Tenant ${tenantId} has no WhatsApp instance — cannot deliver audio`,
    );
  }
  if (instance.status !== "connected") {
    throw new DeliveryError(
      "INSTANCE_NOT_CONNECTED",
      `WhatsApp instance for tenant ${tenantId} is ${instance.status}; audio not delivered`,
    );
  }

  // 3. Download the audio bytes.
  const audioBuffer = await downloadAudio(audio.storage_path);

  // 4. Decrypt the per-instance UAZAPI token.
  const instanceToken = await loadInstanceToken(tenantId);

  // 5. Ship it.
  const client = getUazapiClient();
  const targetJid = opts.targetJidOverride ?? group.uazapi_group_jid;
  const caption = opts.includeCaption ? summary.text : undefined;
  try {
    await client.sendAudio(instanceToken, targetJid, audioBuffer, caption);
  } catch (err) {
    if (err instanceof UazapiError) {
      throw new DeliveryError(
        "UAZAPI_ERROR",
        `UAZAPI sendAudio failed for audio ${audioId}: ${err.message}`,
        err,
      );
    }
    throw new DeliveryError(
      "UAZAPI_ERROR",
      `sendAudio failed for audio ${audioId}: ${(err as Error).message}`,
      err,
    );
  }

  // 6. Mark delivered — SEMÂNTICA: `delivered_to_whatsapp` só vira
  // true quando o destino foi o GRUPO de origem. Envios pra "mim" ou
  // pra um contato avulso contam como teste/compartilhamento e não
  // alteram o status do row (o badge em /podcasts fala especificamente
  // de entrega ao grupo).
  const deliveredToGroup = targetJid === group.uazapi_group_jid;
  let deliveredAt: string | null = audio.delivered_at;
  if (deliveredToGroup) {
    ({ deliveredAt } = await markDelivered(tenantId, audioId));
  }

  return {
    audioId: audio.id,
    summaryId: audio.summary_id,
    deliveredToWhatsapp: deliveredToGroup || audio.delivered_to_whatsapp,
    deliveredAt,
    targetJid,
    error: null,
  };
}

// ──────────────────────────────────────────────────────────────────────────
//  Public API
// ──────────────────────────────────────────────────────────────────────────

/**
 * Deliver a freshly-generated audio to its target WhatsApp group.
 *
 * If the row is already flagged delivered, returns the existing view
 * without re-sending. Use `redeliver` to force a re-attempt.
 */
export async function deliverAudio(
  tenantId: string,
  audioId: string,
  opts?: { includeCaption?: boolean; targetJid?: string },
): Promise<DeliveryView> {
  return runDelivery(tenantId, audioId, {
    includeCaption: opts?.includeCaption ?? false,
    skipAlreadyDelivered: true,
    targetJidOverride: opts?.targetJid,
  });
}

/**
 * Force a re-delivery, even if `delivered_to_whatsapp=true`. Mirrors
 * `deliverAudio` but always calls UAZAPI. `targetJid` overrides the
 * default group destination (used by HeroPlayer / RedeliverButton to
 * send the podcast to the user's own WhatsApp or a custom contact).
 */
export async function redeliver(
  tenantId: string,
  audioId: string,
  opts?: { includeCaption?: boolean; targetJid?: string },
): Promise<DeliveryView> {
  return runDelivery(tenantId, audioId, {
    includeCaption: opts?.includeCaption ?? false,
    skipAlreadyDelivered: false,
    targetJidOverride: opts?.targetJid,
  });
}
