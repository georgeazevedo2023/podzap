# Webhooks — UAZAPI → podZAP

> Incoming webhook pipeline for Fase 4. Covers the route, payload shape,
> security model, dedup strategy, local dev with ngrok, deploy setup, and
> common failure modes.
>
> Companion: `docs/integrations/uazapi.md` — read that first for the UAZAPI
> side of the contract (endpoint paths, auth model, envelope format).

---

## 1. Overview

UAZAPI is configured to POST every inbound `messages` and `connection`
event to a single, tenant-agnostic route:

```
POST /api/webhooks/uazapi
GET  /api/webhooks/uazapi       ← health-check for UAZAPI's test button
```

Responsibilities:

1. **Authenticate** the payload via a shared secret (see §5 Security).
2. **Resolve tenant + group** from `instance` and `remoteJid` — unknown
   instances or unmonitored groups are dropped with `204 No Content`.
3. **Normalize + persist** a row in `public.messages` with dedup on
   `(tenant_id, uazapi_message_id)`.
4. **Trigger media download** (audio / image) inline. Fase 5 moves this to
   an Inngest worker.
5. **Update instance status** on `connection.update` events.

The route **must return <5s** — UAZAPI will retry (and spam) any request
that hangs past its own timeout. For Fase 4 we accept a few seconds of
inline media download; Fase 5 decouples that.

---

## 2. Local dev setup with ngrok

Localhost is not reachable from UAZAPI. You need a public HTTPS tunnel.

### Install

```bash
# macOS
brew install ngrok/ngrok/ngrok

# Windows
winget install ngrok.ngrok

# Linux
# See https://ngrok.com/download
```

Sign up for a free ngrok account, grab the auth token, and run once:

```bash
ngrok config add-authtoken <YOUR_TOKEN>
```

### Start tunnel

With `npm run dev` already running on port 3001 (Next.js default in this
repo):

```bash
ngrok http 3001
```

ngrok prints:

```
Forwarding  https://abc-123-45-67.ngrok-free.app → http://localhost:3001
```

Copy the HTTPS URL.

### Register the webhook

We ship a one-shot registrar that calls UAZAPI's `POST /webhook` endpoint
with the per-instance token from `.env.local`:

```bash
node --env-file=.env.local scripts/register-webhook.mjs https://abc-123-45-67.ngrok-free.app
```

The script:

1. Reads `UAZAPI_BASE_URL` and the **per-instance token** from the current
   tenant (or an explicit `--tenant=<id>` argument).
