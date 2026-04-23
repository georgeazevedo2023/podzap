/**
 * Inngest client — single instance shared by the route handler and by
 * every `inngest.send(...)` call scattered across the app (webhook
 * persist layer, admin tooling, etc).
 *
 * Why one client:
 *
 *   - The SDK does some lazy initialisation (event key resolution, dev
 *     server probing) the first time it's used. Reusing one instance
 *     avoids paying that cost per request.
 *
 *   - Downstream callers import the `inngest` symbol from here; the
 *     types flow from `inngest/events.ts` via the `eventType()` values
 *     we pass to `createFunction` and to `inngest.send(event.create(...))`.
 *
 * Env vars (all read automatically by the SDK — do NOT pass them here):
 *
 *   - `INNGEST_EVENT_KEY`   — used by `inngest.send` in prod. Blank in
 *                             dev; the SDK routes to the local dev
 *                             server running at 127.0.0.1:8288.
 *   - `INNGEST_SIGNING_KEY` — verifies inbound requests from Inngest to
 *                             the `/api/inngest` handler. Blank in dev.
 *
 * See `docs/plans/fase-5-plan.md` for the worker/event architecture and
 * `app/api/inngest/route.ts` for the serve handler.
 */

import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "podzap",
});
