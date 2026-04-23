# Agendamento (Fase 11)

> Referência viva do pipeline de agendamento do podZAP. Mantida junto com
> `lib/schedules/service.ts`, `inngest/functions/run-schedules.ts` e o PRD §9.

---

## Overview

Agendamento é a camada que transforma o podZAP num produto **passivo** —
o usuário configura uma vez ("todo dia 18h resumir o grupo X") e a partir
daí resumos em áudio são gerados e entregues sem intervenção.

Um cron Inngest com cadência `*/5 * * * *` percorre a tabela `schedules`,
seleciona os que estão vencendo na janela atual (America/Sao_Paulo) e
dispara o pipeline completo (Fases 7 → 8 → 9 → 10) via eventos. O modo
de aprovação do schedule decide se a Fase 8 exige humano ou se o pipeline
segue reto para TTS + entrega.

- **Unicidade**: um schedule por grupo (UNIQUE `group_id` no DB).
- **Multi-tenant**: todo CRUD é escopado por `tenant_id`. O worker
  background roda com service role mas propaga `tenant_id` em todo
  evento emitido.
- **Idempotente**: dedup por overlap de janela evita dois resumos no
  mesmo bucket (cron skew, invocação manual, etc).

---

## Flow

```
┌─────────────────────────┐
│  Inngest cron           │   trigger: */5 * * * *
│  run-schedules          │
└──────────┬──────────────┘
           │ step "find-due"
           ▼
┌─────────────────────────┐
│  dueSchedulesNow(now,5) │   lib/schedules/service.ts
│  · is_active=true       │   · fixed_time only
│  · time_of_day ∈ janela │   · weekly → day_of_week match
│  · timezone America/SP  │   · daily → any dow
└──────────┬──────────────┘
           │ due[] : ScheduleView[]
           ▼
     for each schedule:
           │
           │ step "dedup-check-<id>"
           ▼
┌─────────────────────────┐
│ summaryExistsForWindow  │   summaries WHERE
│  (tenant, group,        │     tenant_id = … AND group_id = …
│   start, end)           │     AND period_start <= end
│                         │     AND period_end   >= start
└──────┬────────────┬─────┘
       │ exists     │ !exists
       ▼            ▼
    skip++      step "enqueue-<id>"
                     │
                     ▼
        ┌───────────────────────────────┐
        │  inngest.send(                │
        │    summary.requested {        │
        │      tenantId, groupId,       │
        │      periodStart, periodEnd,  │
        │      tone,                    │
        │      autoApprove: mode==auto  │
        │    })                         │
        └───────────────┬───────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│ generate-summary  (Fase 7)                                    │
│   · monta NormalizedConversation                              │
│   · chama Gemini 2.5 Pro                                      │
│   · INSERT summaries (status='pending_review')                │
│   · if autoApprove:                                           │
│       inngest.send(summary.approved) — bypassa review humano  │
└────────────────────────────┬─────────────────────────────────┘
                             │
                             ▼
          ┌──────────────────────────────────┐
          │  summary.approved                │
          │  (Fase 8 — humano OU autoApprove)│
          └────────────────┬─────────────────┘
                           │
                           ▼
          ┌──────────────────────────────────┐
          │  generate-tts  (Fase 9)          │
          │  → audios row + audio.created    │
          └────────────────┬─────────────────┘
                           │
                           ▼
          ┌──────────────────────────────────┐
          │  deliver-to-whatsapp  (Fase 10)  │
          │  → UAZAPI /send/media (PTT)      │
          └──────────────────────────────────┘
```

**Contadores retornados pelo cron**: `{ due, enqueued, skipped }` —
o dashboard Inngest expõe esses números por tick para observabilidade.

---

## Schema (`schedules`)

