# podZAP — API Reference

> Última atualização: 2026-04-23 · fonte: `app/api/**/route.ts` (MVP Fase 13).

Referência humano-legível das rotas HTTP do podZAP. Todas as rotas são **Next.js App Router route handlers** sob `app/api/*`. Para documentação complementar por subsistema, ver `docs/integrations/*.md`. Matriz resumida de auth/rate-limit/idempotência em [`auth-matrix.md`](./auth-matrix.md).

---

## Base URL

| Ambiente | URL |
|---|---|
| Produção | `https://podzap.wsmart.com.br` |
| Staging | `https://staging.podzap.wsmart.com.br` |
| Dev local | `http://localhost:3001` |

> Em dev, o Next.js escuta em `3001` (convenção do projeto, não `3000`). Corrigir também o webhook do UAZAPI para `http://<ngrok>/api/webhooks/uazapi`.

---

## Modelo de autenticação

| Tipo | Rotas | Como funciona |
|---|---|---|
| **Session cookie** (Supabase Auth) | `/api/summaries/*`, `/api/audios/*`, `/api/groups/*`, `/api/schedules/*`, `/api/whatsapp/*`, `/api/settings`, `/api/history` | `requireAuth()` em `app/api/whatsapp/_shared.ts` → `getCurrentUserAndTenant()`. Sem cookie ⇒ `401 UNAUTHORIZED`. Tenant é resolvido do membership do user. |
| **Superadmin bit** | `/api/admin/*` | `requireSuperadminJson()` em `app/api/admin/_shared.ts`. Verifica `public.is_superadmin()` no Postgres. Sem sessão ⇒ `401`, sessão sem bit ⇒ `403 FORBIDDEN`. |
| **Webhook secret** | `/api/webhooks/uazapi` (POST) | HMAC-SHA256 em `x-podzap-signature` (preferido) OU legacy `x-uazapi-secret` header / `?secret=` query. Segredos em `UAZAPI_WEBHOOK_HMAC_SECRET` / `UAZAPI_WEBHOOK_SECRET`. Fail-closed se ambos ausentes (`500 SERVER_MISCONFIG`). |
| **Inngest signing** | `/api/inngest` | SDK assina internamente com `INNGEST_SIGNING_KEY`. Excluído do matcher do `proxy.ts`. |
| **Nenhum (dev-only)** | `/api/webhooks/test` | Hard-gated por `NODE_ENV !== 'production'` — em prod retorna `404`. |

### Envelope padrão

**Sucesso** — varia por rota, mas o padrão é um objeto nomeado pelo recurso:
```json
{ "summary": { ... } }
{ "audios": [ ... ] }
{ "ok": true }
```

**Erro** — sempre:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "`groupId` must be a UUID.",
    "details": { "...opcional..." }
  }
}
```

Codes canônicos (ver `app/api/whatsapp/_shared.ts#ErrorCode`):
`UNAUTHORIZED | FORBIDDEN | NOT_FOUND | RATE_LIMITED | UAZAPI_ERROR | TTS_ERROR | VALIDATION_ERROR | INTERNAL_ERROR | NO_INSTANCE | INSTANCE_NOT_CONNECTED | INVALID_STATE | ALREADY_EXISTS | CONFLICT | AUTH_ERROR | DELIVERY_ERROR`

Admin subconjunto: `UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT | VALIDATION_ERROR | UAZAPI_ERROR | INTERNAL_ERROR`.

### Rate limiting

In-memory `Map` por processo em `lib/ratelimit.ts`. Chave: `tenant:<id>:<routeName>`. Fixed-window (não sliding). Sobrevive a `npm run dev` mas reseta em redeploy. **TODO pós-MVP**: trocar por Upstash/Redis.

Todas as respostas `429` incluem header `Retry-After` (segundos) e campo `details.retryAfterMs`.

---

## Sumário de rotas

