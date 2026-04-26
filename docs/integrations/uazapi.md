# UAZAPI Integration Guide

podZAP uses UAZAPI (a WhatsApp gateway) as the sole WhatsApp transport. This
document captures the endpoints, auth model, webhook payloads and open
questions for the first integration layer.

- **Instance host**: `https://wsmart.uazapi.com`
- **Admin token env var**: `UAZAPI_ADMIN_TOKEN` (in `.env.local`)
- **Client code**: `lib/uazapi/client.ts`
- **Types / zod schemas**: `lib/uazapi/types.ts`

> Sources: the `uazapi` Claude skill, the public docs at
> <https://docs.uazapi.com>, and — most importantly — a live probe of
> `https://wsmart.uazapi.com` run on **2026-04-22** as part of Fase-2 audit.
> Where the skill and the live server disagreed, the live server wins; those
> resolutions are flagged inline.

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

Verified live: `POST /instance/init`. The server accepts `admintoken` as the
header; for peer-gateway parity the client also sends `token: <admin>` with
the same value (both headers are honoured).

```
POST /instance/init
Headers: { "admintoken": "<admin>", "token": "<admin>", "Content-Type": "application/json" }
Body:    { "name": "<arbitrary label>" }
Response:
{
  "info": "Instance created successfully",
  "response": "Instance created successfully",
  "status": "disconnected",
  "token": "<per-instance token>",
  "name": "...",
  "instance": {
    "id": "inst_abc123",
    "name": "podzap-tenant-42",
    "token": "<per-instance token>",
    "status": "disconnected"
  }
}
```

We persist `instance.id`, `instance.token` (encrypted — AES-256-GCM with
`ENCRYPTION_KEY`), and `instance.status`. Every subsequent per-instance call
must use `instance.token` — **not** the admin token.

#### Get status

Verified live: `GET /instance/status`. Auth is the per-instance token, not
admin.

```
GET /instance/status
Headers: { "token": "<instanceToken>" }
Response: {
  "instance": { "status": "connected" | "connecting" | "disconnected",
                "qrcode": "data:image/png;base64,..." | "", ... },
  "loggedIn": boolean
}
```

The live enum values are **exactly** `connected | connecting | disconnected`
— there is no `qr` / `qrcode` status in the response (the QR payload travels
alongside as `instance.qrcode` while `status` stays `connecting`). The client
still normalises everything via `InstanceStatusSchema` and falls back to the
`loggedIn` boolean when the string is missing.

#### Connect / get QR code

Verified live: `POST /instance/connect` with an empty JSON body, per-instance
token. Response envelope on the live server:

```
POST /instance/connect
Headers: { "token": "<instanceToken>" }
Body:    {}
Response (live):
{
  "connected": false,
  "instance": {
    "id": "...",
    "token": "...",
    "status": "connecting",
    "qrcode": "data:image/png;base64,iVBORw0KGgoAAA..."   // INCLUDES prefix
  },
  ...
}
```

**QR format quirk**: the live server returns the QR already wrapped as a data
URL (`data:image/png;base64,<...>`). The `UazapiClient` strips the prefix in
`extractQrBase64` so downstream code can re-add it exactly once. API routes
and the UI treat the stored value as raw base64 and build `<img src="data:image/png;base64,..." />`
themselves.

Legacy shapes still handled for resilience (peer gateways / older UAZAPI
builds):
```
{ "qrcode": "<raw base64>" }
{ "base64": "<raw base64>" }
{ "status": "connected", "loggedIn": true }           // already connected, no QR
```

If the instance is already connected, `instance.qrcode` comes back as `""`
and `status === "connected"` — callers should branch on status before
trying to render.

#### List all instances (admin)

```
GET /instance/all
Headers: { "admintoken": "<admin>", "token": "<admin>" }
Response: Instance[]
```

Useful for reconciliation jobs and orphan detection.

#### Delete instance

Verified live: `DELETE /instance` (no `:id` segment) with the **per-instance
token**, NOT the admin token. This was the single most surprising finding
during the Fase-2 probe — the admin token returns `401 Invalid token` on
this path.

