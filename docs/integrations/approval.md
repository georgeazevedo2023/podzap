# Aprovação humana (Fase 8)

> Referência de engenharia para o estágio **human-in-the-loop** do pipeline:
> um resumo recém-gerado (Fase 7, status `pending_review`) só avança para TTS
> (Fase 9) depois que um operador aprova explicitamente.

Plano: [`docs/plans/fase-8-plan.md`](../plans/fase-8-plan.md).
Código: `lib/summaries/service.ts`, `app/api/summaries/[id]/{approve,reject,regenerate}/route.ts`, `app/(app)/approval/*`, `components/approval/*`.

---

## Overview

Entre **Fase 7 (geração)** e **Fase 9 (TTS + entrega)** um humano revisa o
texto. Três motivos pra existir essa etapa:

1. **Controle editorial** — o resumo vai ser lido em voz alta pro grupo; erro
   de fato é mais caro de consertar depois do áudio.
2. **Correção barata** — o operador pode ajustar texto manualmente antes de
   queimar tokens de TTS.
3. **Loop de calibragem de prompt** — taxa de rejeição serve como sinal pra
   decidir quando rever o system prompt (ver "Metrics").

---

## States

```
    [gerado na Fase 7]
           │
           ▼
    ┌──────────────┐
    │ pending_review│───── (regenerate) ────► cria nova row em pending_review
    └──────┬───────┘                         (row original permanece em pending)
           │
    ┌──────┴──────────┐
    │                 │
    ▼                 ▼
 approved          rejected
 (+approved_by,    (+rejected_reason,
  +approved_at)     +approved_by)
```

Transições terminais: `approved` e `rejected` são **imutáveis** — não é
possível editar o texto, reaprovar ou reclassificar. Para gerar uma nova
versão, emita um novo `summary.requested` (ver "Regenerate").

---

## Actions

| Ação | Método | Requisitos | Efeito no estado |
|---|---|---|---|
| Aprovar | `POST /api/summaries/[id]/approve` | status atual = `pending_review` | `status → approved`, stamp `approved_by` + `approved_at` |
| Rejeitar | `POST /api/summaries/[id]/reject` | `pending_review` + `reason` não-vazio | `status → rejected`, salva `rejected_reason` + `approved_by` |
| Editar texto | `PATCH /api/summaries/[id]` | `pending_review` + texto 1–50k chars | atualiza `text` + `updated_at` (mesmo id) |
| Regenerar | `POST /api/summaries/[id]/regenerate` | `pending_review`, opcional `tone` | emite `summary.requested` → **nova row** (ver abaixo) |

Todas as ações são tenant-scoped: o service layer (`lib/summaries/service.ts`)
faz double-filter em `tenant_id = $1` mesmo usando admin client.

---

## API

| Endpoint | Método | Body | Retorno |
|---|---|---|---|
| `/api/summaries/[id]` | `GET` | — | `SummaryView` |
| `/api/summaries/[id]` | `PATCH` | `{ text: string }` | `SummaryView` atualizado |
| `/api/summaries/[id]/approve` | `POST` | — (userId vem da sessão) | `SummaryView` com `status='approved'` |
| `/api/summaries/[id]/reject` | `POST` | `{ reason: string }` | `SummaryView` com `status='rejected'` |
| `/api/summaries/[id]/regenerate` | `POST` | `{ tone?: 'formal' \| 'fun' \| 'corporate', instructions?: string }` | `{ accepted: true, requestedAt }` |
| `/api/summaries?status=pending_review` | `GET` | — | `SummaryView[]` |

Códigos HTTP mapeados pelo `SummariesError.code`:
`NOT_FOUND → 404`, `INVALID_STATE → 409`, `VALIDATION_ERROR → 400`,
`DB_ERROR → 500`.

`approve` também emite `summary.approved` (Inngest) para disparar a Fase 9.

---

## UI flow

```
┌─────────────────────────────────────────────────────────────┐
│  /approval  (lista)                                         │
│  ┌───────────────────────────────────────────────┐          │
│  │ card: group · period · truncate · tone pill   │──┐       │
│  └───────────────────────────────────────────────┘  │ click │
│  ┌───────────────────────────────────────────────┐  │       │
│  │ card …                                        │  │       │
│  └───────────────────────────────────────────────┘  │       │
└─────────────────────────────────────────────────────┼───────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────┐
│  /approval/[id]  (detail + editor)                          │
│                                                             │
│  ┌─────────────────────────────┐  ┌──────────────────────┐  │
│  │  textarea (texto editável)  │  │ metadata             │  │
│  │                             │  │  · tokens / cost     │  │
│  │                             │  │  · prompt_version    │  │
│  │                             │  │  · model             │  │
│  │                             │  │  · participantes     │  │
│  └─────────────────────────────┘  └──────────────────────┘  │
│                                                             │
│  [ salvar edit ]  [ aprovar ]  [ rejeitar (motivo) ]        │
│                   [ regenerar com tom: [dropdown] ▼ ]       │
└─────────────────────────────────────────────────────────────┘
                │              │               │
     ┌──────────┘              │               └────────────┐
     ▼                         ▼                            ▼
 PATCH text            POST /approve              POST /regenerate
 (still pending)      summary.approved             → nova row pending
                      → Fase 9 (TTS)                (a original fica
                                                     intocada)
```