| # | Método | Path | Domínio |
|---|---|---|---|
| 1 | POST | `/api/summaries/generate` | Summaries |
| 2 | GET | `/api/summaries` | Summaries |
| 3 | GET / PATCH | `/api/summaries/[id]` | Summaries |
| 4 | POST | `/api/summaries/[id]/approve` | Summaries |
| 5 | POST | `/api/summaries/[id]/reject` | Summaries |
| 6 | POST | `/api/summaries/[id]/regenerate` | Summaries |
| 7 | GET | `/api/summaries/[id]/audio/signed-url` | Summaries/Audio |
| 8 | GET | `/api/audios` | Audios |
| 9 | POST | `/api/audios/[id]/redeliver` | Audios |
| 10 | GET | `/api/schedules` | Schedules |
| 11 | POST | `/api/schedules` | Schedules |
| 12 | GET / PATCH / DELETE | `/api/schedules/[id]` | Schedules |
| 13 | GET | `/api/groups` | Groups |
| 14 | POST | `/api/groups/sync` | Groups |
| 15 | POST | `/api/groups/[id]/monitor` | Groups |
| 16 | POST | `/api/whatsapp/connect` | WhatsApp *(deprecated)* |
| 17 | GET | `/api/whatsapp/status` | WhatsApp |
| 18 | GET | `/api/whatsapp/qrcode` | WhatsApp |
| 19 | POST | `/api/whatsapp/disconnect` | WhatsApp |
| 20 | GET / POST | `/api/webhooks/uazapi` | Webhooks |
| 21 | POST | `/api/webhooks/test` | Webhooks *(dev-only)* |
| 22 | GET | `/api/history` | History |
| 23 | GET / PATCH | `/api/settings` | Settings |
| 24 | GET / POST / PUT | `/api/inngest` | Inngest |
| 25 | GET / POST | `/api/admin/tenants` | Admin/Tenants |
| 26 | GET / PATCH / DELETE | `/api/admin/tenants/[id]` | Admin/Tenants |
| 27 | POST / DELETE | `/api/admin/tenants/[id]/suspend` | Admin/Tenants |
| 28 | GET / POST | `/api/admin/users` | Admin/Users |
| 29 | GET / PATCH / DELETE | `/api/admin/users/[id]` | Admin/Users |
| 30 | POST | `/api/admin/users/[id]/password` | Admin/Users |
| 31 | GET | `/api/admin/uazapi/instances` | Admin/UAZAPI |
| 32 | POST | `/api/admin/uazapi/attach` | Admin/UAZAPI |
| 33 | DELETE | `/api/admin/uazapi/attach/[tenantId]` | Admin/UAZAPI |
| 34 | POST | `/api/admin/uazapi/create-and-attach` | Admin/UAZAPI |

**Contagem**: 34 rotas (23 arquivos `route.ts`, muitos expondo >1 método HTTP).

---

# Summaries

Geração, listagem e moderação humana dos resumos (Fase 7–8).

## POST /api/summaries/generate

Dispara a geração de um resumo para um grupo numa janela temporal. O handler **não** chama Gemini inline — ele emite o evento Inngest `summary.requested` e retorna `202`. O worker `generate-summary` faz o trabalho pesado (10–30s).

**Auth**: session cookie. **Rate limit**: 10 / h / tenant (chave `tenant:<id>:summary-generate`).

**Side effects**: `inngest.send('summary.requested', …)`.

### Request
```http
POST /api/summaries/generate
Content-Type: application/json
Cookie: sb-access-token=...; sb-refresh-token=...

{
  "groupId": "d4f3e1c0-0ab9-4a71-9f7e-5d0b3e812c44",
  "periodStart": "2026-04-22T00:00:00-03:00",
  "periodEnd":   "2026-04-23T00:00:00-03:00",
  "tone": "fun"
}
```

`tone` default é `"fun"`. Valores válidos: `formal | fun | corporate`. `periodEnd` deve ser estritamente depois de `periodStart`.

### Response — 202 Accepted
```json
{ "ok": true, "dispatched": true }
```

### Response — 429 Too Many Requests
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Retry in 2873s.",
    "details": { "retryAfterMs": 2873451 }
  }
}
```

### Response — 400 Validation
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body.",
    "details": {
      "issues": [
        { "path": ["periodEnd"], "message": "periodEnd must be after periodStart" }
      ]
    }
  }
}
```

---

## GET /api/summaries

Lista resumos do tenant, mais novos primeiro.

**Auth**: session cookie. **Rate limit**: não. **Query params**:

| Param | Tipo | Default |
|---|---|---|
| `groupId` | UUID | — |
| `status` | `pending_review` / `approved` / `rejected` | — |
| `limit` | int em `[1, 100]` | 20 |

