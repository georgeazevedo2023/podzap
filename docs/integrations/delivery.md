# Entrega no WhatsApp (Fase 10)

> Como um resumo aprovado vira um áudio entregue no grupo original do WhatsApp via UAZAPI.
>
> Código: `lib/delivery/service.ts`, `inngest/functions/deliver-to-whatsapp.ts`, `app/api/audios/[id]/redeliver/route.ts`.

---

## Overview

O worker `deliver-to-whatsapp` consome o evento `audio.created` (emitido pelo worker `generate-tts` da Fase 9 após persistir o WAV no bucket `audios`), baixa o blob do Storage, decripta o token UAZAPI da instância e chama `POST /send/media` (tipo `audio`, modo PTT) apontando para o `uazapi_group_jid` do grupo de origem do resumo. Em caso de sucesso, grava `delivered_to_whatsapp=true` + `delivered_at=now()` na row `audios`.

Rota síncrona `POST /api/audios/[id]/redeliver` expõe o mesmo pipeline para retries manuais (botão "Reenviar" no card do `/podcasts`).

---

## Flow

```
summary.approved                  (Fase 8 → Fase 9)
       │
       ▼
generate-tts worker               (Fase 9: cria audios row + WAV no Storage)
       │  emit audio.created { audioId, tenantId, summaryId }
       ▼
┌────────────────────────────────────────────────────┐
│  deliver-to-whatsapp worker  (inngest, retries: 3) │
│    step.run('deliver') → deliverAudio()            │
└────────────────────────┬───────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────┐
│  lib/delivery/service.ts#deliverAudio              │
│                                                    │
│    1. loadContext()        audio + summary + group │
│       └─ short-circuit se delivered_to_whatsapp    │
│    2. getCurrentInstance() NO_INSTANCE / !connected│
│    3. downloadAudio()      Supabase Storage (WAV)  │
│    4. loadInstanceToken()  decrypt AES-256-GCM     │
│    5. UazapiClient.sendAudio(token, jid, buf, cap) │
│    6. markDelivered()      flips row + delivered_at│
└────────────────────────────────────────────────────┘
                         │
                         ▼
     Áudio chega no grupo (+ legenda opcional)
```

Redelivery manual é o mesmo pipeline sem o short-circuit:

```
POST /api/audios/[id]/redeliver
       │   requireAuth + rate limit 6/h/tenant
       ▼
lib/delivery/service.ts#redeliver  (skipAlreadyDelivered=false)
```

---

## Delivery target

| Status | Destino | Resolução |
|---|---|---|
| **MVP (hoje)** | Grupo original do resumo | `audios.summary_id → summaries.group_id → groups.uazapi_group_jid` |
| Pós-MVP | DM do owner | Flag por tenant que troca o JID pro `whatsapp_instances.owner_jid` |
| Pós-MVP | Ambos (grupo + DM) | Fan-out: duas chamadas `sendAudio` sequenciais, cada uma com sua linha de telemetria |
| Pós-MVP | Lista custom | `schedules.delivery_targets jsonb[]` — uma entrega por JID, erros isolados |

A coluna `audios.delivery_target_jid` mencionada no plano da Fase 10 **não foi adicionada** — o JID vem sempre de `groups.uazapi_group_jid` via JOIN. Quando a opção "DM do owner / custom list" chegar, será o momento de introduzir essa coluna (ou uma tabela `audio_deliveries` com uma row por destino).

---

## Caption

O plano original previa um toggle por tenant (`tenants.include_caption_on_delivery`). **A migration não foi aplicada**; o comportamento atual é:

| Trigger | `includeCaption` | Origem da legenda |
|---|---|---|
| Worker `deliver-to-whatsapp` | `true` (hardcoded) | `summaries.text` |
| `POST /api/audios/[id]/redeliver` | `false` (default, não exposto) | — |
| `deliverAudio()` sem `opts` | `false` (default) | — |

Quando `includeCaption=true`, o texto completo do resumo é passado como `caption` no payload UAZAPI (`/send/media`). Trocar para flag por tenant é trivial: adicionar coluna booleana em `tenants`, ler dentro de `runDelivery`, remover o hardcode do worker. Ver "Inconsistências" no fim.

---

## Error handling — `DeliveryError`

Todas as falhas do pipeline sobem como `DeliveryError` tipada (`lib/delivery/service.ts`). A rota `redeliver` mapeia via `mapErrorToResponse`; o worker deixa a exceção propagar e conta com retry do Inngest.

| `code` | Quando | HTTP (redeliver) | Retry Inngest? |
|---|---|---|---|
| `NOT_FOUND` | `audios` / `summaries` / `groups` não encontrados no tenant | 404 | Não (determinístico) |
| `NO_INSTANCE` | Tenant sem `whatsapp_instances` ou sem token armazenado | 409 | Sim (usuário pode conectar) |
| `INSTANCE_NOT_CONNECTED` | Instância existe mas `status != 'connected'` | 409 | Sim (usuário pode escanear QR) |
| `UAZAPI_ERROR` | Qualquer erro do `UazapiClient.sendAudio` (5xx, rate limit, grupo sumido) | 502 | Sim (backoff exponencial) |
| `DB_ERROR` | Falha Supabase (select, update, storage download) | 500 | Sim |

