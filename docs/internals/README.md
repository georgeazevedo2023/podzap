# Internals docs

Documentação dos **módulos próprios** em `lib/` e `inngest/` que não são subsistemas externos.

Para integrações externas (UAZAPI, Gemini, Groq, Supabase, Inngest setup) → [`docs/integrations/`](../integrations/).

## Índice

| Arquivo | Cobre |
|---|---|
| [`rate-limit.md`](./rate-limit.md) | `lib/ratelimit.ts` — fixed-window in-memory |
| [`tenancy.md`](./tenancy.md) | `lib/tenant.ts` + `lib/supabase/{admin,server,browser,middleware}.ts` |
| [`encryption.md`](./encryption.md) | `lib/crypto.ts` — AES-256-GCM para tokens UAZAPI at-rest |
| [`media-download.md`](./media-download.md) | `lib/media/{download,signedUrl}.ts` — SSRF guards, magic-byte sniff, signed URLs |
| [`stats.md`](./stats.md) | `lib/stats/service.ts` — aggregator 9-queries paralelas da `/home` |
| [`inngest-events.md`](./inngest-events.md) | `inngest/events.ts` + `inngest/functions/*.ts` — contratos de eventos, retries, choreography |

## Se você está mexendo em X, leia Y

| Está mexendo em… | Leia… |
|---|---|
| Rota `/api/*` que polled / custosa | [`rate-limit.md`](./rate-limit.md) |
| Server component novo com query de banco | [`tenancy.md`](./tenancy.md) — decidir server vs admin client |
| Webhook, worker Inngest, ou best-effort write | [`tenancy.md`](./tenancy.md) §admin disciplina |
| Armazenar novo segredo externo (OAuth token, API key por tenant) | [`encryption.md`](./encryption.md) |
| Download de mídia de URL externa | [`media-download.md`](./media-download.md) — especialmente SSRF guards |
| Componente novo na home dashboard | [`stats.md`](./stats.md) — ver se um campo novo cabe no `getHomeStats` |
| Novo worker assíncrono ou evento | [`inngest-events.md`](./inngest-events.md) + [`docs/integrations/inngest.md`](../integrations/inngest.md) |
| Adicionar cron | [`inngest-events.md`](./inngest-events.md) §Crons |
| Mudando RLS policy | [`tenancy.md`](./tenancy.md) §RLS × cada client |
| Gerando signed URL de audio TTS | [`media-download.md`](./media-download.md) §Signed URLs |
| Rotacionar `ENCRYPTION_KEY` | [`encryption.md`](./encryption.md) §Rotação |

## Módulos sem doc próprio (ainda)

Pequenos o suficiente pra não precisar de doc dedicado — comentários in-line cobrem:

| Módulo | Resumo | Onde está documentado |
|---|---|---|
| `lib/time/relative.ts` | `formatRelativeTime(iso)` → "há 3 min" pt-BR | Comentários + `lib/time/relative.ts:1-13` |
| `lib/ai-tracking/service.ts` | `trackAiCall()` (best-effort, never throws) + `getAiUsageForTenant()` (throws) | Comentários extensivos in-file |
| `lib/webhooks/validator.ts` | HMAC `x-podzap-signature` + legacy `UAZAPI_WEBHOOK_SECRET` | [`docs/integrations/webhooks.md`](../integrations/webhooks.md) |
| `lib/webhooks/persist.ts` | Dedup via `(tenant_id, uazapi_message_id)`, filter fromMe, emit `message.captured` | [`docs/integrations/webhooks.md`](../integrations/webhooks.md) |
| `lib/uazapi/client.ts` | Cliente REST UAZAPI com token bucket interno | [`docs/integrations/uazapi.md`](../integrations/uazapi.md) |
| `lib/ai/{groq,gemini-*,errors}.ts` | Wrappers Groq/Gemini + `AiError` hierarchy | [`docs/integrations/ai.md`](../integrations/ai.md) |
| `lib/admin/{tenants,users,uazapi}.ts` | Service layer pro painel `/admin` (Fase 13) | [`docs/integrations/admin-management.md`](../integrations/admin-management.md) |
| `lib/pipeline/*` | `filterMessages` + `clusterByTopic` + `buildNormalizedConversation` | [`docs/integrations/pipeline.md`](../integrations/pipeline.md) |
| `lib/summary/*` | Prompt builder + generator orchestration | [`docs/integrations/summary-generation.md`](../integrations/summary-generation.md) |
| `lib/summaries/service.ts` | CRUD + state machine pending_review → approved/rejected | [`docs/integrations/approval.md`](../integrations/approval.md) |
| `lib/audios/service.ts` | TTS orchestration + idempotent upsert no bucket audios | [`docs/integrations/tts.md`](../integrations/tts.md) |
| `lib/delivery/service.ts` | UAZAPI `/send/media` + redeliver + markDelivered | [`docs/integrations/delivery.md`](../integrations/delivery.md) |
| `lib/schedules/service.ts` | CRUD + `dueSchedulesNow` (tz-aware) + dedup window | [`docs/integrations/scheduling.md`](../integrations/scheduling.md) |
| `lib/whatsapp/service.ts` | Instance lifecycle (create/connect/status/delete) | [`docs/integrations/uazapi.md`](../integrations/uazapi.md) |
| `lib/groups/service.ts` | Sync UAZAPI `/group/list` + toggle `is_monitored` | [`docs/integrations/groups-sync.md`](../integrations/groups-sync.md) |
| `lib/transcripts/service.ts` | `upsertTranscript` idempotente em `message_id` | [`docs/integrations/ai.md`](../integrations/ai.md) |

Se você for adicionar algo novo em `lib/` que precise de explicação além de comentários in-line, crie um `.md` aqui e adicione à tabela do topo.