### Request
```http
GET /api/summaries?status=pending_review&limit=10
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{
  "summaries": [
    {
      "id": "8b2c5a7f-1e3d-4a98-b0c1-f2e7d9a4b6c3",
      "tenantId": "a1b2c3d4-...",
      "groupId": "d4f3e1c0-...",
      "status": "pending_review",
      "text": "Hoje rolou debate sobre deploy...",
      "topics": ["deploy", "CI/CD", "postgres"],
      "estimatedMinutes": 2,
      "tone": "fun",
      "periodStart": "2026-04-22T00:00:00-03:00",
      "periodEnd":   "2026-04-23T00:00:00-03:00",
      "createdAt":   "2026-04-23T10:15:02-03:00"
    }
  ]
}
```

---

## GET /api/summaries/[id]

Busca um resumo específico por id, escopado ao tenant. Retorna `404` tanto para rows inexistentes quanto cross-tenant (não vaza existência).

### Request
```http
GET /api/summaries/8b2c5a7f-1e3d-4a98-b0c1-f2e7d9a4b6c3
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{ "summary": { "id": "8b2c5a7f-...", "status": "pending_review", "text": "...", ... } }
```

## PATCH /api/summaries/[id]

Salva edição manual do texto. Só `pending_review` é editável (approved/rejected são terminais). O service layer revalida: texto não vazio, `< 50000` chars.

### Request
```json
{ "text": "Versão editada do resumo com ajustes no tom..." }
```

### Response — 409 INVALID_STATE
```json
{ "error": { "code": "INVALID_STATE", "message": "Summary is not in pending_review state." } }
```

---

## POST /api/summaries/[id]/approve

Flipa `pending_review → approved` e emite `summary.approved` para o worker TTS (Fase 9). Evento é emitido **depois** do commit do DB — se o send falhar, o row fica approved mas o operador pode disparar o TTS manualmente.

**Side effects**: UPDATE `summaries`, `inngest.send('summary.approved', …)`.

### Request
```http
POST /api/summaries/8b2c5a7f-1e3d-4a98-b0c1-f2e7d9a4b6c3/approve
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{ "summary": { "id": "8b2c5a7f-...", "status": "approved", "approvedAt": "2026-04-23T10:32:15-03:00", ... } }
```

---

## POST /api/summaries/[id]/reject

Flipa `pending_review → rejected`. Reason obrigatório, persistido em `rejected_reason`. Sem evento downstream — rejection é terminal.

### Request
```json
{ "reason": "Faltou contexto do segundo tópico; regenerar com mais mensagens." }
```

### Response — 200 OK
```json
{ "summary": { "id": "...", "status": "rejected", "rejectedReason": "Faltou contexto..." } }
```

---

## POST /api/summaries/[id]/regenerate

"Tenta de novo esse resumo". Lê o row existente, copia `groupId`/`periodStart`/`periodEnd`, emite novo `summary.requested`. Original fica intocada — reviewer compara lado a lado. `approved` NÃO pode regenerar (`409 INVALID_STATE`).

### Request
```json
{ "tone": "corporate" }
```

`tone` é opcional; default = tom original.

### Response — 200 OK
```json
{ "dispatched": true }
```

---

## GET /api/summaries/[id]/audio/signed-url

Retorna URL assinada (1h de validade) para o WAV gerado pelo TTS. UI faz polling após approve até flipar de `404` para `200`.

### Request
```http
GET /api/summaries/8b2c5a7f-.../audio/signed-url
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{
  "url": "https://supabase.co/storage/v1/sign/audios/a1b2c3d4/2026/8b2c5a7f.wav?token=...",
  "expiresIn": 3600,
  "audio": {
    "id": "f1a2b3c4-...",
    "summaryId": "8b2c5a7f-...",
    "storagePath": "a1b2c3d4/2026/8b2c5a7f.wav",
    "durationSeconds": 127,
    "deliveredToWhatsapp": true
  }
}
```

### Response — 404 Not Found
Áudio ainda não gerado (TTS em voo) OU summary cross-tenant:
```json
{ "error": { "code": "NOT_FOUND", "message": "Audio not found for summary." } }
```

---

# Audios

## GET /api/audios

Lista áudios gerados para o tenant, mais novos primeiro.

**Query**: `?limit=<n>` (default 20, max 100).