---

## Regenerate semantics

Quando o operador clica **"regenerar com tom X"**:

1. Endpoint `POST /api/summaries/[id]/regenerate` valida que a row atual está
   em `pending_review` (double-check contra corrida).
2. Emite `summary.requested` com `{ tenantId, groupId, periodStart, periodEnd,
   tone }` — mesma janela temporal do resumo-fonte.
3. Worker `generate-summary` (Fase 7) cria uma **nova row** em `summaries`
   com `status='pending_review'` e seu próprio `prompt_version` / `model`.
4. **A row original permanece em `pending_review`.** Não é transicionada pra
   `rejected` automaticamente.

**Por que não marcar a original como superseded?**

- **Auditoria**: manter as duas permite comparar lado-a-lado qual tom ficou
  melhor antes de decidir.
- **Reversibilidade**: o operador pode mudar de ideia e aprovar a versão
  antiga mesmo depois de pedir regeneração.
- **Sem side-effect escondido**: o único endpoint que transiciona uma row
  para `rejected` é `/reject` com razão explícita. Regenerar que transiciona
  implicitamente seria surpresa.

**Consequência**: operador fica com duas (ou mais) rows pending do mesmo
período. A UX da lista agrupa por `(group_id, period_start, period_end)` e
destaca a mais recente — mas o operador pode aprovar a que quiser. A row
não-escolhida fica pending indefinidamente; um cleanup job pós-MVP (Fase 13+)
pode auto-rejeitar com razão `superseded_by_newer_revision` após N dias.

---

## Modes (do PRD §9)

O PRD define três modos de aprovação por agenda:

| Modo | Comportamento esperado |
|---|---|
| `automático` | resumo gerado → TTS direto, sem intervenção |
| `aprovação opcional` | default aprova após timeout; operador pode intervir |
| `aprovação obrigatória` | bloqueia até `approved` ou `rejected` explícito |

**Na Fase 8**, todo resumo gerado entra em `pending_review` — equivalente a
`aprovação obrigatória` **para todo mundo**. A distinção por modo é feita na
Fase 11 via `schedules.approval_mode`, junto com o autopilot scheduler. Até
lá, o workflow único é seguro (nenhum áudio vai embora sem humano) à custa
de fricção — consciente.

---

## Metrics

Queries úteis pra calibrar o prompt e dimensionar backlog de review:

```sql
-- Approval rate por tenant (últimos 30 dias)
select tenant_id,
       count(*) filter (where status = 'approved')::float
         / nullif(count(*) filter (where status in ('approved','rejected')), 0)
         as approval_rate,
       count(*) filter (where status = 'pending_review') as pending
from summaries
where created_at >= now() - interval '30 days'
group by tenant_id;

-- Tempo médio para review (pending → terminal)
select tenant_id,
       avg(extract(epoch from (approved_at - created_at))) / 60 as avg_review_min
from summaries
where approved_at is not null
  and created_at >= now() - interval '30 days'
group by tenant_id;

-- Top razões de rejeição
select rejected_reason, count(*) from summaries
where status = 'rejected' and created_at >= now() - interval '30 days'
group by rejected_reason order by count desc limit 10;
```

Métricas derivadas (backlog pra dashboard):

- **Approval rate** — quantos foram aprovados vs. gerados. <70% sustentado
  indica prompt quebrado.
- **Avg time to review** — quanto tempo um resumo fica pending. Indicador
  de backlog operacional.
- **Regeneration rate** — quantos resumos geram ≥1 regeneração antes de
  aprovar. Alto = prompt default não está calibrado para o tenant.

---

## Troubleshooting

**`409 INVALID_STATE` ao aprovar/rejeitar.** Alguém já transicionou essa row
(outra aba, outro operador, ou tu mesmo num replay). Refetch do detalhe
mostra o estado atual. Idempotência forte aqui é intencional — sem ela, um
duplo-clique no botão "aprovar" viraria dois eventos `summary.approved`, dois
TTS, duas mensagens no zap.

**`400 VALIDATION_ERROR` ao rejeitar.** `reason` obrigatório e não pode ser
branco após trim. A UI precisa bloquear o submit enquanto o textarea de
motivo estiver vazio.

**`400` ao editar.** Texto vazio (após trim) ou ≥ 50 000 chars. O limite
alto evita pagar TTS em transcrições desnecessariamente longas.

**Badge do sidebar não atualiza.** O count é resolvido em
`app/(app)/layout.tsx` por request (server component, sem cache do Next).
Se tá stale, (a) navegou sem mudar de rota? Forçar um navigate ou hard
reload; (b) verificar se o `maybeSingle`/`count` não silenciou erro — o
fetch degrada graciosamente para `0`.

**Regenerar não produz nada.** Cheque `/api/inngest` (dev dashboard em
`http://127.0.0.1:8288`) pelo evento `summary.requested` e pelo run de
`generate-summary`. Rate limit na Fase 7 é 10/h/tenant — esgotou? O
endpoint retorna `429`, a UI precisa mostrar mensagem clara.

**Cross-tenant leak.** `service.ts` double-filtra por `tenant_id` em toda
mutação. Se um teste mostrar row de outro tenant, o bug é no resolver de
tenant do route handler, não no service.