```
DELETE /instance
Headers: { "token": "<instanceToken>" }
Response: {
  "info": "The device has been successfully disconnected and the instance has been deleted from the database.",
  "response": "Instance Deleted"
}
```

Other variants **tested and rejected** on the live server (documented so
nobody wastes time rediscovering this):

| Attempt                          | Result                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `DELETE /instance/<id>`          | `405 Method Not Allowed`                                |
| `POST /instance/logout`          | `405 Method Not Allowed`                                |
| `POST /instance/remove`          | `405 Method Not Allowed`                                |
| `DELETE /instance` w/ admintoken | `401 Invalid token`                                     |
| `POST /instance/disconnect`      | Works, but **only** transitions to `disconnected` — row stays. Use for soft-reset, not delete. |

Implication for our storage model: deleting an instance from UAZAPI does
NOT cascade — we must delete (or mark `deleted_at`) the `whatsapp_instances`
row in the same API route.

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

Webhooks are scoped per-instance. The exact endpoint was verified live on
2026-04-22; the envelope fields below for incoming events still reflect the
skill + peer-gateway conventions and should be reconfirmed against a real
scanned instance in Fase 4 (not reachable without completing QR pairing).

#### List webhook config

Verified live: `GET /webhook` with the per-instance token. Note the
singular, unprefixed path — `GET /instance/webhook` returns `404`.

```
GET /webhook
Headers: { "token": "<instanceToken>" }
Response: [
  {
    "id": "...",
    "url": "https://podzap.app/api/webhooks/uazapi",
    "events": ["messages", "connection"],
    "enabled": true,
    "addUrlEvents": false,
    "addUrlTypesMessages": false,
    "excludeMessages": []
  }
]
```

Returns an **array** — UAZAPI allows multiple webhook URLs per instance,
though our integration registers a single one.

#### Register / upsert webhook

Verified live: `POST /webhook`. Response is the updated array of configs.

```
POST /webhook
Headers: { "token": "<instanceToken>", "Content-Type": "application/json" }
Body:    {
  "url": "https://podzap.app/api/webhooks/uazapi",
  "events": ["messages", "connection"],
  "enabled": true,
  "addUrlEvents": false,
  "addUrlTypesMessages": false,
  "excludeMessages": []
}
```

Observed event names from the live probe: `messages`, `connection`. The
skill also mentions `status` and the wildcard `all` but neither was
round-tripped — handle unknown event strings defensively in the webhook
route.

Our single webhook route fans-out by `event` / `type` / `EventType` and
accepts **two** envelope shapes (see `MessageUpsertEventSchema` in
`lib/uazapi/types.ts`):

1. **UAZAPI wsmart shape** — what `wsmart.uazapi.com` actually delivers in
   production (captured live 2026-04-23 via the n8n forwarding flow).
   This is the canonical path.
2. **Evolution/Baileys shape** — what the first pass of Fase 4 was built
   against, before a real scanned instance was available. Kept alive as
   a fallback so existing fixtures and legacy integrations keep working;
   new code should target the wsmart shape.

#### Incoming message envelope (text) — UAZAPI wsmart shape

```json
{
  "BaseUrl": "https://wsmart.uazapi.com",
  "EventType": "messages",
  "instanceName": "podzap-13d4eb57-1776932610527",
  "chat": {
    "wa_chatid": "120363012345678@g.us",
    "wa_isGroup": true,
    "name": "Group Name"
  },
  "message": {
    "messageid": "3EB089F8ECEDAC7A9E4BFD",
    "id": "558193856099:3EB089F8ECEDAC7A9E4BFD",
    "chatid": "120363012345678@g.us",
    "fromMe": false,
    "sender": "27578253496368:37@lid",
    "senderName": "Soyaux",
    "messageTimestamp": 1776993684000,
    "messageType": "Conversation",
    "type": "text",
    "text": "Hello from WhatsApp",
    "content": "Hello from WhatsApp",
    "wasSentByApi": false
  },
  "owner": "558193856099",
  "token": "88ffe2b8-095c-4942-b37d-a8d365187b55"
}
```

Field normalisation (wsmart → internal):