### Response — 200 OK
```json
{
  "audios": [
    {
      "id": "f1a2b3c4-...",
      "summaryId": "8b2c5a7f-...",
      "storagePath": "a1b2c3d4/2026/8b2c5a7f.wav",
      "durationSeconds": 127,
      "deliveredToWhatsapp": true,
      "deliveredAt": "2026-04-23T10:34:08-03:00",
      "createdAt":   "2026-04-23T10:33:44-03:00"
    }
  ]
}
```

---

## POST /api/audios/[id]/redeliver

Força re-entrega do áudio para o grupo de origem, mesmo se `delivered_to_whatsapp=true`. Thin wrapper em `lib/delivery/service.redeliver`.

**Rate limit**: 6 / h / tenant (`tenant:<id>:redeliver`).

**Side effects**: chamada UAZAPI `/send/media`, UPDATE `audios`.

### Request
```http
POST /api/audios/f1a2b3c4-.../redeliver
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{
  "delivery": {
    "audioId": "f1a2b3c4-...",
    "deliveredAt": "2026-04-23T11:02:18-03:00",
    "target": "120363000000000000@g.us"
  }
}
```

### Respostas de erro
| Status | Code | Quando |
|---|---|---|
| `404` | `NOT_FOUND` | áudio inexistente / cross-tenant |
| `409` | `NO_INSTANCE` | tenant não tem instância WhatsApp |
| `409` | `INSTANCE_NOT_CONNECTED` | instância existe mas status ≠ `connected` |
| `502` | `UAZAPI_ERROR` | UAZAPI recusou o envio |
| `429` | `RATE_LIMITED` | > 6 redeliveries em 1h |

---

# Schedules

Agendamento automático de resumos (Fase 11). Schema `schedules`: 1 row/grupo, `UNIQUE(group_id)`.

## GET /api/schedules

Lista todas os schedules do tenant.

### Response — 200 OK
```json
{
  "schedules": [
    {
      "id": "c5d6e7f8-...",
      "tenantId": "a1b2c3d4-...",
      "groupId":  "d4f3e1c0-...",
      "frequency": "daily",
      "timeOfDay": "08:00",
      "dayOfWeek": null,
      "triggerType": "fixed_time",
      "approvalMode": "required",
      "voice": null,
      "tone": "fun",
      "isActive": true,
      "createdAt": "2026-04-20T14:05:00-03:00",
      "updatedAt": "2026-04-22T09:10:44-03:00"
    }
  ]
}
```

## POST /api/schedules

Cria schedule. `groupId` deve pertencer ao tenant; duplicata em `group_id` ⇒ `409 CONFLICT`.

### Request
```json
{
  "groupId": "d4f3e1c0-0ab9-4a71-9f7e-5d0b3e812c44",
  "frequency": "daily",
  "timeOfDay": "08:00",
  "dayOfWeek": null,
  "triggerType": "fixed_time",
  "approvalMode": "required",
  "voice": null,
  "tone": "fun",
  "isActive": true
}
```

Validação: `timeOfDay` deve casar `/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/`. `dayOfWeek` é `0..6` (Dom-Sáb) ou `null`.

### Response — 201 Created
```json
{ "schedule": { "id": "c5d6e7f8-...", ... } }
```

### Response — 409 Conflict
```json
{ "error": { "code": "CONFLICT", "message": "Group already has an active schedule." } }
```

---

## GET /api/schedules/[id]

Fetch individual. `404` se não encontrado / cross-tenant.

## PATCH /api/schedules/[id]

Partial update. Schema `.strict()` — campos desconhecidos ⇒ `400`. Body aceita qualquer subconjunto de `{ groupId, frequency, timeOfDay, dayOfWeek, triggerType, approvalMode, voice, tone, isActive }`.

### Request
```json
{ "timeOfDay": "09:30", "approvalMode": "auto" }
```

## DELETE /api/schedules/[id]

Remove. `204 No Content` em sucesso.

---

# Groups

## GET /api/groups

Lista grupos do tenant com paginação.

**Query**:
| Param | Tipo | Default |
|---|---|---|
| `monitoredOnly` | `true` \| — | — |
| `search` | string (case-insensitive, substring) | — |
| `page` | int ≥ 0 | 0 |
| `pageSize` | int `[1, 100]` | 20 |

