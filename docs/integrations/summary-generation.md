# Geração de resumos (Fase 7)

> Referência de engenharia para o estágio do pipeline que transforma uma
> `NormalizedConversation` (Fase 6) em uma **row em `summaries`** com status
> `pending_review`, pronta para a revisão humana da Fase 8.

Plano: [`docs/plans/fase-7-plan.md`](../plans/fase-7-plan.md).
Código: `lib/summary/prompt.ts`, `lib/summary/generator.ts`, `lib/ai-tracking/service.ts`, `inngest/functions/generate-summary.ts`, `app/api/summaries/*`.

---

## Overview

1. **Prompt** (`buildSummaryPrompt`) em PT-BR com tom configurável (`formal | fun | corporate`).
2. **Gemini 2.5 Pro** via `lib/ai/gemini-llm.ts::generateSummaryFromPrompt` (structured output).
3. **Persiste** em `summaries` com `status='pending_review'` + `prompt_version` + `model`.
4. **Tracking** em `ai_calls` via `trackAiCall` — best-effort, nunca derruba geração.

## Flow

```
POST /api/summaries/generate (auth + 10/h/tenant rate limit)
  → inngest event summary.requested
  → worker generate-summary
  → generateSummary(input)
    ├─ buildNormalizedConversation (Fase 6)
    ├─ buildSummaryPrompt(conv, tone) → podzap-summary/v1-<tone>
    ├─ generateSummaryFromPrompt (Gemini 2.5 Pro, JSON schema)
    ├─ INSERT summaries (pending_review)
    └─ trackAiCall (best-effort)
```

## Tones

| Tom | Quando | System prompt suffix |
|---|---|---|
| `formal` | B2B, jurídico | "tom profissional, vocabulário formal, sem jargão corporativo" |
| `fun` | Grupos sociais, comunidades | "descontraído e caloroso, humor leve sem forçar, frases curtas" |
| `corporate` | Times internos, stand-ups | "executivo sênior, decisões e impactos, frases diretas" |

Default = `fun`.

## Cost tracking — `ai_calls`

```sql
select tenant_id, count(*) as calls, sum(tokens_in) as tin,
       sum(tokens_out) as tout, sum(cost_cents)/100.0 as usd
from ai_calls
where operation = 'summarize'
  and created_at >= now() - interval '30 days'
group by tenant_id order by usd desc;
```

Programmatic: `getAiUsageForTenant(tenantId, start, end)`.

## Prompt versioning

`podzap-summary/v<N>-<tone>`. Bump version → update tests → document diff em AUDIT → nunca reescrever `prompt_version` retroativamente.

## Hallucination mitigation

1. Instrução explícita: "Use APENAS informação presente nas mensagens."
2. Participantes como lista fechada.
3. Keywords dominantes passadas separadamente.
4. Top-20 mensagens por weight (não a conversa inteira).
5. Structured output força mapeamento aos tópicos recebidos.

Pós-MVP: pós-processamento de fact-check, score de confiança por trecho.

## API

| Método | Endpoint | Propósito | Rate limit |
|---|---|---|---|
| POST | `/api/summaries/generate` | Dispara geração (emit Inngest) | 10/h/tenant |
| GET | `/api/summaries` | Lista (`?groupId&status&limit`) | - |
| GET | `/api/summaries/[id]` | Detalhe | - |

Body `POST /generate`:
```json
{ "groupId": "uuid", "periodStart": "ISO", "periodEnd": "ISO", "tone": "fun" }
```
Resposta: 202 + `{ ok: true, dispatched: true }`.

## Dev testing

1. Inspecionar entrada: `/pipeline-preview` mostra a `NormalizedConversation`.
2. Disparar:
   ```bash
   curl -X POST http://localhost:3001/api/summaries/generate \
     -H 'Content-Type: application/json' \
     -H 'Cookie: <session>' \
     -d '{"groupId":"<uuid>","periodStart":"2026-04-22T00:00:00Z","periodEnd":"2026-04-22T23:59:59Z","tone":"fun"}'
   ```
3. `npx inngest-cli@latest dev -u http://localhost:3001/api/inngest` em paralelo + `INNGEST_DEV=1`.
4. Inspecionar: `GET /api/summaries?groupId=<uuid>`.

## Troubleshooting

| Sintoma | Causa | Fix |
|---|---|---|
| `EMPTY_CONVERSATION` throw | Nenhum tópico relevante no período | `/pipeline-preview` + confirmar monitored=true |
| Gemini `context length exceeded` | Prompt muito longo | Reduzir `maxMessagesPerTopic` |
| `finishReason='SAFETY'` | Safety filter | Marcar `generation_blocked`, não retry |
| 429 no generate | Rate limit 10/h atingido | Esperar janela |
| Summary sem row em ai_calls | Track best-effort falhou | Checar logs + service role key |
| Cita pessoa fora da lista | Hallucination | Bump prompt version reforçando restrição |

---

- Entrada: [`pipeline.md`](./pipeline.md)
- Workers: [`inngest.md`](./inngest.md)
- Provedor: [`ai.md`](./ai.md)
- Próxima: Fase 8 (aprovação humana) consome `summaries.status='pending_review'`.