| internal (`MessageUpsertEvent`) | source on the wire | notes |
|---|---|---|
| `event`                   | literal `"message"`                     | discriminator |
| `instance`                | `instanceName` (fallback `token`)       | **routes to `whatsapp_instances` — see instance lookup below** |
| `key.id`                  | `message.messageid` (fallback `message.id`) | dedup key |
| `key.remoteJid`           | `message.chatid` (fallback `chat.wa_chatid`) |  |
| `key.fromMe`              | `message.fromMe`                         |  |
| `key.participant`         | `message.sender`                         | LID-format sender |
| `pushName`                | `message.senderName`                     |  |
| `timestamp`               | `message.messageTimestamp`               | already in ms on the wire; values `< 10^10` are multiplied by 1000 for paridade with the Evolution shape |
| `content.kind="text"`     | `message.type === "text"` OR `messageType ∈ {Conversation, ExtendedText, ExtendedTextMessage}` (sufixo `Message` opcional, case-insensitive) | text body from `message.text` / `message.content` / `message.extendedTextMessage.text` |
| `content.kind="audio"`    | `message.type === "audio"` OR `messageType` casa `^audio` / `^ptt` (sufixo `Message` opcional) | URL/mimetype/seconds extraídos defensivamente: tenta `m.url`, `m.mediaUrl`, `m.audioMessage.url`. Quando nenhum bate, row vai pro DB com `media_url=null` + `media_download_status=skipped`; worker `transcribe-audio` bail-out clean ("media not downloaded yet"). |
| `content.kind="image"`    | `message.type === "image"` OR `messageType` casa `^image` (sufixo opcional) | mesma lógica — URL/caption/dimensões com fallbacks. |
| `content.kind="video"`    | `message.type === "video"` OR `messageType` casa `^video` (sufixo opcional) | idem; mas pipeline de vídeo ainda é pós-MVP |
| `content.kind="other"`    | qualquer outro `messageType` (Reaction, Sticker, Contact, Document, Poll…) | preserva `rawType` original pra audit log |

##### Instance lookup (lookup precedence)

The wsmart envelope does **not** include the short internal id that we
used to store as `whatsapp_instances.uazapi_instance_id` (e.g.
`"r096894b4a51062"`). Migration
[`0009_uazapi_instance_name.sql`](../../db/migrations/0009_uazapi_instance_name.sql)
added a nullable `uazapi_instance_name` column for the `instanceName`
and backfilled the single pre-existing production row.
`lib/webhooks/persist.ts::findInstanceByUazapiRef` looks up in this
order:

1. `eq("uazapi_instance_name", event.instance)` — prod path. Matches on
   the `instanceName` the webhook carries.
2. `eq("uazapi_instance_id", event.instance)` — legacy / Evolution-shape
   fallback. Matches on the short id for rows created before the
   migration (or fixtures still using the old envelope).

Both queries are issued sequentially with `.eq()` rather than `.or()`
so the externally-provided ref can't smuggle PostgREST grammar.

#### Incoming message envelope (text) — Evolution / Baileys shape (legacy)

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

#### Audio / Image / Video — status

> **Implementado em 2026-04-25.** O parser
> `normaliseUazapiMessageContent` em `lib/uazapi/types.ts` classifica
> AudioMessage / ImageMessage / VideoMessage / ExtendedTextMessage no
> `kind` correto. Sinais (por prioridade): `m.mediaType` ('ptt'/'image'/
> 'video') → `m.messageType` (strip "Message" + lowercase) → `m.type`.
> Extração de URL/mimetype lê de `m.content.{URL,mimetype,seconds,PTT,
> fileLength,caption,width,height}` (shape real wsmart, **keys em
> MAIÚSCULAS**). Fallbacks defensivos: `m.url`, `m.mediaUrl`,
> `m.audioMessage.url`, `m.imageMessage.caption`, etc.
>
> **Forensic:** desde 2026-04-25 `messages.raw_payload` armazena o **body
> cru** da request HTTP (não mais o evento normalizado pelo Zod). Quando
> uma mensagem nova chegar com shape inesperada, dá pra inspecionar o JSON
> original via `select raw_payload from messages where id = '…'` e refinar
> o parser sem precisar reproduzir o webhook.
>
> **Limitação:** rows criadas ANTES de 2026-04-25 têm `raw_payload` = evento
> normalizado, então URLs/mimetype dos media originais foram perdidos —
> backfill retroativo pra audio/image existentes não é possível.
>
> **Behavior quando o parser classifica audio/image mas não acha URL:**
> a row vai pro DB com `type=audio|image` + `media_url=null` +
> `media_download_status=skipped`. O worker `transcribe-audio` /
> `describe-image` faz bail-out clean ("media not downloaded yet") sem
> consumir Groq/Gemini. Quando o `retry-pending-downloads` cron rodar
> próxima vez ele ignora `skipped` (não é `pending`), então não há retry
> storm.

