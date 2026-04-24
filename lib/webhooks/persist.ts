/**
 * Persist layer for incoming UAZAPI webhook events.
 *
 * Two entry points:
 *   - `persistIncomingMessage(event)` — the common path. Resolves
 *     tenant + group, dedups by `(tenant_id, uazapi_message_id)`, and
 *     inserts a row in `messages`.
 *   - `updateInstanceConnection(event)` — connection state transition.
 *     For now we just bump `last_seen_at`; a full status sync is deferred
 *     to a later phase (the poll-based `refreshInstanceStatus` in
 *     `lib/whatsapp/service.ts` already does the heavy lifting).
 *
 * Both return a tagged `HandleResult` rather than throwing. Throws are
 * reserved for *programmer* errors — unknown DB shape, missing env — not
 * for "grupo não monitorado" or "mensagem duplicada", which are expected
 * conditions the route handler must differentiate for 200 vs 500.
 *
 * Tenant isolation: we always filter by `tenant_id` alongside the lookup
 * key even though the instance lookup is already tenant-scoped. Belt and
 * suspenders — same pattern as the other service layers.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { downloadAndStore } from "@/lib/media/download";
import { inngest } from "@/inngest/client";
import { messageCaptured } from "@/inngest/events";
import type {
  MessageUpsertEvent,
  ConnectionUpdateEvent,
} from "@/lib/uazapi/types";
import type { Database, Json } from "@/lib/supabase/types";

// ──────────────────────────────────────────────────────────────────────────
//  Public types
// ──────────────────────────────────────────────────────────────────────────

export type HandleResult = {
  status: "persisted" | "dedup" | "ignored" | "error";
  messageId?: string;
  reason?: string;
};

type MessageRow = Database["public"]["Tables"]["messages"]["Row"];
type MessageInsert = Database["public"]["Tables"]["messages"]["Insert"];
type MessageType = Database["public"]["Enums"]["message_type"];

// ──────────────────────────────────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Map a normalised `MessageContent.kind` into the `message_type` enum value
 * the DB expects. Both vocabularies overlap exactly today, but the explicit
 * mapping means a future divergence (e.g. a new `document` kind) won't
 * silently write an invalid enum.
 */
function toDbMessageType(kind: MessageUpsertEvent["content"]["kind"]): MessageType {
  switch (kind) {
    case "text":
      return "text";
    case "audio":
      return "audio";
    case "image":
      return "image";
    case "video":
      return "video";
    default:
      return "other";
  }
}

/**
 * True when the event concerns a group chat. WhatsApp JIDs end in `@g.us`
 * for groups and `@s.whatsapp.net` for direct messages. We skip direct
 * messages entirely in the MVP — podZAP only summarises groups.
 */
function isGroupJid(jid: string): boolean {
  return jid.endsWith("@g.us");
}

/**
 * Extract the caller's readable content payload for storage. For text we
 * persist the text; for media we persist the caption (may be empty); for
 * `other` we persist the raw type label so the history UI can show
 * "documento", "figurinha", etc. without having to look at raw_payload.
 */
function extractContent(content: MessageUpsertEvent["content"]): string | null {
  switch (content.kind) {
    case "text":
      return content.text ?? null;
    case "image":
    case "video":
      return content.caption ?? null;
    case "audio":
      // Voice notes have no text body. Leave null; transcript fills it later.
      return null;
    case "other":
      return content.rawType ?? null;
  }
}

function extractMediaUrl(
  content: MessageUpsertEvent["content"],
): string | null {
  if (
    content.kind === "audio" ||
    content.kind === "image" ||
    content.kind === "video"
  ) {
    return content.mediaUrl ?? null;
  }
  return null;
}

function extractMediaMime(
  content: MessageUpsertEvent["content"],
): string | null {
  if (
    content.kind === "audio" ||
    content.kind === "image" ||
    content.kind === "video"
  ) {
    return content.mimetype ?? null;
  }
  return null;
}

function extractMediaSize(
  content: MessageUpsertEvent["content"],
): number | null {
  if (
    content.kind === "audio" ||
    content.kind === "image" ||
    content.kind === "video"
  ) {
    return content.fileLength ?? null;
  }
  return null;
}

function extractMediaDuration(
  content: MessageUpsertEvent["content"],
): number | null {
  if (content.kind === "audio" || content.kind === "video") {
    return content.seconds ?? null;
  }
  return null;
}

/**
 * Does the event carry media we need to download later? Determines the
 * initial `media_download_status` — `pending` for media, `skipped` for
 * text / other / missing-url rows. Kept as a function so we can widen it
 * later (e.g. skip tiny thumbnails).
 */