2. Computes the full webhook URL as `<url>/api/webhooks/uazapi` and appends
   the tenant-scoped secret fragment (if you're using URL secrets — see §5).
3. Calls `POST /webhook` with
   `{ url, events: ['messages', 'connection'], enabled: true }`.
4. Echoes the returned webhook config back so you can verify it stuck.

Re-run it every time the ngrok URL changes (free plan rotates on restart).

### Smoke test

```bash
# From another shell — fires a canned text-message fixture at your local route.
curl -X POST http://localhost:3001/api/webhooks/test \
  -H 'content-type: application/json' \
  -d '{ "fixture": "text" }'
```

Check `/history` — the message should appear in the feed immediately.

---

## 3. Deploy setup (Hetzner + Portainer)

Production runs as a Docker stack in Portainer on a Hetzner VM, behind
Traefik (or nginx) for TLS termination on a stable domain. Register the
webhook once per environment:

```bash
# Staging
node --env-file=.env.staging scripts/register-webhook.mjs https://staging.podzap.app

# Production
node --env-file=.env.production scripts/register-webhook.mjs https://podzap.app
```

See `docs/deploy/hetzner-portainer.md` for the full stack setup.

Post-deploy sanity:

```bash
curl https://podzap.app/api/webhooks/uazapi
# → { "ok": true }
```

The `POST /api/webhooks/test` endpoint is **dev-only** (guarded by
`NODE_ENV !== 'production'`); it 404s on deploy.

---

## 4. Payload format

Canonical shapes live in `lib/uazapi/types.ts`. The envelope UAZAPI uses
(confirmed live 2026-04-22 for the `POST /webhook` config, still
cross-referenced against the peer gateway schema for the event body itself):

```json
{
  "event": "messages.upsert",
  "instance": "inst_abc123",
  "data": {
    "key": {
      "id": "3EB0…",
      "remoteJid": "120363012345678@g.us",
      "fromMe": false,
      "participant": "5511999999999@s.whatsapp.net"
    },
    "pushName": "Alice",
    "messageTimestamp": 1732022400,
    "messageType": "conversation" | "audioMessage" | "imageMessage" | "videoMessage" | "...",
    "message": { /* type-specific body, see below */ }
  }
}
```

### Text

```jsonc
"message": { "conversation": "Hello from WhatsApp" }
```

Persisted as `messages.type = 'text'`, `content = conversation`.

### Audio

```jsonc
"message": {
  "audioMessage": {
    "mimetype": "audio/ogg; codecs=opus",
    "seconds": 12,
    "ptt": true,
    "url": "https://mmg.whatsapp.net/...",
    "fileLength": 38211
  }
}
```

Persisted as `messages.type = 'audio'` with `media_mime_type`,
`media_duration_seconds`, `media_size_bytes` populated. The URL is
downloaded immediately (see §7) — if that fails, `media_download_status`
goes to `'failed'` and a retry is scheduled in Fase 5.

### Image

```jsonc
"message": {
  "imageMessage": {
    "mimetype": "image/jpeg",
    "caption": "look",
    "url": "https://mmg.whatsapp.net/..."
  }
}
```

Persisted as `messages.type = 'image'`, `content = caption`, media
downloaded to Storage.

### Connection event

```json
{
  "event": "connection.update",
  "instance": "inst_abc123",
  "data": { "status": "connected", "loggedIn": true }
}
```

Mapped to `whatsapp_instances.status` — keeps the sidebar indicator honest.

### Unknown types

Anything else (`videoMessage`, `documentMessage`, `stickerMessage`, …) is
normalized to `type = 'other'` with `content = <messageType>` so pipeline
observability isn't lost.

---

## 5. Security

UAZAPI does **not** document an HMAC signature header at the moment. We
defend with three layers:

### 5.1 Shared secret

Every request must carry `UAZAPI_WEBHOOK_SECRET` in one of:

- Header: `x-uazapi-secret: <secret>`
- Query fallback: `?secret=<secret>` (for gateways that strip custom headers)

Comparison is **constant-time** (`crypto.timingSafeEqual` on equal-length
buffers) to avoid timing leaks. Missing / wrong secret → `401 Unauthorized`
with no body.

### 5.2 Instance allow-list

Even with a valid secret, the route rejects unknown instance IDs (not
present in `whatsapp_instances.uazapi_instance_id` for any tenant). This
turns a leaked secret into "someone can DoS but not exfiltrate".

### 5.3 Tenant isolation

All persistence flows through the service-role admin client but with an
explicit `tenant_id = <resolved>` on every insert. `public.messages` RLS
policies confirm this is the only tenant that can read the row downstream.

### 5.4 Rotating the secret

1. Generate a new value: `openssl rand -hex 32`
2. Update `UAZAPI_WEBHOOK_SECRET` in the Portainer stack env / `.env.local`.
3. Re-run `scripts/register-webhook.mjs <url>` — it propagates the new
   secret to UAZAPI's webhook config.
4. Invalidate the old value in a redeploy window.

---

## 6. Deduplication

Migration `0002_messages.sql` adds a unique index on
`(tenant_id, uazapi_message_id)`. The webhook persist path uses
`insert(...).onConflict('tenant_id,uazapi_message_id').ignore()` — duplicate
events land as a no-op insert rather than an error. Observability:
`messages_total` increments on actual insert; `messages_deduped` increments
on conflict.

Why not `upsert`? WhatsApp occasionally re-sends the same event with more
complete media fields. For Fase 4 we keep the first version (simpler, good
enough); Fase 5 switches to `upsert(..., ignoreDuplicates: false)` once the
media-download worker can tolerate the re-keyed rows.

---

## 7. Media download flow

Fase 4 downloads inline inside the webhook handler:

```
webhook → persistMessage → (if media) downloadAndStore → update row
```

1. Handler inserts the message row with `media_download_status = 'pending'`.
2. `lib/media/download.ts` fetches the UAZAPI URL with a 10s timeout +
   SSRF guard (blocks private IP ranges + loopback).
3. Stream uploads to Supabase Storage bucket `media` at path
   `<tenant_id>/<yyyy>/<mm>/<message_id>.<ext>`.
4. Updates `messages.media_storage_path` + `media_download_status = 'done'`.
5. On failure (timeout, 4xx, virus-scan trip) → `media_download_status =
   'failed'`, UI falls back to a "sendo processada…" placeholder.

**Fase 5 plan:** extract this into an Inngest worker so the webhook returns
in <200ms and retries are a first-class citizen.

---

## 8. Ignored events

The handler intentionally drops:

- **Unknown instance** — no row in `whatsapp_instances`. Logs
  `webhook.unknown_instance` with the instance id, returns `204`.
- **Unknown group** — JID doesn't exist in `groups`. Logs
  `webhook.unknown_group`, returns `204`. Usually means the user hasn't
  run the Fase 3 "sync groups" action yet.
- **Unmonitored group** — `is_monitored = false`. Silent drop. This is the
  primary privacy knob: a user un-checks a group and we stop persisting
  its contents.
- **Direct messages** — `remoteJid` that doesn't end in `@g.us`. podZAP is
  group-only in M1.
- **`fromMe = true`** — our own sends echo back; we don't summarize them.

---

## 9. Troubleshooting

| Symptom                                   | Likely cause                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| Nothing shows up in `/history`            | Check `is_monitored = true` on the group; check logs for `unknown_group`.    |
| `401 Unauthorized` in UAZAPI delivery log | Secret mismatch — re-run `register-webhook.mjs` after rotating.              |
| ngrok tunnel dies overnight               | Free plan — URL rotates on restart. Re-run the registrar.                    |
| UAZAPI not firing anything                | `GET /webhook` (with per-instance token) to inspect the config live.         |
| Media rows stuck on `pending`             | Download failed with no retry yet — check `media_download_status = 'failed'` and the handler logs. |
| Duplicate rows                            | Shouldn't happen — unique index would error. If it does, migration 0002 is missing in that env.   |

### Inspecting the live webhook config

```bash
curl -H "token: $UAZAPI_INSTANCE_TOKEN" \
  https://wsmart.uazapi.com/webhook
```

Expected:

```json
[
  {
    "url": "https://podzap.app/api/webhooks/uazapi",
    "events": ["messages", "connection"],
    "enabled": true,
    ...
  }
]
```

(Equivalent in code: `UazapiClient.getWebhookConfig(instanceToken)`.)

---

## 10. Fixtures for dev

Canned UAZAPI payloads live in `lib/webhooks/fixtures/`:

```
lib/webhooks/fixtures/
├── text.json         # conversation message
├── audio.json        # ptt / audioMessage
├── image.json        # imageMessage with caption
└── connection.json   # connection.update → connected
```

The dev-only `POST /api/webhooks/test` endpoint accepts a fixture name and
replays the payload against the real webhook handler (skipping only the
secret check, since it's auth-guarded instead):

```bash
curl -X POST http://localhost:3001/api/webhooks/test \
  -H 'content-type: application/json' \
  -d '{ "fixture": "audio" }'
```

Optionally target a specific tenant:

```bash
-d '{ "fixture": "audio", "tenantId": "<uuid>" }'
```

Use fixtures for:

- Repeatable integration tests (Vitest pipes them through `handleWebhook`).
- Manual QA without a connected phone.
- Reproducing bugs filed against prod (grab the raw payload from the log
  ring, drop it in as a new fixture, red-green-refactor).

---

## 11. References

- `docs/integrations/uazapi.md` — UAZAPI endpoints + auth.
- `docs/plans/fase-4-plan.md` — task breakdown for this phase.
- `lib/webhooks/validator.ts`, `lib/webhooks/handler.ts`,
  `lib/webhooks/persist.ts` — implementation (Agent 2).
- `lib/media/download.ts`, `lib/media/signedUrl.ts` — media pipeline (Agent 4).
- `app/api/webhooks/uazapi/route.ts`, `app/api/webhooks/test/route.ts` —
  HTTP surface (Agent 3).
