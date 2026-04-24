# podZAP — API Auth Matrix

> Complemento de [`README.md`](./README.md). Tabela densa pra scan rápido: "quais rotas são perigosas se vazarem, quais têm rate limit, o que muda estado?"

## Legenda

**Auth**:
- `cookie` → Supabase session cookie (`requireAuth()` em `_shared.ts`)
- `superadmin` → sessão + bit `public.is_superadmin()` (`requireSuperadminJson()`)
- `webhook-secret` → HMAC header / legacy secret / `?secret=`
- `inngest-sig` → assinado pelo SDK via `INNGEST_SIGNING_KEY`
- `none (dev)` → sem auth, gated por `NODE_ENV !== 'production'`

**Rate-limited**: janela + máx por tenant. `—` quando não tem.

**Idempotent**: repetir a chamada com o mesmo body produz o mesmo estado final.

**Side effects**: DB / Inngest event / UAZAPI / Storage / Auth writes. Só efeitos **persistentes** — reads não contam.

---

## Summaries

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| POST | `/api/summaries/generate` | cookie | 10/h/tenant | ❌ (emite múltiplos eventos se chamado 2x) | `inngest.send(summary.requested)` |
| GET | `/api/summaries` | cookie | — | ✅ (read) | — |
| GET | `/api/summaries/[id]` | cookie | — | ✅ (read) | — |
| PATCH | `/api/summaries/[id]` | cookie | — | ✅ (mesmo texto ⇒ mesmo estado) | UPDATE `summaries.text` |
| POST | `/api/summaries/[id]/approve` | cookie | — | ✅ (já approved ⇒ `409 INVALID_STATE`) | UPDATE `summaries.status`, `inngest.send(summary.approved)` |
| POST | `/api/summaries/[id]/reject` | cookie | — | ✅ | UPDATE `summaries.status` + `rejected_reason` |
| POST | `/api/summaries/[id]/regenerate` | cookie | — | ❌ (cada chamada cria novo pending) | `inngest.send(summary.requested)` |
| GET | `/api/summaries/[id]/audio/signed-url` | cookie | — | ✅ (read) | — |

## Audios

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/audios` | cookie | — | ✅ (read) | — |
| POST | `/api/audios/[id]/redeliver` | cookie | 6/h/tenant | ❌ (cada call envia áudio de novo) | UAZAPI `/send/media`, UPDATE `audios.delivered_at` |

## Schedules

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/schedules` | cookie | — | ✅ (read) | — |
| POST | `/api/schedules` | cookie | — | ❌ (2º POST ⇒ 409 CONFLICT — UNIQUE group_id) | INSERT `schedules` |
| GET | `/api/schedules/[id]` | cookie | — | ✅ (read) | — |
| PATCH | `/api/schedules/[id]` | cookie | — | ✅ (mesmo body ⇒ mesmo estado) | UPDATE `schedules` |
| DELETE | `/api/schedules/[id]` | cookie | — | ✅ (2º DELETE ⇒ 404) | DELETE `schedules` |

## Groups

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/groups` | cookie | — | ✅ (read) | — |
| POST | `/api/groups/sync` | cookie | 6/min/tenant | ✅ (upsert — re-executável com mesmo resultado) | UAZAPI `/group/list`, bulk UPSERT `groups` |
| POST | `/api/groups/[id]/monitor` | cookie | — | ✅ | UPDATE `groups.is_monitored` |

## WhatsApp

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| POST | `/api/whatsapp/connect` *(deprecated)* | cookie | — | ✅ (re-uso se já connected) | UAZAPI `POST /instance/init`, INSERT `whatsapp_instances` |
| GET | `/api/whatsapp/status` | cookie | 30/min/tenant | ✅ (refresh idempotente) | (pode) UPDATE `whatsapp_instances.status` |
| GET | `/api/whatsapp/qrcode` | cookie | 30/min/tenant | ✅ | (pode) UPDATE `whatsapp_instances.qr_code` |
| POST | `/api/whatsapp/disconnect` | cookie | — | ✅ (2ª chamada = no-op) | UAZAPI `DELETE /instance`, UPDATE DB |

## Webhooks

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/webhooks/uazapi` | **NENHUMA** (health check) | — | ✅ | — |
| POST | `/api/webhooks/uazapi` | webhook-secret | — | ❌ (mensagem duplicada ⇒ row duplicado se não dedup by provider id) | INSERT `messages`, `inngest.send(message.captured)`, (evento conn) UPDATE instance |
| POST | `/api/webhooks/test` | none (dev) | — | ❌ | MESMOS do handler real |

