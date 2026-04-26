# docs/integrations/ — subsistemas externos

Cada doc cobre **um** subsistema externo: API, shape, fluxo, casos de erro. Atualizada in-line com o código.

> **Internals vs integrations:** "integrations" são serviços externos (UAZAPI, Gemini, Groq…). Módulos próprios em `lib/` ficam em [`internals/`](../internals/README.md).

## Por subsistema

| Doc | Cobre |
|---|---|
| [`uazapi.md`](uazapi.md) | WhatsApp API: instance lifecycle, webhook shape (wsmart vs Evolution), media decryption via `/message/download` |
| [`webhooks.md`](webhooks.md) | Endpoint `/api/webhooks/uazapi` — auth (HMAC + legacy), parse, dispatch |
| [`inngest.md`](inngest.md) | Setup dev/prod, eventos canônicos, troubleshooting; n8n híbrido pra crons |
| [`pipeline.md`](pipeline.md) | Filter + cluster + normalize (Fase 6) — rule-based, sem AI |
| [`summary-generation.md`](summary-generation.md) | Gemini 2.5 Pro: prompt versioning, structured output, anti-hallucination |
| [`tts.md`](tts.md) | Gemini 2.5 Flash TTS — vozes Kore/Charon, WAV output |
| [`approval.md`](approval.md) | Estado-máquina pending → approved/rejected, regenerate |
| [`delivery.md`](delivery.md) | UAZAPI `/send/media` PTT, retry, dropdown destinos |
| [`scheduling.md`](scheduling.md) | Cron via n8n → `runSchedulesHandler`, dedup por janela |
| [`groups-sync.md`](groups-sync.md) | Sync inicial + delta de grupos UAZAPI |
| [`ai.md`](ai.md) | Overview cross-provider: Groq/Gemini, error classes, retries |
| [`supabase-auth.md`](supabase-auth.md) | Cookie-based auth, route gating |
| [`superadmin.md`](superadmin.md) | Capability cross-tenant, helper `is_superadmin()` |
| [`admin-management.md`](admin-management.md) | Modelo admin-managed (Fase 13): cria tenants/users/instâncias |

## Mapa "se você está mexendo em X, leia Y"

| Mexendo em… | Leia… |
|---|---|
| Webhook ingestion | `uazapi.md` + `webhooks.md` + `pipeline.md` (downstream) |
| Worker novo | `inngest.md` (eventos canônicos!) |
| Mídia: download/storage | `uazapi.md` §Media decryption + `internals/media-download.md` |
| Áudio do podcast (gerar) | `summary-generation.md` → `tts.md` → `approval.md` → `delivery.md` |
| Admin panel | `superadmin.md` + `admin-management.md` |
