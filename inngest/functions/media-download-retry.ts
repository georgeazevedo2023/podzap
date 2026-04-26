/**
 * `media-download-retry` — manual-trigger worker for re-downloading a
 * single message's media.
 *
 * Where this fires from:
 *   - Admin tooling / future "Retry" button in the history UI. Emit
 *     `media.download.retry` with a `messageId` and the worker does the
 *     rest.
 *
 * Why a dedicated function (vs just re-running the scheduler):
 *   - The scheduler only retries rows stuck in `pending`. A user who wants
 *     to reprocess a `failed` row or a row whose download succeeded but
 *     was corrupted needs a manual path that ignores the status gate.
 *   - Per-event invocation gets its own Inngest run id in the dashboard,
 *     which is much easier to audit than a batch cron run.
 */

import { inngest } from "../client";
import { mediaDownloadRetry, messageCaptured } from "../events";
import { createAdminClient } from "@/lib/supabase/admin";
import { downloadAndStore } from "@/lib/media/download";
import { decrypt } from "@/lib/crypto";
import type { Database } from "@/lib/supabase/types";

type MessageType = Database["public"]["Enums"]["message_type"];

type LoadedRow = {
  id: string;
  tenant_id: string;
  uazapi_message_id: string;
  media_url: string | null;
  media_mime_type: string | null;
  type: MessageType;
};

export const mediaDownloadRetryWorker = inngest.createFunction(
  {
    id: "media-download-retry",
    name: "Media download — manual retry",
    triggers: [mediaDownloadRetry],
  },
  async ({ event, step, logger }) => {
    const messageId = event.data.messageId;

    const row = await step.run("load-message", async (): Promise<LoadedRow | null> => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .from("messages")
        .select("id, tenant_id, uazapi_message_id, media_url, media_mime_type, type")
        .eq("id", messageId)
        .maybeSingle();
      if (error) {
        throw new Error(`media-download-retry load failed: ${error.message}`);
      }
      return (data ?? null) as LoadedRow | null;
    });

    if (!row) {
      logger.warn("[media-download-retry] message not found", { messageId });
      return { status: "missing" as const, messageId };
    }
    if (!row.media_url) {
      logger.warn("[media-download-retry] no media_url", { messageId });
      return { status: "no-url" as const, messageId };
    }

    const result = await step.run("download", async () => {
      // .enc URLs precisam do UAZAPI pra decriptar — busca instance token.
      const admin = createAdminClient();
      const tokenLookup = await admin
        .from("whatsapp_instances")
        .select("uazapi_token_encrypted")
        .eq("tenant_id", row.tenant_id)
        .maybeSingle();
      let resolveOpts:
        | { instanceToken: string; whatsappMessageId: string }
        | undefined;
      const enc = (tokenLookup.data as { uazapi_token_encrypted: string | null } | null)?.uazapi_token_encrypted;
      if (enc) {
        try {
          resolveOpts = {
            instanceToken: decrypt(enc),
            whatsappMessageId: row.uazapi_message_id,
          };
        } catch {
          resolveOpts = undefined;
        }
      }
      return downloadAndStore(row.tenant_id, row.id, row.media_url!, {
        hintedMime: row.media_mime_type ?? undefined,
        uazapiResolve: resolveOpts,
      });
    });

    if (result.status === "downloaded") {
      await step.run("emit-captured", async () => {
        await inngest.send(
          messageCaptured.create({
            messageId: row.id,
            tenantId: row.tenant_id,
            type: row.type,
          }),
        );
      });
    }

    return {
      status: result.status,
      messageId,
      error: result.error,
    };
  },
);
