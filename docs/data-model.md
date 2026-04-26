# Modelo de dados — podZAP

Schema canônico em `lib/supabase/types.ts` (autogerado via `scripts/gen-types.mjs`). Migrations em `db/migrations/0001..0015`.

## Tabelas (todas em `public`, com RLS habilitada)

| Tabela | Função | Colunas-chave |
|---|---|---|
| `tenants` | Isolamento multi-tenant | `is_active`, `plan`, `include_caption_on_delivery`, `delivery_target` |
| `tenant_members` | Liga `auth.users` ↔ `tenants` com role | `role ∈ {owner, member}`, `phone_e164` |
| `superadmins` | Bit global cross-tenant — staff podZAP | `user_id`, `note`. Helper: `public.is_superadmin()` |
| `whatsapp_instances` | Conexão UAZAPI **1:1 por tenant** (UNIQUE) | `uazapi_token_encrypted` (AES-256-GCM), `uazapi_instance_name`, `uazapi_instance_id`, `status`, `phone` |
| `groups` | Grupos sincronizados | `is_monitored` (controla pipeline), `uazapi_group_jid`, `member_count` |
| `messages` | Mensagens capturadas via webhook | `type ∈ {text, audio, image, video, other}`, `media_url`, `media_storage_path`, `media_download_status`, `raw_payload` (body HTTP cru) |
| `transcripts` | Texto de áudio (Groq) ou descrição de imagem (Gemini Vision) | `message_id` (FK), `text`, `language`, `confidence` |
| `summaries` | Resumo gerado pelo LLM | `status ∈ {pending_review, approved, rejected}`, `voice_mode ∈ {single, duo}`, `caption`, `prompt_version`, `period_start`, `period_end` |
| `audios` | WAV final (podcast) | `storage_path`, `delivered_to_whatsapp`, `delivered_at`, `uazapi_delivered_message_id` (distingue podcast vs áudio do owner) |
| `schedules` | Agendamento por grupo | UNIQUE `group_id`, `frequency ∈ {daily, weekly, custom}`, `time_of_day`, `day_of_week`, `approval_mode ∈ {optional, required}` (CHECK 0011 baniu `auto`), `voice`, `tone` |
| `ai_calls` | Custo tracking por chamada | `provider`, `model`, `tokens`, `cost_cents`, `duration_ms`, `summary_id` |

## Relações

```
tenants 1──N tenant_members ──N──1 auth.users
tenants 1──1 whatsapp_instances
tenants 1──N groups ──N──1 messages ──1──1 transcripts
                              │
                              N
                              │
groups ──N──1 schedules       summaries ──1──1 audios
groups ──1──N summaries       summaries ──N──1 ai_calls
```

## Regras invariantes

- **Multi-tenant via RLS**: toda query DEVE respeitar `tenant_id`. Service role bypassa — handlers filtram explicitamente.
- **`is_superadmin()` policies**: expandidas em `tenants`, `tenant_members`, `whatsapp_instances` (migration 0008). Faltam em `groups`, `messages`, `transcripts`, `summaries`, `audios`, `schedules`, `ai_calls` — superadmin não lê dados aplicacionais cross-tenant via PostgREST hoje (só via SQL editor / service_role).
- **`audios.uazapi_delivered_message_id`**: gravado pelo `delivery/service.ts::markDelivered` quando enviamos podcast pro grupo. Webhook `persist.ts` checa antes de skipar `fromMe=true` audios — match → ignora (nossa entrega), no match → processa (áudio do owner).
- **`schedules.approval_mode`**: `auto` ainda existe no enum DB mas CHECK 0011 bloqueia writes. Sempre cai em `pending_review`.
- **`messages.raw_payload`**: armazena body HTTP cru (não evento Zod-normalizado) desde 2026-04-25 — permite refino do parser sem replay de webhook.

## Migrations

Todas em `db/migrations/`. Aplicação:

```bash
node --env-file=.env.local scripts/db-query.mjs db/migrations/NNNN_xxx.sql
node --env-file=.env.local scripts/gen-types.mjs   # regenera lib/supabase/types.ts
```

Lista cronológica:

| # | Tema |
|---|---|
| 0001 | init — schema base, 9 tabelas, RLS, policies tenant-scoped |
| 0002 | fixes — refactor RLS com `current_tenant_ids()` helper |
| 0003 | webhooks — media bucket + columns media_* + raw_payload |
| 0004 | ai_tracking — tabela `ai_calls` |
| 0005 | audios_bucket — RLS policies bucket `audios` |
| 0006 | tenant_settings — `include_caption_on_delivery`, `delivery_target` |
| 0007 | superadmin — tabela + helper `is_superadmin()` |
| 0008 | admin_managed — drop trigger `handle_new_user`, UNIQUE `whatsapp_instances(tenant_id)`, `tenants.is_active`, policies SELECT bypass |
| 0009 | uazapi_instance_name — coluna + partial unique |
| 0010 | summary_voice_mode — single/duo |
| 0011 | no_auto_approval_mode — CHECK `approval_mode <> 'auto'` |
| 0012 | member_phone — `phone_e164` em tenant_members |
| 0013 | summary_caption — caption emoji-rich curta |
| 0014 | backfill_empty_group_names |
| 0015 | audios_uazapi_delivered_message_id — distinção podcast vs owner audio |
