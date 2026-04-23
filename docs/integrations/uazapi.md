# UAZAPI Integration Guide

podZAP uses UAZAPI (a WhatsApp gateway) as the sole WhatsApp transport. This
document captures the endpoints, auth model, webhook payloads and open
questions for the first integration layer.

- **Instance host**: `https://wsmart.uazapi.com`
- **Admin token env var**: `UAZAPI_ADMIN_TOKEN` (in `.env.local`)
- **Client code**: `lib/uazapi/client.ts`
- **Types / zod schemas**: `lib/uazapi/types.ts`

> Sources: the `uazapi` Claude skill (authoritative), plus the public docs at
> <https://docs.uazapi.com>. The docs site is a client-rendered SPA, so
> several pages could not be auto-extracted — those are flagged in "Open
> Questions" and should be validated against the live dashboard before going
> to production.

---

## 1. Authentication model

UAZAPI uses two tokens at two different scopes:

| Token          | Header(s)                              | Scope                                                                                     |
| -------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| Admin token    | `admintoken: <token>` + `token: <token>` | Instance lifecycle (create / list / delete all instances) at the server level.            |
| Instance token | `token: <token>`                       | Everything scoped to a single WhatsApp number: connect, send, list groups, webhook, etc. |

When an instance is created via the admin API, the server returns a per-instance
token. That token is what we persist (encrypted) in `user_whatsapp_instances`
and what we pass to every subsequent per-instance call.

Security:

- The admin token **must never reach the browser**. It is a server-only env var.
- The per-instance token is also server-only — the UI never needs it; our API
  routes forward it from DB to UAZAPI.
- Encrypt at rest (AES-GCM via `ENCRYPTION_KEY`) when storing in Postgres.

---

## 2. Endpoint reference

All paths below are relative to the base URL. All JSON bodies.

### 2.1 Instance management

#### Create instance (admin)

> **OPEN QUESTION**: the public docs expose this under the admin panel but the
> exact path is not confirmed by the skill. Common variants observed in
> UAZAPI-compatible gateways are `POST /instance/init` and
> `POST /instance/create`. The client uses `POST /instance/init` as the primary
> path; a fallback to `/instance/create` is acceptable if the first 404s.

```
POST /instance/init
Headers: { "admintoken": "<admin>", "Content-Type": "application/json" }
Body:    { "name": "<arbitrary label>" }
Response (shape as observed on similar gateways):
{
  "instance": {
    "id": "inst_abc123",
    "name": "podzap-user-42",
    "token": "inst_tok_xxxxxxxx",
    "status": "disconnected"
  }
}
```

We persist `id`, `token`, and `status`.

#### Get status

```
GET /instance/status
Headers: { "token": "<instanceToken>" }
Response: {
  "instance": { "status": "connected" | "connecting" | "disconnected", ... },
  "loggedIn": boolean
}
```

Multiple response shapes exist — the client normalises to a single enum
(`InstanceStatus`).

#### Connect / get QR code

```
POST /instance/connect
Headers: { "token": "<instanceToken>" }
Body:    {}
Response variants (all handled):
  { "instance": { "qrcode": "<base64>", "status": "connecting" } }
  { "qrcode": "<base64>" }
  { "base64": "<base64>" }
  { "status": "connected", "loggedIn": true }        // already connected
```

`qrcode` / `base64` is a data-URL-ready base64 string (no `data:` prefix in
most cases — our client adds `data:image/png;base64,` if missing).

#### List all instances (admin)

```
GET /instance/all
Headers: { "admintoken": "<admin>", "token": "<admin>" }
Response: Instance[]
```

Useful for reconciliation jobs and orphan detection.

#### Delete instance (admin)

> **OPEN QUESTION**: not in the skill doc. Canonical path on peer gateways is
> `DELETE /instance/:id` or `POST /instance/logout`. The client implements
> `DELETE /instance/{id}` with the admin token; validate before production.

```
DELETE /instance/{id}
Headers: { "admintoken": "<admin>" }
Response: { "deleted": true } | 204
```

---

### 2.2 Groups

#### List groups

```
GET /group/list?noparticipants=false
Headers: { "token": "<instanceToken>" }
Response: Group[]  // may also be wrapped: { groups: [...] } or { data: [...] }
```

Field names arrive in both PascalCase and camelCase (e.g. `JID` or `jid`,
`Name` or `name`, `Participants` or `participants`). The client and zod
schema accept both and normalise to camelCase.

#### Group info