> `GET /api/webhooks/uazapi` é **intencionalmente sem auth** — UAZAPI pinga pra validar URL antes de registrar. Só devolve `{ ok: true }`, sem dados sensíveis.

## History / Settings

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/history` | cookie | — | ✅ (read) | — |
| GET | `/api/settings` | cookie | — | ✅ (read) | — |
| PATCH | `/api/settings` | cookie | — | ✅ | UPDATE `tenants.include_caption_on_delivery` / `delivery_target` |

## Inngest

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET / POST / PUT | `/api/inngest` | inngest-sig | — | varia por função | executa workers (TTS, delivery, summary, schedules, …) |

## Admin — Tenants

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/admin/tenants` | superadmin | — | ✅ | — |
| POST | `/api/admin/tenants` | superadmin | — | ❌ | INSERT `tenants` |
| GET | `/api/admin/tenants/[id]` | superadmin | — | ✅ | — |
| PATCH | `/api/admin/tenants/[id]` | superadmin | — | ✅ | UPDATE `tenants` |
| DELETE | `/api/admin/tenants/[id]` | superadmin | — | ✅ (2º ⇒ 404) | **HARD DELETE cascade** (irreversível) |
| POST | `/api/admin/tenants/[id]/suspend` | superadmin | — | ✅ | UPDATE `tenants.is_active=false` |
| DELETE | `/api/admin/tenants/[id]/suspend` | superadmin | — | ✅ | UPDATE `tenants.is_active=true` |

