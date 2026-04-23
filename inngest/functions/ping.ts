/**
 * `ping` — trivial health function.
 *
 * Purpose: when smoke-testing the Inngest wiring (dev server sync, serve
 * handler, event delivery), we need a function that runs instantly, has
 * zero external deps, and never fails. `ping` fits: it logs the payload,
 * returns a deterministic object, done.
 *
 * NOT for production traffic. It is registered in
 * `app/api/inngest/route.ts` alongside the real workers because Inngest
 * only sees functions that the serve handler declares — registering it
 * costs nothing at steady state (no events fire against it in prod).
 *
 * Dispatch manually during setup with:
 *   curl -X POST http://127.0.0.1:8288/e/dev \
 *     -H 'content-type: application/json' \
 *     -d '{"name":"test.ping","data":{"at":"2026-04-22T00:00:00.000Z"}}'
 */

import { inngest } from "../client";
import { testPing } from "../events";

export const ping = inngest.createFunction(
  {
    id: "ping",
    name: "Ping — health check",
    triggers: [testPing],
  },
  async ({ event, logger }) => {
    logger.info("[ping] received", { at: event.data.at });
    return { pong: true, at: new Date().toISOString() };
  },
);