```
POST /group/info
Headers: { "token": "<instanceToken>" }
Body:    { "groupjid": "<jid>@g.us" }
Response: Group (detailed, with participants)
```

---

### 2.3 Messaging

#### Send text

```
POST /send/text
Headers: { "token": "<instanceToken>" }
Body:    { "number": "<jid-or-phone>", "text": "<message, up to 4096 chars>" }
Response: { "id": "<messageId>", "status": "sent", ... }
```

`number` accepts either a raw E.164 phone (`5511999999999`) or a full JID
(`5511999999999@s.whatsapp.net` / `120...@g.us`). The client keeps whatever
the caller passes.

#### Send audio (voice note or media audio)

podZAP's core feature is publishing podcast-style audio into WhatsApp groups,
so the default for us is PTT (push-to-talk / voice note).

```
POST /send/media
Headers: { "token": "<instanceToken>" }
Body:    {
  "number": "<jid-or-phone>",
  "type": "ptt",                        // or "audio" for file-style playback
  "file": "<base64 OR https URL>",
  "text": "<optional caption — usually ignored for ptt>"
}
```

- `ptt` renders as a voice note (waveform UI, play-once style) — **use this**
  for episode deliveries.
- `audio` renders as a regular audio attachment.
- `file` can be a data URL, raw base64, or an https URL. Prefer URL when the
  MP3 is already on S3/R2 — avoids a ~33% base64 payload tax.

Other media types supported by `/send/media`: `image`, `video`, `document`,
`file`. Not used in M1.

---

### 2.4 Webhooks

> **OPEN QUESTION**: the exact webhook-registration endpoint (likely
> `POST /webhook` or `POST /instance/webhook`) and the exact JSON envelope
> were not verifiable from the docs site (SPA). The shapes below are the
> de-facto shape used by UAZAPI as described by the skill and peer gateways
> (Evolution API, Baileys-based gateways). Confirm against a real event
> capture during integration QA.

#### Register webhook (expected)

```
POST /webhook
Headers: { "token": "<instanceToken>" }
Body:    {
  "url": "https://podzap.app/api/webhooks/uazapi",
  "events": ["messages", "status", "connection"],   // or "all"
  "enabled": true
}
```

Our single webhook route fans-out by `event` / `type`.

#### Incoming message envelope (text)

```json
{
  "event": "messages.upsert",
  "instance": "inst_abc123",
  "data": {
    "key": {
      "id": "3EB0...",
      "remoteJid": "120363012345678@g.us",
      "fromMe": false,
      "participant": "5511999999999@s.whatsapp.net"
    },
    "pushName": "Alice",
    "messageTimestamp": 1732022400,
    "message": {
      "conversation": "Hello from WhatsApp"
    },
    "messageType": "conversation"
  }
}
```

#### Audio

```json
{
  "event": "messages.upsert",
  "instance": "inst_abc123",
  "data": {
    "key": { "id": "...", "remoteJid": "...", "fromMe": false },
    "messageTimestamp": 1732022400,
    "messageType": "audioMessage",
    "message": {
      "audioMessage": {
        "mimetype": "audio/ogg; codecs=opus",
        "seconds": 12,
        "ptt": true,
        "url": "https://mmg.whatsapp.net/...",
        "mediaKey": "...",
        "fileLength": 38211
      }
    }
  }
}
```

To obtain a persistent URL, call `POST /message/download` with
`{ id, return_link: true, generate_mp3: true }`.

#### Image

```json
{
  "event": "messages.upsert",
  "instance": "inst_abc123",
  "data": {
    "messageType": "imageMessage",
    "message": {
      "imageMessage": {
        "mimetype": "image/jpeg",
        "caption": "look",
        "url": "https://mmg.whatsapp.net/...",
        "fileLength": 99123,
        "height": 1280, "width": 960
      }
    }
  }
}
```

#### Video

```json
{
  "event": "messages.upsert",
  "instance": "inst_abc123",
  "data": {
    "messageType": "videoMessage",
    "message": {
      "videoMessage": {
        "mimetype": "video/mp4",
        "caption": "",
        "url": "https://mmg.whatsapp.net/...",
        "seconds": 18,
        "fileLength": 1048576
      }
    }
  }
}
```

#### Other / unknown

Anything whose `messageType` is not `conversation | audioMessage | imageMessage |
videoMessage` — documents, stickers, contacts, locations, reactions, ephemeral
messages, etc. — is normalised to `kind: "other"` by our webhook handler.