| Coluna          | Tipo                                | Nota                                                                 |
| --------------- | ----------------------------------- | -------------------------------------------------------------------- |
| `id`            | `uuid` PK                           | `gen_random_uuid()`                                                  |
| `tenant_id`     | `uuid` FK `tenants.id`              | Escopo multi-tenant                                                  |
| `group_id`      | `uuid` FK `groups.id` **UNIQUE**    | Um schedule por grupo                                                |
| `frequency`     | enum `schedule_frequency`           | `daily` \| `weekly` \| `custom` (custom não implementado)            |
| `time_of_day`   | `time` (nullable)                   | `HH:MM:SS` sem timezone — interpretado em America/Sao_Paulo          |
| `day_of_week`   | `smallint` 0-6 (nullable)           | 0=domingo, 6=sábado. Obrigatório quando `frequency='weekly'`          |
| `trigger_type`  | enum `schedule_trigger_type`        | `fixed_time` (único implementado) \| `inactivity` \| `dynamic_window` |
| `approval_mode` | enum `schedule_approval_mode`       | `auto` \| `optional` \| `required`                                   |
| `voice`         | `text` (nullable)                   | Override do mapeamento default de voz                                |
| `tone`          | enum `summary_tone`                 | `formal` \| `fun` \| `corporate`                                     |
| `is_active`     | `boolean` default `true`            | Pausar sem deletar                                                   |
| `created_at`    | `timestamptz` default `now()`       |                                                                      |
| `updated_at`    | `timestamptz` default `now()`       | Bumped por trigger                                                   |

Índices relevantes:

- `UNIQUE (group_id)` — um schedule por grupo.
- Consultas do worker filtram por `is_active = true` — considerar índice
  parcial caso o volume cresça.

---

## Semântica de frequência

| `frequency` | Seleção no cron                                                        | Janela de mensagens          |
| ----------- | ---------------------------------------------------------------------- | ---------------------------- |
| `daily`     | dispara quando `time_of_day` cai na janela dos últimos 5 min           | `now - 24h` a `now`          |
| `weekly`    | idem + exige `day_of_week` = hoje (0-6 em America/Sao_Paulo)           | `now - 7d` a `now`           |
| `custom`    | **não implementado** — worker ignora silenciosamente (ver Limitations) | n/a                          |

Detalhe da janela de detecção em `dueSchedulesNow`: uma schedule para
`18:00` é capturada pelo tick das `18:00` (janela `(17:55, 18:00]` —
inclusiva no topo, exclusiva no bottom) e **não** re-capturada pelo tick
das `18:05`. A dedup pelo overlap de `summaries.period_*` cobre casos
extremos (retry manual, drift de clock).

---

## Timezone

**America/Sao_Paulo** é assumido para todo campo `time_of_day` /
`day_of_week`. A coluna é `time` sem tz; a UI renderiza e edita valores
sempre em horário de Brasília. O worker converte o `Date` UTC atual para
São Paulo via `Intl.DateTimeFormat({ timeZone: 'America/Sao_Paulo' })` —
sem dependência externa de tz.

**Implicação**: um schedule às 18:00 em SP dispara mais cedo/tarde em
UTC conforme horário de verão (atualmente extinto no Brasil — o valor é
estável, mas o código não assume isso). Suporte multi-tz por tenant é
pós-MVP.

---

## Modos de aprovação

O campo `schedules.approval_mode` dita como o pipeline se comporta após
o resumo ser gerado.

| Modo       | Comportamento                                                                          | Status no MVP                                |
| ---------- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| `auto`     | Pipeline roda sem intervenção humana — `summary.requested` carrega `autoApprove: true`, `generate-summary` emite `summary.approved` logo após o insert, TTS + entrega disparam em sequência. | ✅ Implementado                              |
| `optional` | Resumo fica `pending_review`, mas com hint de **auto-aprovar em 24h** se ninguém agir. | ⚠️ Cria a row `pending_review`; o auto-approve em 24h **não está implementado** (timer Inngest pendente). |
| `required` | Resumo fica `pending_review` até humano aprovar em `/approval/[id]`. Fluxo idêntico à Fase 8 manual.                              | ✅ Implementado                              |

