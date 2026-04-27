# Geração de resumos (Fase 7)

> Referência de engenharia para o estágio do pipeline que transforma uma
> `NormalizedConversation` (Fase 6) em uma **row em `summaries`** com status
> `pending_review`, pronta para a revisão humana da Fase 8.

Plano: [`docs/plans/fase-7-plan.md`](../plans/fase-7-plan.md).
Código: `lib/summary/prompt.ts`, `lib/summary/generator.ts`, `lib/ai-tracking/service.ts`, `inngest/functions/generate-summary.ts`, `app/api/summaries/*`.

---

## Overview

1. **Prompt** (`buildSummaryPrompt`) em PT-BR — 3 caminhos de prioridade:
   `promptOverride` (free-form, `groups.prompt_override`) > `templateId`
   (catálogo `lib/summary/templates.ts`) > legado (`tone + voiceMode`).
2. **Gemini 2.5 Pro** via `lib/ai/gemini-llm.ts::generateSummaryFromPrompt` (structured output).
3. **Persiste** em `summaries` com `status='pending_review'` + `prompt_version` + `model`.
4. **Tracking** em `ai_calls` via `trackAiCall` — best-effort, nunca derruba geração.

## Flow

```
POST /api/summaries/generate (auth + 10/h/tenant rate limit)
  → preenche tone/voiceMode/template/hosts/promptOverride do GROUPO
    quando body omite (1-clique gerar usa só { groupId })
  → inngest event summary.requested
  → worker generate-summary
  → generateSummary(input)
    ├─ buildNormalizedConversation (Fase 6)
    ├─ buildSummaryPrompt(conv, tone, { templateId, host1Name,
    │     host2Name, promptOverride, voiceMode })
    │   → podzap-summary/v9-{override|template-id|tone}-{voice}
    ├─ generateSummaryFromPrompt (Gemini 2.5 Pro, JSON schema)
    ├─ INSERT summaries (pending_review)
    └─ trackAiCall (best-effort)
```

## Catálogo de templates (Fase B+C)

`lib/summary/templates.ts` define 7 templates. Cada um é um system prompt
completo com placeholders `{{group_name}}` / `{{host1_name}}` /
`{{host2_name}}`. O user prompt (formato JSON + conversation data +
caption) é appended em todos os casos.

| ID | Label | Voice mode | Quando usar |
|---|---|---|---|
| `default-duo` | Padrão (dupla) | duo | engineered DUO_SYSTEM_PROMPT refatorado |
| `default-solo` | Padrão (solo) | single | engineered SOLO_SYSTEM_PROMPT refatorado |
| `divertido` | Descontraído e divertido | duo | tom de bar, gírias, piadas |
| `informativo` | Profissional e informativo | duo | abertura formal, 5 partes obrigatórias |
| `fofoca` | Fofoca e novidades | duo | "vocês não vão acreditar...", suspense |
| `esportivo` | Esportivo e narração | duo | narrador de estádio + comentarista |
| `rapido` | Rápido e direto | duo | resumo curto, 3-5 destaques |

Default = `default-duo`. Template seleciona-se via `groups.prompt_template_id`
(persistido) ou via `templateId` no body do POST `/api/summaries/generate`.
Quando set, o template **força o voiceMode** (preserva consistência dos
prefixos `host1:` / `host2:`).

### Free-form prompt override (Pacote 2)

`groups.prompt_override` (text, 100..6000 chars) — power user define um
system prompt completamente customizado. Quando preenchido, IGNORA o
`templateId` e vai direto pro Gemini com vars substituídas.

Riscos conhecidos: prompt injection, output JSON quebrado. Mitigado por:
campo PRIVATE pro tenant + length cap + rate limit do
`/api/summaries/generate` (10/h/tenant).

## Tones (caminho legado)

Quando NEM `promptOverride` NEM `templateId` são passados, cai no caminho
legado: DUO/SOLO_SYSTEM_PROMPT engineered + sufixo de tom.

| Tom | Quando | System prompt suffix |
|---|---|---|
| `formal` | B2B, jurídico | "tom profissional, vocabulário formal, sem jargão corporativo" |
| `fun` | Grupos sociais, comunidades | "descontraído e caloroso, humor leve sem forçar, frases curtas" |
| `corporate` | Times internos, stand-ups | "executivo sênior, decisões e impactos, frases diretas" |

Default = `fun`. Schedules antigas (Fase 11) ainda usam este caminho via
`schedules.tone`.

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

3 formatos válidos pra `prompt_version`:

- `podzap-summary/v9-override-{voice}` — power user free-form ativo
- `podzap-summary/v9-{template-id}-{voice}` — template do catálogo
- `podzap-summary/v9-{voice}-{tone}` — caminho legado

Bump version → update tests → document diff em AUDIT → nunca reescrever
`prompt_version` retroativamente. O field é audit log do que foi enviado
naquela request específica, não o estado atual do template/grupo.

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