### Response — 200 OK
```json
{
  "groups": [
    {
      "id": "d4f3e1c0-...",
      "uazapiGroupJid": "120363000000000000@g.us",
      "name": "#devs-brasil",
      "pictureUrl": "https://...",
      "isMonitored": true,
      "participantCount": 47
    }
  ],
  "total": 12,
  "page": 0,
  "pageSize": 20
}
```

---

## POST /api/groups/sync

Puxa grupos do UAZAPI e upserta em `groups`. Body ignorado.

**Rate limit**: 6 / min / tenant. **Side effects**: chamada UAZAPI `/group/list`, bulk upsert.

### Response — 200 OK
```json
{ "synced": 12, "total": 12 }
```

### Response — 409 NO_INSTANCE
```json
{ "error": { "code": "NO_INSTANCE", "message": "Tenant has no WhatsApp instance." } }
```

---

## POST /api/groups/[id]/monitor

Toggle `is_monitored` no grupo. Único método que muda qual conteúdo entra no pipeline de resumos.

### Request
```json
{ "on": true }
```

### Response — 200 OK
```json
{ "group": { "id": "d4f3e1c0-...", "isMonitored": true, ... } }
```

---

# WhatsApp

## POST /api/whatsapp/connect

> **⚠ Deprecated desde Fase 13.** Criação de instâncias agora é admin-only (`/api/admin/uazapi/create-and-attach`). A rota ainda existe por compat com clients antigos — **será removida no pós-MVP**. Hoje é idempotente: se tenant já tem instância `connected`, devolve ela sem tocar UAZAPI.

**Body**: `{ name?: string }`.

### Response — 200 OK
```json
{
  "instance": {
    "id": "e9d1c2b3-...",
    "status": "connecting",
    "qrCodeBase64": "iVBORw0KGgoAAAANSUhEUg...",
    "phone": null
  }
}
```

---

## GET /api/whatsapp/status

Polling endpoint — UI faz `setInterval(2s)` durante scan do QR code. Refresca status se `?instanceId=<uuid>`, senão devolve instância atual.

**Rate limit**: 30 / min / tenant.

### Request
```http
GET /api/whatsapp/status?instanceId=e9d1c2b3-7a8b-4c5d-9e0f-1a2b3c4d5e6f
Cookie: sb-access-token=...
```

### Response — 200 OK
```json
{
  "instance": {
    "id": "e9d1c2b3-...",
    "status": "connected",
    "phone": "+55 11 91234-5678",
    "lastCheckedAt": "2026-04-23T10:31:00-03:00"
  }
}
```

Quando tenant não tem instância: `{ "instance": null }`.

---

## GET /api/whatsapp/qrcode

Returns current QR como base64 **sem** prefixo `data:image/png;base64,` (o client adiciona). Se instância já conectada, retorna `{ qrCodeBase64: null, status: "connected" }`.

**Rate limit**: 30 / min / tenant. **Query**: `?instanceId=<uuid>` (obrigatório).

### Response — 200 OK
```json
{
  "qrCodeBase64": "iVBORw0KGgoAAAANSUhEUgAAASwAAAEsCAMAAACf...",
  "status": "connecting"
}
```

---

## POST /api/whatsapp/disconnect

**Body**: `{ instanceId: string }`. Chama `DELETE /instance` no UAZAPI e atualiza DB.

### Response — 200 OK
```json
{ "ok": true }
```

---

# Webhooks

## GET /api/webhooks/uazapi

Health check. UAZAPI pinga quando você registra a URL do webhook.

### Response — 200 OK
```json
{ "ok": true, "service": "webhooks-uazapi" }
```

## POST /api/webhooks/uazapi

Ingestão de eventos do WhatsApp. Body shape: `IncomingWebhookEvent` (`lib/uazapi/types.ts`).

**Auth**: shared secret — em ordem de preferência:
1. `x-podzap-signature: <hex-hmac-sha256>` contra `UAZAPI_WEBHOOK_HMAC_SECRET` + raw body
2. `x-uazapi-secret: <secret>` contra `UAZAPI_WEBHOOK_SECRET`
3. `?secret=<secret>` contra `UAZAPI_WEBHOOK_SECRET`

Exclusivo do matcher de `proxy.ts` — não passa pela auth cookie.

**Latência crítica**: UAZAPI retry se não responder 200 em ~5s. Bugs no handler são **logados + 200 swallowed** para evitar retry storms.