## Admin — Users

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/admin/users` | superadmin | — | ✅ | — |
| POST | `/api/admin/users` | superadmin | — | ❌ | `auth.users.create`, INSERT `tenant_members` (rollback on failure) |
| GET | `/api/admin/users/[id]` | superadmin | — | ✅ | — |
| PATCH | `/api/admin/users/[id]` | superadmin | — | ✅ | UPDATE `tenant_members` e/ou `superadmins` |
| DELETE | `/api/admin/users/[id]` | superadmin | — | ✅ (2º ⇒ 404) | `auth.users.delete` + cascade |
| POST | `/api/admin/users/[id]/password` | superadmin | — | ✅ (reseta pra mesma senha ⇒ mesmo estado) | `auth.users.updateUserById({password})` |

## Admin — UAZAPI

| Método | Path | Auth | Rate limit | Idempotent | Side effects |
|---|---|---|---|---|---|
| GET | `/api/admin/uazapi/instances` | superadmin | — | ✅ | — |
| POST | `/api/admin/uazapi/attach` | superadmin | — | ❌ (2ª ⇒ 409 CONFLICT) | INSERT `whatsapp_instances` (com token encriptado) |
| DELETE | `/api/admin/uazapi/attach/[tenantId]` | superadmin | — | ✅ (2ª ⇒ 404) | **DELETE cascade** em groups/messages/etc |
| POST | `/api/admin/uazapi/create-and-attach` | superadmin | — | ❌ | UAZAPI `POST /instance/init`, INSERT `whatsapp_instances` |

---

## 🚨 "Quais rotas são perigosas se vazarem?"

### Tier 1 — catastrófico (hard delete / cross-tenant)

| Path | Impacto |
|---|---|
| `DELETE /api/admin/tenants/[id]` | Apaga tenant + todo conteúdo. Irreversível. |
| `DELETE /api/admin/users/[id]` | Apaga user. |
| `DELETE /api/admin/uazapi/attach/[tenantId]` | Cascade em todo conteúdo do tenant. |
| `POST /api/admin/users` com `isSuperadmin: true` | Promove user a staff — acesso cross-tenant global. |
| `PATCH /api/admin/users/[id]` com `isSuperadmin: true` | Idem. |
| `POST /api/admin/users/[id]/password` | Sequestra conta alheia. |

**Proteção**: triple gate (proxy + layout + route handler). `public.is_superadmin()` é SQL function security-definer; não-superadmin nunca chega aqui.

### Tier 2 — destrutivo dentro do tenant

| Path | Impacto |
|---|---|
| `POST /api/whatsapp/disconnect` | Derruba instância WhatsApp do tenant. |
| `DELETE /api/schedules/[id]` | Para envio automático. |
| `POST /api/groups/[id]/monitor` com `on:false` | Tira grupo do pipeline. |

**Proteção**: cookie auth + tenant scoping no service layer.

### Tier 3 — abuso de custo / rate (não estraga dado, queima $$)

| Path | Custo se abusado |
|---|---|
| `POST /api/summaries/generate` | Gemini 2.5 Pro ≈ $0.005–0.02/call. **10/h/tenant**. |
| `POST /api/summaries/[id]/regenerate` | Idem (conta como generate). Sem rate limit próprio! |
| `POST /api/audios/[id]/redeliver` | UAZAPI send — queima reputação do número. **6/h/tenant**. |
| `POST /api/groups/sync` | UAZAPI `/group/list`. **6/min/tenant**. |
| `GET /api/whatsapp/status` / `/qrcode` | Polling. **30/min/tenant**. |

**⚠ Gap conhecido**: `regenerate` emite `summary.requested` igualzinho ao `generate` mas **não tem rate limit próprio**. Alguém que controla a UI (ou bate direto na API) pode burlar o limite de 10/h do `generate` via `regenerate`. Issue aberta — tracked como débito pós-MVP.

### Tier 4 — webhook shared-secret

| Path | Impacto se secret vazar |
|---|---|
| `POST /api/webhooks/uazapi` | Atacante injeta mensagens fake no DB. Sem secret rotation automática. |

**Mitigação**: trocar `UAZAPI_WEBHOOK_HMAC_SECRET` força o UAZAPI re-registrar. HMAC é preferido sobre o header/query legacy.

---

## Inconsistências / Surpresas (para futuro refactor)

1. **Dois `_shared.ts`**: `app/api/whatsapp/_shared.ts` (source of truth, importado por ~20 rotas incluindo `/summaries`, `/schedules`, etc) e `app/api/admin/_shared.ts` (admin-específico). O primeiro sofre de nome ruim — deveria ser `app/api/_shared.ts`.
2. **`POST /api/whatsapp/connect` é deprecated** mas ainda existe. Débito Fase 14: deletar + remover `startConnectAction`.
3. **`regenerate` sem rate limit próprio** (ver Tier 3 acima). Provavelmente usar a mesma chave `summary-generate`.
4. **`GET /api/webhooks/uazapi`** é health check sem auth — único GET sem auth fora de `webhooks/test` (que é dev-only).
5. **`DELETE /api/admin/tenants/[id]/suspend`** usa método HTTP DELETE para **reativar** — semanticamente invertido (DELETE = remover suspensão). Funcionalmente correto mas surpresa ao ler a tabela de rotas.
6. **`/api/history`** devolve signed URLs de mídia em loop (`Promise.all`) sem batching — 50 round-trips ao Storage por request. Performance OK hoje (~100ms em dev) mas degrada se history subir.
7. **`POST /api/summaries/[id]/approve`** emite evento *após* commit do DB. Se `inngest.send` falhar, row fica approved sem TTS em voo — comentário no handler admite isso e sugere re-trigger manual como recovery.
8. **Rate limit in-memory** não sobrevive a restart nem replica entre containers. Em Hetzner/Portainer com 1 replica isso funciona; com scale horizontal vira problema.
