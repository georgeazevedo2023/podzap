/**
 * Webhook dispatcher.
 *
 * Receives an already-validated `IncomingWebhookEvent` and routes it to
 * the right persistence handler based on the discriminated `event` field.
 *
 * Never throws. All failures come back as `{ status: 'error' }` so the
 * HTTP layer can decide between 200 (dropped event — nothing we'd gain
 * by making UAZAPI retry) and 500 (real infra fault). Today the HTTP
 * route agent returns 200 in either case and relies on logs + the
 * `raw_payload` column for postmortems; that behaviour is theirs to pick.
 */

import type { WebhookEvent } from "./validator";
import type { HandleResult } from "./persist";
import {
  persistIncomingMessage,
  updateInstanceConnection,
} from "./persist";

export type { HandleResult };

export async function handleWebhookEvent(
  event: WebhookEvent,
  /** Raw POST body (parsed JSON) — preserved into `messages.raw_payload`. */
  rawBody?: unknown,
): Promise<HandleResult> {
  switch (event.event) {
    case "message":
      return persistIncomingMessage(event, rawBody);
    case "connection":
      return updateInstanceConnection(event);
    case "unknown":
      // Intentionally not an error — the UAZAPI schema lets unknown event
      // types through to `{ event: "unknown", raw }` so we can log-and-drop
      // instead of throwing on any shape drift. `raw` is preserved for
      // offline inspection. Don't persist — we have no trustworthy tenant.
      console.info("[webhook] ignored unknown event", {
        raw: event.raw,
      });
      return { status: "ignored", reason: "unknown event type" };
  }
}