**Side effects**: INSERT `messages`, `inngest.send('message.captured')`, possivelmente UPDATE `whatsapp_instances.status` (evento `connection`).

### Request (evento message/audio)
```http
POST /api/webhooks/uazapi
Content-Type: application/json
x-podzap-signature: 5f2c9b8a7d...

{
  "event": "message",
  "instance": { "id": "uazapi-instance-abc", "token": "..." },
  "data": {
    "id": "BAE5F1A2B3C4D5E6",
    "from": "120363000000000000@g.us",
    "fromMe": false,
    "pushName": "João",
    "timestamp": 1745408170,
    "content": {
      "kind": "audio",
      "mediaUrl": "https://uazapi.com/media/xyz.ogg",
      "mimeType": "audio/ogg; codecs=opus",
      "durationSeconds": 23
    }
  }
}
```

### Response — 200 OK (aceito)
```json
{ "ok": true, "status": "persisted", "cid": "a1b2c3d4" }
```

### Response — 200 OK (swallowed)
Handler threw mas secret+schema passaram — retornamos 200 para não disparar retry:
```json
{ "ok": true, "delivery": "swallowed", "cid": "a1b2c3d4" }
```

### Response — 401 Unauthorized
```json
{ "error": { "code": "UNAUTHORIZED", "message": "Unauthorized." } }
```

---

## POST /api/webhooks/test — dev-only

Replay de fixture (`lib/webhooks/fixtures/*.json`) contra o handler real, sem precisar de ngrok. **Em produção retorna 404**.

### Request
```http
POST http://localhost:3001/api/webhooks/test
Content-Type: application/json

{ "fixture": "audio" }
```

Fixtures aceitas: `text | audio | image | connection | direct | unmonitored`.

Query opcional `?tenant=<uuid>` sobrescreve o tenant resolvido (default: instance mais recentemente atualizada).

### Response — 200 OK
```json
{
  "ok": true,
  "fixture": "audio",
  "context": {
    "tenantId": "a1b2c3d4-...",
    "uazapiInstanceId": "uazapi-instance-abc",
    "groupJid": "120363000000000000@g.us"
  },
  "result": { "status": "persisted", "messageId": "..." }
}
```

---

# History

## GET /api/history

Últimas 50 mensagens capturadas do tenant, com join pra `groups` e `transcripts` + signed URLs para mídia.

**Existe para**: dashboards externos e polling client-side futuro. A página `/history` atualmente usa `router.refresh()` (server component).

### Response — 200 OK
```json
{
  "items": [
    {
      "id": "m1-uuid-...",
      "capturedAt": "2026-04-23T09:58:01-03:00",
      "type": "audio",
      "content": null,
      "senderName": "João",
      "senderJid": "5511991234567@s.whatsapp.net",
      "groupName": "#devs-brasil",
      "groupPictureUrl": "https://...",
      "mediaMimeType": "audio/ogg; codecs=opus",
      "mediaDurationSeconds": 23,
      "mediaSignedUrl": "https://.../audio.ogg?token=...",
      "transcript": {
        "text": "Galera, resolveu aquele bug do deploy?",
        "language": "pt",
        "model": "whisper-large-v3",
        "createdAt": "2026-04-23T09:58:34-03:00"
      }
    }
  ]
}
```

---

# Settings

## GET /api/settings

Lê os 2 knobs de entrega do tenant (`tenants.include_caption_on_delivery`, `tenants.delivery_target`).

### Response — 200 OK
```json
{ "settings": { "includeCaptionOnDelivery": true, "deliveryTarget": "group" } }
```

## PATCH /api/settings

Atualiza um ou ambos. Body deve ter pelo menos um.

### Request
```json
{ "includeCaptionOnDelivery": false, "deliveryTarget": "owner_dm" }
```

`deliveryTarget` ∈ `{group | owner_dm | both}`. Default em DB: `group`.

### Response — 200 OK
```json
{ "settings": { "includeCaptionOnDelivery": false, "deliveryTarget": "owner_dm" } }
```

---

# Inngest

## GET / POST / PUT /api/inngest

Endpoint do Inngest SDK — introspect + invoke das 10 funções registradas:
- `ping` · `describeImage` · `transcribeAudioFunction` · `retryPendingDownloads` · `mediaDownloadRetryWorker` · `transcriptionRetry` · `generateSummaryFunction` · `generateTtsFunction` · `deliverToWhatsappFunction` · `runSchedulesFunction`