#### Audio — Evolution / Baileys shape (legacy / fixtures only)

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
`{ id, return_link: true, generate_mp3: true }`. **Implementado em
2026-04-25** — ver §Media decryption abaixo.

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

#### Media decryption (`/message/download`)

> Implementado em 2026-04-25 (commit `739dc48`).

WhatsApp transmite mídia (audio/image/video) como blobs **AES-encrypted**
hosted em `mmg.whatsapp.net/v/...enc`. Pra ler, precisa do `mediaKey` +
HKDF + AES-CBC + sidecar handling. UAZAPI faz isso server-side e expõe
um endpoint que devolve URL plain hosted no CDN deles.

**Endpoint:**
```
POST /message/download
Header: token: <instance-token>
Body:   { id: "<whatsapp-messageid>", return_link: true, generate_mp3?: false }
Resp:   { fileURL: "https://wsmart.uazapi.com/files/<sha256>.ogg",
          mimetype: "audio/ogg",
          fileSize?: 15687 }
```

- `return_link: true` (recomendado) — recebe URL ao invés de bytes base64;
  permite stream + cap de tamanho no downloader.
- `generate_mp3: false` (default) — Whisper Large v3 lê ogg/opus
  nativamente, transcode adiciona latência sem benefício.
- A URL retornada é estável (hash do conteúdo); pode cachear.

**Plumbing no código:**
1. `lib/uazapi/client.ts::downloadMedia(token, msgId, opts?)` — wrapper
2. `lib/media/download.ts::DownloadOpts.uazapiResolve` — `{ instanceToken,
   whatsappMessageId }`. Quando URL é WhatsApp `.enc` E opts presente,
   downloader chama UAZAPI primeiro
3. `lib/webhooks/persist.ts::loadUazapiResolveOpts` — busca + decripta
   `whatsapp_instances.uazapi_token_encrypted` via `lib/crypto`. Plumba
   pra `downloadAndStore`
4. Workers `retry-pending.ts` e `media-download-retry.ts` replicam o
   mesmo lookup (precisam pra rows stale)

**Erros:**
- URL `.enc` sem `uazapiResolve` opt → fail rápido com reason descritivo
  (antes ia tentar fetch direto que falhava com 4xx genérico)
- `downloadMedia` retorna `fileURL` vazio → `UazapiError BAD_RESPONSE`
- Token decrypt falha → log warn, `uazapiResolve = undefined`, downloader
  vai falhar com erro descritivo

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

> Official per-endpoint quotas remain undocumented. See §6 for our internal
> mitigation (token bucket + per-tenant in-memory limiter).

---

## 4. QR → connected flow (ASCII sequence)

Reflects the **live-verified** 2-token model: the admin token only rides
`POST /instance/init`; everything after that uses the per-instance token
returned in the init response.