Em `UAZAPI_ERROR`, a row **não** é flipada para `delivered_to_whatsapp=true` — retry é seguro. `CryptoError` no decrypt é normalizado para `NO_INSTANCE` (semanticamente equivalente: não temos credencial utilizável).

---

## Retry

Dois níveis:

- **Automático (Inngest)**: `retries: 3` na definição do worker (`deliverToWhatsappFunction`). Cobre 5xx transitórios da UAZAPI, rate limit, reconexão curta, e falhas temporárias de Storage/DB. Falha final deixa `delivered_to_whatsapp=false` — a UI de `/podcasts` surfaça isso e oferece o botão "Reenviar".
- **Manual**: `POST /api/audios/[id]/redeliver` chama `redeliver()`, que é `deliverAudio()` sem o short-circuit. Rate limit **6 requisições/hora/tenant** (chave `tenant:<id>:redeliver` em `applyRateLimit`) para evitar button-mashing e preservar reputação da instância UAZAPI. Retorna `200 { delivery: DeliveryView }`.

Não existe fila externa para retry de longo prazo; resumos muito antigos com falha permanente exigem intervenção manual (deletar+regerar).

---

## Idempotence

- `deliverAudio()` passa `skipAlreadyDelivered: true` ao orquestrador interno. Se a row já está `delivered_to_whatsapp=true`, devolve o `DeliveryView` atual **sem** chamar UAZAPI nem atualizar DB. Isso torna o worker seguro frente a replay do evento `audio.created` pelo Inngest (ex.: crash entre `sendAudio` e `markDelivered`… neste caso específico, haveria entrega duplicada — ver "Concerns" abaixo).
- `redeliver()` passa `skipAlreadyDelivered: false` — sempre dispara a chamada UAZAPI. É a afirmação do caller ("eu decidi reenviar").
- `markDelivered()` é `UPDATE ... WHERE tenant_id=? AND id=?` sem condição sobre o estado anterior, então re-runs sobrescrevem `delivered_at` com o timestamp mais recente.

---

## Concerns

| Risco | Mitigação atual | Gap / pós-MVP |
|---|---|---|
| **UAZAPI rate limit** (~10 msgs/min por instância) | `UazapiClient` interno tem token bucket; retries do Inngest têm backoff | Em volume alto, fila externa (BullMQ/Upstash) com shaping por instância |
| **Instância desconectada no meio do voo** | `getCurrentInstance` valida `status === 'connected'` antes do `sendAudio`; `INSTANCE_NOT_CONNECTED` retoma no retry | Race entre checagem e chamada: se desconectar entre (2) e (5), vira `UAZAPI_ERROR` e retry resolve |
| **Grupo removido / bot expulso** | UAZAPI devolve erro → `UAZAPI_ERROR` → 3 retries falham → row fica não-entregue; botão "Reenviar" disponível | Mapear erro específico "group_not_found" → `NOT_FOUND` definitivo (não retentar) |
| **Buffer size limit UAZAPI** | WAV 24 kHz mono de um resumo de 3-5 min fica em ~5-8 MB; UAZAPI aceita até ~16 MB em `/send/media` | Fallback documentado no plano: upload pra URL pública + `sendAudio` por URL. Não implementado |
| **Entrega duplicada em replay** | Não há deduplicação UAZAPI-side; se `sendAudio` retornar sucesso e `markDelivered` falhar, o próximo retry envia de novo | Aceito no MVP — probabilidade baixa. Pós-MVP: client-side msg id + `INSERT ... ON CONFLICT` num log de deliveries |
| **TTL do signed URL vs. entrega** | Worker usa download direto via admin client (não signed URL), imune a expiração | n/a |
| **PII na legenda** | Texto do resumo inteiro vai pra UAZAPI e, por transitividade, pro log deles | Toggle por tenant (ver "Caption") resolve quando um cliente pedir |

---

## Metrics

Taxa de sucesso de entrega por tenant/janela (query direta ao Postgres via admin client):

```sql
SELECT
  tenant_id,
  COUNT(*) FILTER (WHERE delivered_to_whatsapp)               AS delivered,
  COUNT(*)                                                    AS total,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE delivered_to_whatsapp) / NULLIF(COUNT(*), 0),
    2
  )                                                           AS success_pct
FROM audios
WHERE created_at >= now() - interval '7 days'
GROUP BY tenant_id
ORDER BY total DESC;
```

Latência entre TTS e entrega:

```sql
SELECT
  tenant_id,
  percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - created_at))) AS p50_s,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (delivered_at - created_at))) AS p95_s
FROM audios
WHERE delivered_to_whatsapp
  AND delivered_at IS NOT NULL
  AND created_at >= now() - interval '7 days'
GROUP BY tenant_id;
```

Pós-MVP: migrar para `ai_calls`-equivalente (`delivery_events` com row por tentativa, `status`, `uazapi_error_code`, `duration_ms`) para permitir diagnóstico fino por falha.