**Auth**: SDK assina com `INNGEST_SIGNING_KEY` em prod. Em dev (`INNGEST_DEV=1`) o CLI local conecta sem assinatura. Excluído do `proxy.ts` matcher — não adicione auth aqui.

**Nunca chamar direto** do browser.

---

# Admin (superadmin only)

Todas em `/api/admin/*`. Gated em 3 camadas (proxy → layout → route). Erros seguem envelope diferente (`AdminErrorCode` — subset).

## GET /api/admin/tenants

Lista todos os tenants.

### Response — 200 OK
```json
{
  "tenants": [
    {
      "id": "a1b2c3d4-...",
      "name": "Agência Acme",
      "plan": "pro",
      "isActive": true,
      "createdAt": "2026-03-11T12:00:00Z",
      "memberCount": 3,
      "instanceStatus": "connected"
    }
  ]
}
```

## POST /api/admin/tenants

Cria tenant. `is_active` default `true`.

### Request
```json
{ "name": "Consultoria Alfa", "plan": "free" }
```

### Response — 201 Created
```json
{ "tenant": { "id": "b2c3d4e5-...", "name": "Consultoria Alfa", "plan": "free", "isActive": true } }
```

---

## GET /api/admin/tenants/[id]

### Response — 200 OK
```json
{ "tenant": { "id": "a1b2c3d4-...", "name": "Agência Acme", "members": [...], "instance": {...} } }
```

## PATCH /api/admin/tenants/[id]

**Body**: `{ name?: string, plan?: string }` (ambos opcionais mas pelo menos um).

## DELETE /api/admin/tenants/[id]

**Hard delete**. Cascade em groups / messages / transcripts / summaries / audios / schedules / tenant_members. Irreversível. **Preferir `suspend`**.

### Response — 200 OK
```json
{ "ok": true }
```

---

## POST /api/admin/tenants/[id]/suspend

Seta `is_active=false` — reversível, sem perda de dados. UI impede login de users do tenant enquanto suspenso.

### Response — 200 OK
```json
{ "tenant": { "id": "a1b2c3d4-...", "isActive": false } }
```

## DELETE /api/admin/tenants/[id]/suspend

Reativa (`is_active=true`).

---

## GET /api/admin/users

Lista todos os auth users com seus tenant memberships.

### Response — 200 OK
```json
{
  "users": [
    {
      "id": "u1-uuid-...",
      "email": "albuquerquelivia01@gmail.com",
      "createdAt": "2026-03-11T12:05:00Z",
      "lastSignInAt": "2026-04-23T08:00:14Z",
      "memberships": [
        { "tenantId": "a1b2c3d4-...", "tenantName": "Agência Acme", "role": "owner" }
      ],
      "isSuperadmin": true
    }
  ]
}
```

## POST /api/admin/users

Cria auth user + tenant membership atomicamente. Se `tenant_members.insert` falha, o `auth.users.createUser` é revertido via `supabase.auth.admin.deleteUser` (no user órfão).

### Request
```json
{
  "email": "novo-user@acme.com",
  "password": "s3nhaProvisoria!2026",
  "tenantId": "a1b2c3d4-0f1e-4a2b-9c3d-4e5f6a7b8c9d",
  "role": "member",
  "isSuperadmin": false
}
```

`role` ∈ `{owner | admin | member}`. `isSuperadmin` default `false`.

### Response — 201 Created
```json
{
  "user": {
    "id": "u2-uuid-...",
    "email": "novo-user@acme.com",
    "memberships": [{ "tenantId": "a1b2c3d4-...", "role": "member" }],
    "isSuperadmin": false
  }
}
```

---

## GET /api/admin/users/[id]

## PATCH /api/admin/users/[id]

**Dois shapes** (podem combinar no mesmo request, membership primeiro):

**Membership**:
```json
{ "tenantId": "a1b2c3d4-...", "role": "admin" }
```

**Remove membership**:
```json
{ "tenantId": "a1b2c3d4-...", "remove": true }
```

**Superadmin flag**:
```json
{ "isSuperadmin": true, "note": "Promoção do Dev Lead Q2 2026" }
```

### Response — 200 OK
```json
{ "user": { "id": "u2-uuid-...", ..., "isSuperadmin": true } }
```