```
User           Next.js API             UazapiClient            UAZAPI             WhatsApp phone
 |                |                       |                      |                      |
 | click "Connect"|                       |                      |                      |
 |--------------->|                       |                      |                      |
 |                | createInstance(name)  |                      |                      |
 |                |---------------------->|                      |                      |
 |                |                       | POST /instance/init                         |
 |                |                       |  Header: admintoken=<admin>                  |
 |                |                       |--------------------->|                      |
 |                |                       |<-- {instance:{id,   |                      |
 |                |                       |    token:<INSTANCE>,|                      |
 |                |                       |    status:"disconnected"}}                  |
 |                |<-- Instance ----------|                      |                      |
 |                | encrypt token + INSERT whatsapp_instances (status='connecting')     |
 |                |                                                                     |
 |                | getQrCode(instanceToken)                                             |
 |                |---------------------->|                      |                      |
 |                |                       | POST /instance/connect                      |
 |                |                       |  Header: token=<INSTANCE>                   |
 |                |                       |  Body:   {}                                 |
 |                |                       |--------------------->|                      |
 |                |                       |<-- {instance:{status:"connecting",         |
 |                |                       |    qrcode:"data:image/png;base64,..."}}    |
 |                |                       | (client strips "data:" prefix)              |
 |                |<-- {qrCodeBase64,     |                      |                      |
 |                |     status:"connecting"}                                            |
 | render QR (re-adds "data:image/png;base64," prefix for <img src>)                    |
 |<---------------|                                                                     |
 | scan with phone                                                                      |
 |------------------------------------------------------------------------------- scan >|
 |                |                                                                     |
 |                | [webhook] POST /api/webhooks/uazapi  event=connection  (Fase 4)     |
 |                |<--------------------------------------------|                      |
 |                |  status=connected                                                   |
 |                | UPDATE whatsapp_instances SET status='connected', connected_at=now()|
 |                |                                                                     |
 |   (Fase 2 fallback: Next.js polls GET /instance/status every 2-3s until 'connected') |
 |                | getInstanceStatus(instanceToken)                                    |
 |                |---------------------->|                      |                      |
 |                |                       | GET /instance/status |                      |
 |                |                       |  Header: token=<INSTANCE>                   |
 |                |                       |--------------------->|                      |
 |                |                       |<-- {instance:{status:"connected"},         |
 |                |                       |    loggedIn:true}                           |
 |                |<-- "connected" -------|                      |                      |
 |<-- "connected" |                                                                     |
```

Polling fallback: until the webhook route lands in Fase 4, the client polls
`GET /instance/status` every 2–3s while the QR screen is open, stopping on
`connected` or a 2-minute timeout. The UazapiClient enforces a minimum
interval via an internal token bucket so a runaway polling loop cannot DoS
the upstream.

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

## 6. Resolved vs still-open questions

### Resolved during Fase-2 live probe (2026-04-22)

1. ✅ **Instance create path** → `POST /instance/init` with `admintoken` header.
2. ✅ **Instance delete path** → `DELETE /instance` (no `:id`) with the
   **per-instance token**, not admin. The admin token returns `401` on this
   path. `POST /instance/disconnect` is a different operation (soft-disconnect
   without removing the row).
3. ✅ **Webhook registration endpoint** → `POST /webhook` (GET for read),
   scoped by per-instance token. `GET /instance/webhook` returns `404`.
4. ✅ **Status enum** is exactly `connected | connecting | disconnected`
   (no `qr`). The QR payload travels alongside as `instance.qrcode`.
5. ✅ **QR data-URL format**: the live server returns `data:image/png;base64,...`
   (prefix included). `UazapiClient.extractQrBase64` strips the prefix; API
   routes and UI re-add it exactly once when building the `<img src>`.

### Still open — validate in later phases

1. **Webhook event envelope** (`event` vs `type` vs `action`, nesting of
   `data`). The shapes in §2.4 are from the skill and peer gateways; confirm
   against a real webhook capture once a phone is paired. Scheduled for Fase 4.
2. **Webhook signature / HMAC** — none appears to be documented. Mitigation:
   unguessable URL-secret path segment + IP allowlist of `wsmart.uazapi.com`.
   Re-check whether UAZAPI v2 introduced a signature header.
3. **Rate limits** — no official numbers. Internal mitigation: token bucket
   per instance in `UazapiClient` (≤1 msg/sec, ≤60 msg/min) + 30/min/tenant
   at the API-route layer. Monitor 429s in production.
4. **Audio format for PTT** — OGG/Opus plays natively as voice note; MP3 may
   be silently transcoded or rejected. Confirm by test send during M1.
5. **`generate_mp3` on `/message/download`** — confirm it actually transcodes
   OGG → MP3 (helpful for our "download audio" feature).