#### Connection status event

```json
{
  "event": "connection.update",
  "instance": "inst_abc123",
  "data": {
    "status": "connected" | "disconnected" | "connecting" | "qr",
    "reason": "optional string",
    "loggedIn": true
  }
}
```

We map this to the instance's `status` column to keep the UI honest.

---

## 3. Error codes / rate limits

- 2xx: success.
- 401: token missing or wrong scope (admin vs instance).
- 404: instance not found or wrong path.
- 409: instance already connecting / already exists.
- 422: validation (e.g. bad JID, text > 4096 chars, wrong media type).
- 429: rate-limited (see below).
- 5xx: upstream WhatsApp socket problem — retry with backoff.

**Rate limits**: UAZAPI does not publish a precise quota. Empirical guidance
from the skill:

- Keep broadcast loops to **5–20 minutes between sends** to avoid WhatsApp-side
  bans.
- Avoid bursting group-send > ~1 msg/sec per instance.

> **OPEN QUESTION**: official per-endpoint quotas are not documented.

---

## 4. QR → connected flow (ASCII sequence)

```
User           Next.js API           UazapiClient         UAZAPI           WhatsApp phone
 |                |                       |                  |                    |
 | click "Connect"|                       |                  |                    |
 |--------------->|                       |                  |                    |
 |                | createInstance(name)  |                  |                    |
 |                |---------------------->|                  |                    |
 |                |                       | POST /instance/init (admintoken)      |
 |                |                       |----------------->|                    |
 |                |                       |<----- {id,token} |                    |
 |                |<-- Instance ----------|                  |                    |
 |                | (persist to DB)       |                  |                    |
 |                |                                                               |
 |                | getQrCode(id)         |                  |                    |
 |                |---------------------->|                  |                    |
 |                |                       | POST /instance/connect (instance tok) |
 |                |                       |----------------->|                    |
 |                |                       |<-- {qrcode b64}  |                    |
 |                |<-- qrCodeBase64 ------|                  |                    |
 | render QR      |                       |                  |                    |
 |<---------------|                       |                  |                    |
 | scan with phone                                                                |
 |--------------------------------------------------------------------------- scan >|
 |                |                                                               |
 |                | [webhook] POST /api/webhooks/uazapi  event=connection.update  |
 |                |<----------------------------------------|                    |
 |                |  status=connected                                             |
 |                | (update DB + push to UI via SSE/refetch)                      |
 |<-- "connected" |                       |                  |                    |
```

Polling fallback: if we can't trust the webhook, the client can poll
`GET /instance/status` every 3s while the QR screen is open, stopping on
`connected` or timeout.

---

## 5. Security notes

- **Token storage**: admin token only in `.env.local` (server). Per-instance
  tokens encrypted column in Postgres. Never expose either via API response
  to the browser.
- **Webhook signature validation**: UAZAPI does **not** currently document an
  HMAC signature header. Mitigations we use:
  1. Put the webhook URL behind an unguessable path segment (shared secret in
     the URL, rotatable).
  2. IP-allowlist `wsmart.uazapi.com` at the edge if stable.
  3. Validate the `instance` field against a known instance in DB before
     trusting any payload.
- **Replay protection**: dedupe incoming message IDs (`data.key.id`) — we do
  this with a unique index on `whatsapp_messages.external_id`.
- **PII**: webhook payloads can include phone numbers and message bodies.
  Log redacted versions only; store encrypted.

---

## 6. Open questions

1. **Instance create/delete paths** — skill doesn't confirm; pick from
   `/instance/init` | `/instance/create` and `DELETE /instance/{id}` |
   `POST /instance/logout`. Verify against live server during integration.
2. **Webhook registration endpoint** and the exact envelope (`event` field
   name: is it `event`, `type`, or `action`?). Validate against a real
   received payload before widening consumer code.
3. **Webhook signature / HMAC** — appears to be none. Re-check whether
   UAZAPI v2 introduced one; if not, enforce URL-secret + IP allowlist.
4. **Rate limits** — no official numbers. Treat as unknown; add a token
   bucket per instance (e.g. 1 msg/sec, 60 msg/min) and monitor 429s.
5. **Audio format for PTT** — OGG/Opus plays natively as voice note; MP3 may
   be silently transcoded or rejected. Confirm by test send during M1.
6. **`generate_mp3` on `/message/download`** — confirm it actually transcodes
   OGG → MP3 (helpful for our "download audio" feature).