## DELETE /api/admin/users/[id]

Hard delete do `auth.users` + cascade em `tenant_members` / `superadmins`.

---

## POST /api/admin/users/[id]/password

Reset manual de senha. Introduzido em Fase 13 — ainda não há fluxo self-service (`/forgot-password` fica pós-MVP).

### Request
```json
{ "password": "N0v4S3nhaL0nga!" }
```

Min 8 chars (enforced no service layer).

### Response — 200 OK
```json
{ "ok": true }
```

---

## GET /api/admin/uazapi/instances

Lista todas as instâncias UAZAPI do gateway, enriched com join no local `whatsapp_instances`. Usado pelo picker de attach.

### Response — 200 OK
```json
{
  "instances": [
    {
      "uazapiInstanceId": "uazapi-instance-abc",
      "name": "Acme WhatsApp Prod",
      "status": "connected",
      "phone": "+55 11 91234-5678",
      "attachedTenant": {
        "id": "a1b2c3d4-...",
        "name": "Agência Acme"
      }
    },
    {
      "uazapiInstanceId": "uazapi-instance-xyz",
      "name": "Orfã",
      "status": "disconnected",
      "attachedTenant": null
    }
  ]
}
```

---

## POST /api/admin/uazapi/attach

Attach instância existente a tenant. Validações em série (`lib/admin/uazapi.attachInstance`):
1. tenant existe + ativo
2. tenant **ainda não tem** instância (1:1 constraint)
3. instância UAZAPI existe no gateway
4. instância **não está** attached em outro tenant

### Request
```json
{
  "uazapiInstanceId": "uazapi-instance-abc",
  "tenantId": "a1b2c3d4-0f1e-4a2b-9c3d-4e5f6a7b8c9d"
}
```

### Response — 200 OK
```json
{ "instance": { "uazapiInstanceId": "uazapi-instance-abc", "attachedTenant": { "id": "a1b2c3d4-..." } } }
```

### Response — 409 CONFLICT
```json
{ "error": { "code": "CONFLICT", "message": "Tenant already has an instance attached." } }
```

---

## DELETE /api/admin/uazapi/attach/[tenantId]

Detach + cascade destrutivo em groups/messages/transcripts/summaries/audios/schedules.

### Response — 204 No Content

(Sem body.)

---

## POST /api/admin/uazapi/create-and-attach

Cria nova instância no UAZAPI + attach ao tenant, em um step. Convenience para onboarding.

### Request
```json
{ "tenantId": "a1b2c3d4-...", "name": "Acme WhatsApp Prod" }
```

### Response — 200 OK
```json
{
  "instance": {
    "uazapiInstanceId": "uazapi-instance-new-xyz",
    "name": "Acme WhatsApp Prod",
    "status": "connecting",
    "attachedTenant": { "id": "a1b2c3d4-...", "name": "Agência Acme" }
  }
}
```

---

## Apêndice: fluxo típico end-to-end

```
1. Superadmin: POST /api/admin/tenants                          → tenant
2. Superadmin: POST /api/admin/users                            → user (owner)
3. Superadmin: POST /api/admin/uazapi/create-and-attach         → instância attached
4. User:       POST /api/whatsapp/disconnect → /connect         (scan QR)
5. User:       POST /api/groups/sync + /api/groups/[id]/monitor (seleciona grupos)
6. User:       POST /api/schedules                              (agenda daily 08:00)
7. — Cron Inngest roda run-schedules → emite summary.requested —
8. UAZAPI webhook → POST /api/webhooks/uazapi                   → messages + message.captured
9. User:       GET  /api/summaries?status=pending_review        (inbox)
10. User:      PATCH /api/summaries/[id] + POST .../approve     (review + aprovar)
11. Worker TTS → audio pronto → delivery worker → WhatsApp do grupo
12. User:      GET  /api/summaries/[id]/audio/signed-url        (player inline)
```

---

> Para contratos internos (worker events Inngest, clients Supabase, encriptação de token UAZAPI), consulte:
> - `docs/integrations/inngest.md` — events canônicos
> - `docs/integrations/uazapi.md` — endpoints UAZAPI + token model
> - `docs/integrations/admin-management.md` — modelo admin-managed
> - `docs/integrations/superadmin.md` — bit de superadmin + RLS helpers
