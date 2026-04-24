/**
 * UAZAPI webhook ingestion endpoint.
 *
 * Two HTTP methods:
 *   - GET  : health check. UAZAPI pings this when you register a webhook URL
 *            to confirm it's reachable. Returns 200 with a stable JSON body.
 *   - POST : actual event delivery. Shape: `IncomingWebhookEvent` from
 *            `lib/uazapi/types.ts` (messages.upsert or connection.update).
 *
 * Why this route is excluded from the proxy matcher:
 *   UAZAPI authenticates via shared secret (header or `?secret=`), NOT via
 *   our Supabase auth cookie. The matcher in `proxy.ts` skips
 *   `/api/webhooks/*` so unauthenticated requests reach the handler — we do
 *   the secret check here instead. See `proxy.ts` line ~97.
 *
 * Latency budget — CRITICAL:
 *   UAZAPI considers a webhook delivery "failed" if we don't return 200
 *   within ~5 seconds, and then retries with exponential backoff. A retry
 *   storm is way worse than a dropped event. We therefore:
 *     1. Validate secret + schema synchronously (cheap).
 *     2. Call `handleWebhookEvent` inside a try/catch — if it throws, we
 *        LOG + return 200 anyway ("swallowed"). Secret + schema already
 *        passed, so we know the caller is legitimate; the bug is on us.
 *     3. In Fase 5 the handler will enqueue to Inngest instead of running
 *        inline, and this route will just ACK.
 *
 * Logging:
 *   We compute a short correlation id (8-char hex of a cheap hash over the
 *   body) so the log lines on this request can be grep'd together in the
 *   container logs (Portainer / `docker logs`) across validator/handler/
 *   persist boundaries.
 */

import { NextResponse } from 'next/server';
import {
  parseWebhookBody,
  validateAuth,
  type WebhookEvent,
} from '@/lib/webhooks/validator';
import { handleWebhookEvent } from '@/lib/webhooks/handler';
import { errorResponse } from '@/app/api/whatsapp/_shared';

/** Cheap, non-cryptographic correlation id (FNV-1a-ish, base16). */
function correlationId(body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: 'webhooks-uazapi' });
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1) Read body first — HMAC validation needs the exact raw bytes. Reading
  //    once avoids "body already consumed" errors and lets us compute the
  //    correlation id from the same payload we authenticate.
  const raw = await request.text();
  const cid = correlationId(raw);

  // 2) Auth gate. Accepts `x-podzap-signature` (HMAC-SHA256 hex, preferred)
  //    OR legacy `x-uazapi-secret` header / `?secret=` query.
  const auth = validateAuth(request, raw);
  if (!auth.ok) {
    const status = auth.status;
    const message =
      status === 401 ? 'Unauthorized.' : 'Webhook server misconfigured.';
    console.warn(
      `[webhook ${cid}] auth rejected: status=${status} reason="${auth.reason}"`,
    );
    return errorResponse(status, 'UNAUTHORIZED', message);
  }

  let body: unknown;
  try {
    body = raw.length === 0 ? {} : JSON.parse(raw);
  } catch {
    console.warn(`[webhook ${cid}] invalid JSON (len=${raw.length})`);
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid JSON body.', {
      code: 'INVALID_JSON',
    });
  }

  // 3) Shape validation via zod (validator owns the schema).
  const parsed = parseWebhookBody(body);
  if (!parsed.ok) {
    console.warn(`[webhook ${cid}] schema rejected: reason="${parsed.reason}"`);
    return errorResponse(400, 'VALIDATION_ERROR', parsed.reason);
  }

  const event: WebhookEvent = parsed.event;
  console.log(
    `[webhook ${cid}] accepted event=${event.event}${
      event.event === 'message' ? ` type=${event.content.kind}` : ''
    }`,
  );

  // 4) Dispatch to handler. Wrap in try/catch so a bug doesn't cause UAZAPI
  //    to enter its retry loop — we've already validated the request is
  //    legitimate and well-formed, so retrying won't help.
  try {
    const result = await handleWebhookEvent(event);
    console.log(
      `[webhook ${cid}] handled status=${result.status}${
        result.messageId ? ` messageId=${result.messageId}` : ''
      }${result.reason ? ` reason="${result.reason}"` : ''}`,
    );
    return NextResponse.json({ ok: true, status: result.status, cid });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[webhook ${cid}] handler threw — swallowing: ${message}`);
    return NextResponse.json({ ok: true, delivery: 'swallowed', cid });
  }
}