Mapeamento no worker: `autoApprove = schedule.approvalMode === 'auto'`.
`optional` e `required` hoje se comportam igual — ambos caem em
`pending_review` sem timer adicional.

---

## Dedup

Antes de emitir `summary.requested`, o worker consulta `summaries`:

```sql
SELECT id FROM summaries
WHERE tenant_id = :t
  AND group_id  = :g
  AND period_start <= :end
  AND period_end   >= :start
LIMIT 1;
```

Qualquer overlap de janela (independente do status — `pending_review`,
`approved`, `rejected`) conta como "já existe" e o tick é pulado
(`skipped++`). Motivação: dois ticks em ≤5 min de diferença não devem
criar dois resumos do mesmo dia, e rodar o cron manualmente pelo
dashboard Inngest para testar também não deve duplicar.

---

## API

| Método   | Rota                         | Descrição                                   |
| -------- | ---------------------------- | ------------------------------------------- |
| `GET`    | `/api/schedules`             | Lista schedules do tenant autenticado        |
| `POST`   | `/api/schedules`             | Cria schedule (1 por grupo — erro `CONFLICT` se duplicar) |
| `PATCH`  | `/api/schedules/[id]`        | Patch parcial (frequency, time, dow, tone, approval_mode, voice, is_active) |
| `DELETE` | `/api/schedules/[id]`        | Remove (ou use PATCH `is_active=false` para pausar) |

Códigos de erro do service (`SchedulesError.code`): `NOT_FOUND`,
`CONFLICT`, `VALIDATION_ERROR`, `DB_ERROR` — mapeados na API route para
404 / 409 / 422 / 500.

---

## Limitações (MVP)

- **Cron Inngest em dev não dispara automaticamente** — no ambiente
  local o `inngest-cli dev` não executa os triggers `cron`. Para testar,
  invoque `run-schedules` manualmente pelo dashboard
  (`http://127.0.0.1:8288`) → função → "Invoke". Em produção (Inngest
  Cloud) o cron roda normalmente.

- **`trigger_type` só aceita `fixed_time`** — os valores
  `inactivity` e `dynamic_window` existem no enum como placeholders para
  fases futuras (ex.: "resumir quando o grupo silenciar por 2h"), mas o
  worker ignora ativamente qualquer schedule que não seja `fixed_time`.
  Criar um schedule com trigger diferente não gera erro — ele só nunca
  dispara.

- **`approval_mode='optional'` não tem auto-approve em 24h** — a UI
  permite configurar, e o resumo é gerado em `pending_review`, mas não
  há timer Inngest que promova essa row para `approved` após 24h. Hoje
  funciona na prática como `required`. Implementar requer um evento
  `summary.auto_approve_after` com `delay: '24h'` + handler idempotente
  (skip se já aprovado/rejeitado pelo humano).

- **`frequency='custom'`** reservado para expressões cron/rrule
  arbitrárias — ainda não implementado. O worker salta silenciosamente.

- **Timezone fixo** em America/Sao_Paulo — tenants em outras tz precisam
  compensar manualmente no `time_of_day`.

- **Chunking de áudio** (herança da Fase 9) — resumos muito longos
  disparados por schedule podem estourar o limite do Gemini TTS. O
  schedule em si não tem controle sobre isso.

---

## Referências

- `lib/schedules/service.ts` — CRUD + `dueSchedulesNow`
- `inngest/functions/run-schedules.ts` — cron worker
- `docs/plans/fase-11-plan.md` — plano original da fase
- `docs/integrations/approval.md` — Fase 8 (consumidora de `approval_mode`)
- `docs/integrations/summary-generation.md` — Fase 7 (consome `summary.requested`)
- `docs/integrations/tts.md` — Fase 9 (consome `summary.approved`)
- `docs/integrations/delivery.md` — Fase 10 (consome `audio.created`)
