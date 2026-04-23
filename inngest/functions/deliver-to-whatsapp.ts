/**
 * `deliver-to-whatsapp` — Fase 10 worker.
 *
 * Trigger: `audio.created`. Emitted by `generate-tts.ts` after the
 * audio row + Storage object have been persisted. This handler ships
 * the audio to the original group via UAZAPI and flips
 * `delivered_to_whatsapp=true` on success.
 *
 * Pipeline:
 *
 *   step.run('deliver', () => deliverAudio(tenantId, audioId, { includeCaption: true }))
 *
 * One step on purpose: splitting download/send/mark into three steps
 * would force pickling the audio buffer through the Inngest state
 * store, which is wasteful for a few-hundred-KB WAV. Atomicity is
 * already handled inside `deliverAudio` (UAZAPI errors do NOT flip
 * the delivered flag, so retry is safe).
 *
 * Retries: 3. Transient UAZAPI 5xx / rate-limit / brief disconnection
 * windows get three more shots; a `DeliveryError('NO_INSTANCE' |
 * 'INSTANCE_NOT_CONNECTED')` also retries under the same ceiling so
 * that a user scanning the QR a minute late can still see their
 * first delivery land.
 */

import { inngest } from "../client";
import { audioCreated } from "../events";
import { deliverAudio, DeliveryError } from "@/lib/delivery/service";
import { createAdminClient } from "@/lib/supabase/admin";

export type DeliverToWhatsappResult = {
  audioId: string;
  targetJid: string | null;
  deliveredAt: string | null;
};

export type DeliverToWhatsappHandlerCtx = {
  event: {
    data: {
      audioId: string;
      tenantId: string;
      summaryId: string;
    };
  };
  step: {
    run<T>(name: string, fn: () => Promise<T> | T): Promise<T>;
  };
  logger: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
};

/**
 * Pure handler exported for unit testing — the Inngest-wrapped function
 * below just adapts types.
 */
export async function deliverToWhatsappHandler(
  ctx: DeliverToWhatsappHandlerCtx,
): Promise<DeliverToWhatsappResult> {
  const { event, step, logger } = ctx;
  const { tenantId, audioId, summaryId } = event.data;

  logger.info("[deliver-to-whatsapp] starting", {
    tenantId,
    audioId,
    summaryId,
  });

  // Resolve per-tenant delivery settings (Fase 10). Fall back to the
  // historical behavior (include caption) on any read error so an
  // unavailable settings row never blocks delivery of the actual audio.
  const includeCaption = await step.run("load-tenant-settings", async () => {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("tenants")
      .select("include_caption_on_delivery")
      .eq("id", tenantId)
      .single();
    if (error || !data) {
      logger.warn(
        "[deliver-to-whatsapp] failed to load tenant settings, defaulting includeCaption=true",
        { tenantId, error: error?.message },
      );
      return true;
    }
    return data.include_caption_on_delivery ?? true;
  });

  const view = await step.run("deliver", () =>
    deliverAudio(tenantId, audioId, { includeCaption }),
  );

  logger.info("[deliver-to-whatsapp] done", {
    audioId,
    targetJid: view.targetJid,
    deliveredAt: view.deliveredAt,
  });

  return {
    audioId: view.audioId,
    targetJid: view.targetJid,
    deliveredAt: view.deliveredAt,
  };
}

/**
 * Inngest-wrapped worker. `retries: 3` covers transient UAZAPI 5xx /
 * rate-limit / brief disconnection. A failure after all attempts
 * leaves `delivered_to_whatsapp=false`; the UI surfaces this and
 * offers a manual "Reenviar" action.
 */
export const deliverToWhatsappFunction = inngest.createFunction(
  {
    id: "deliver-to-whatsapp",
    name: "Deliver generated audio to WhatsApp (UAZAPI /send/media)",
    triggers: [audioCreated],
    retries: 3,
  },
  async ({ event, step, logger }) => {
    return deliverToWhatsappHandler({
      event: event as DeliverToWhatsappHandlerCtx["event"],
      step: step as DeliverToWhatsappHandlerCtx["step"],
      logger: logger as DeliverToWhatsappHandlerCtx["logger"],
    });
  },
);

// Re-export for test / route ergonomics.
export { DeliveryError };