function hasDownloadableMedia(content: MessageUpsertEvent["content"]): boolean {
  if (
    content.kind === "audio" ||
    content.kind === "image" ||
    content.kind === "video"
  ) {
    return typeof content.mediaUrl === "string" && content.mediaUrl.length > 0;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────
//  persistIncomingMessage
// ──────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline for a `messages.upsert` event:
 *
 *   1. Resolve instance → tenant.            (ignored if unknown)
 *   2. Ensure the chat is a group + monitored.(ignored otherwise)
 *   3. Dedup via `(tenant_id, uazapi_message_id)` unique index.
 *   4. Insert the row; return the new id.
 *
 * Intentional design choices:
 *
 *   - We never auto-create a `groups` row. Tenant must explicitly sync
 *     groups via Fase-3. Silent auto-creation would make the monitor toggle
 *     opt-in UX meaningless (every new group would appear monitored=false
 *     from an event the user never asked about).
 *
 *   - We only drop `fromMe=true` for **audio** messages. The Fase 10
 *     delivery worker sends the podcast audio back to the group, which
 *     fires a `fromMe=true` webhook of type audio — ingesting that would
 *     transcribe our own podcast and include it in the next summary
 *     (loop). Text/image/video the owner posts are legit user input and
 *     ARE captured. Fix tracked for later: stamp `audios.uazapi_delivered_message_id`
 *     so we can let all fromMe audios through except our exact delivery ids.
 *
 *   - Dedup uses the UNIQUE `(tenant_id, uazapi_message_id)` index from
 *     migration 0001 + `on conflict do nothing`. We implement it as a
 *     pre-check select followed by an insert, because supabase-js's
 *     `.upsert(..., { ignoreDuplicates: true })` returns an empty array on
 *     conflict without a way to distinguish from "nothing inserted due to
 *     RLS" on some PostgREST versions. The pre-check is racy (two webhooks
 *     in flight can both pass), but the unique index is still the final
 *     arbiter: on race, the insert fails with code 23505 and we treat it
 *     as a dedup, not an error.
 */
export async function persistIncomingMessage(
  event: MessageUpsertEvent,
): Promise<HandleResult> {
  // 0. Ignore only self-sent AUDIO messages. That covers the podcast
  //    delivery loop (we send audio back; UAZAPI re-fires webhook for it).
  //    Text/image/video the tenant owner posts are legitimate group input
  //    and must be captured, otherwise the owner never appears in their
  //    own summaries.
  if (event.key.fromMe && event.content.kind === "audio") {
    return { status: "ignored", reason: "fromMe audio (own podcast delivery)" };
  }

  const supabase = createAdminClient();

  // 1. Resolve tenant via the UAZAPI instance id we got in the envelope.
  const instanceUazapiId = event.instance;
  if (!instanceUazapiId) {
    return { status: "ignored", reason: "missing instance id" };
  }

  const { data: instanceRow, error: instanceErr } = await supabase
    .from("whatsapp_instances")
    .select("id, tenant_id")
    .eq("uazapi_instance_id", instanceUazapiId)
    .maybeSingle();

  if (instanceErr) {
    return {
      status: "error",
      reason: `DB error (instance lookup): ${instanceErr.message}`,
    };
  }
  if (!instanceRow) {
    return { status: "ignored", reason: "unknown instance" };
  }

  const tenantId = instanceRow.tenant_id;

  // 2. Group-only. Direct messages are out of scope for podZAP MVP.
  const groupJid = event.key.remoteJid;
  if (!isGroupJid(groupJid)) {
    return { status: "ignored", reason: "direct message" };
  }

  const { data: groupRow, error: groupErr } = await supabase
    .from("groups")
    .select("id, is_monitored")
    .eq("tenant_id", tenantId)
    .eq("uazapi_group_jid", groupJid)
    .maybeSingle();

  if (groupErr) {
    return {
      status: "error",
      reason: `DB error (group lookup): ${groupErr.message}`,
    };
  }
  if (!groupRow) {
    return { status: "ignored", reason: "unknown group" };
  }
  if (!groupRow.is_monitored) {
    return { status: "ignored", reason: "group not monitored" };
  }

  // 3. Dedup pre-check. See note in the header comment for why.
  const uazapiMessageId = event.key.id;
  const { data: existing, error: existingErr } = await supabase
    .from("messages")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("uazapi_message_id", uazapiMessageId)
    .maybeSingle();

  if (existingErr) {
    return {
      status: "error",
      reason: `DB error (dedup check): ${existingErr.message}`,
    };
  }
  if (existing) {
    return { status: "dedup", messageId: existing.id };
  }

  // 4. Build + insert.
  const capturedAt = event.timestamp
    ? new Date(event.timestamp).toISOString()
    : new Date().toISOString();

  // `event` is a zod object; JSON.parse(JSON.stringify(event)) gives us a
  // plain Json-safe value for the `raw_payload` column. We do this once
  // rather than trusting zod's output — it may contain `undefined` leaves
  // that Postgres's jsonb won't accept.
  const rawPayload = JSON.parse(JSON.stringify(event)) as Json;

  const insertRow: MessageInsert = {
    tenant_id: tenantId,
    group_id: groupRow.id,
    uazapi_message_id: uazapiMessageId,
    sender_jid: event.key.participant ?? event.key.remoteJid,
    sender_name: event.pushName ?? null,
    type: toDbMessageType(event.content.kind),
    content: extractContent(event.content),
    media_url: extractMediaUrl(event.content),
    media_mime_type: extractMediaMime(event.content),
    media_size_bytes: extractMediaSize(event.content),
    media_duration_seconds: extractMediaDuration(event.content),
    media_download_status: hasDownloadableMedia(event.content)
      ? "pending"
      : "skipped",
    captured_at: capturedAt,
    raw_payload: rawPayload,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("messages")
    .insert(insertRow)
    .select("id")
    .maybeSingle();

  if (insertErr) {
    // 23505 is the Postgres unique_violation code. Treat as dedup — a
    // concurrent webhook snuck in between our pre-check and the insert.
    const anyErr = insertErr as { code?: string; message?: string };
    if (anyErr.code === "23505") {
      return { status: "dedup", reason: "unique violation race" };
    }
    return {
      status: "error",
      reason: `DB error (insert): ${insertErr.message}`,
    };
  }

  if (!inserted) {
    return { status: "error", reason: "insert returned no row" };
  }

  const row = inserted as Pick<MessageRow, "id">;

  // Fire-and-forget media download. The webhook handler must return fast
  // (<5s) so UAZAPI doesn't retry. `downloadAndStore` has its own 30s
  // timeout and updates `media_download_status` in the DB on completion
  // (or failure). A later Inngest worker will retry rows stuck in
  // `pending` after TTL.
  const mediaUrl = insertRow.media_url;
  if (insertRow.media_download_status === "pending" && mediaUrl) {
    void downloadAndStore(tenantId, row.id, mediaUrl, {
      hintedMime: insertRow.media_mime_type ?? undefined,
    }).catch((err: unknown) => {
      console.error("[webhooks/persist] media download failed:", err);
    });
  }

  // Fire-and-forget Inngest event. Fans out to downstream workers
  // (transcribe-audio / describe-image / future consumers). Same
  // philosophy as the media download above: if the event can't be
  // delivered we log it but do NOT fail the webhook — UAZAPI will retry
  // the whole payload on a non-2xx and that would double-insert. A
  // failure here only delays transcription; the row is already safe in
  // the DB and the retry-pending cron will eventually re-emit.
  void inngest
    .send(
      messageCaptured.create({
        messageId: row.id,
        tenantId,
        type: insertRow.type,
      }),
    )
    .catch((err: unknown) => {
      console.error("[webhooks/persist] inngest.send failed:", err);
    });

  return { status: "persisted", messageId: row.id };
}

// ──────────────────────────────────────────────────────────────────────────
//  updateInstanceConnection
// ──────────────────────────────────────────────────────────────────────────

/**
 * Handle `connection.update` events.
 *
 * Current scope is intentionally narrow: we bump `last_seen_at` on the row
 * matching `uazapi_instance_id`. We do NOT update `status` yet — UAZAPI's
 * connection event fires transiently (e.g. during reconnect) and the
 * polling refresh is still our source of truth. When we wire the webhook
 * into the real lifecycle (Fase 5+), we'll translate `status` here and
 * clear `connected_at` on logout. For now the main value is confirming
 * that the webhook pipe is alive.
 *
 * Returns `ignored` when the instance is unknown so the caller can 200
 * without treating it as an error.
 */
export async function updateInstanceConnection(
  event: ConnectionUpdateEvent,
): Promise<HandleResult> {
  const supabase = createAdminClient();
  const instanceUazapiId = event.instance;
  if (!instanceUazapiId) {
    return { status: "ignored", reason: "missing instance id" };
  }

  const { data: instanceRow, error: lookupErr } = await supabase
    .from("whatsapp_instances")
    .select("id, tenant_id")
    .eq("uazapi_instance_id", instanceUazapiId)
    .maybeSingle();

  if (lookupErr) {
    return {
      status: "error",
      reason: `DB error (instance lookup): ${lookupErr.message}`,
    };
  }
  if (!instanceRow) {
    return { status: "ignored", reason: "unknown instance" };
  }

  const { error: updErr } = await supabase
    .from("whatsapp_instances")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", instanceRow.id)
    .eq("tenant_id", instanceRow.tenant_id);

  if (updErr) {
    return {
      status: "error",
      reason: `DB error (update last_seen_at): ${updErr.message}`,
    };
  }

  // TODO(fase-5): translate event.status → whatsapp_instance_status enum
  //               and persist. Also clear `connected_at` on logout.
  return { status: "persisted" };
}
