# Fase 7 — Geração do resumo (LLM)

**Objetivo:** dado um `NormalizedConversation`, produzir resumo narrativo estilo podcast via Gemini 2.5 Pro com tom configurável, persistir em `summaries` com status `pending_review`.

**Pré-condição:** Fase 6. Pipeline normaliza mensagens.

## Componentes

### Migration 0004
- Tabela `ai_calls` (tracking custo): `id, tenant_id, provider, model, operation, tokens_in, tokens_out, cost_cents, duration_ms, created_at`
- Índice `(tenant_id, created_at desc)` + `(provider, model)` pra aggregations

### Código
- `lib/summary/prompt.ts` — `buildSummaryPrompt(conv, tone)` → string PT-BR otimizada pra podcast
- `lib/summary/generator.ts` — `generateSummary(tenantId, groupId, periodStart, periodEnd, opts)` orquestra:
  1. `buildNormalizedConversation(...)` (pipeline F6)
  2. `buildSummaryPrompt(conv, tone)`
  3. Gemini 2.5 Pro call (via `lib/ai/gemini-llm.ts` já existente)
  4. Insert em `summaries` (status `pending_review`)
  5. Insert tracking em `ai_calls`
- `lib/ai-tracking/service.ts` — `trackAiCall(tenantId, provider, model, operation, metrics)`
- Inngest function `generate-summary` — trigger manual via event `summary.requested`

### Rotas
- `POST /api/summaries/generate` — gatilho manual pro front (Fase 8 vai usar)
- `GET /api/summaries` — lista resumos do tenant

## Prompt strategy

System prompt (PT-BR):
```
Você é o roteirista-apresentador do podZAP, um podcast diário em PT-BR que
resume conversas de grupos de WhatsApp. Narre em primeira pessoa plural
("hoje no grupo..."). Cite participantes pelo nome/apelido. Evite jargão,
mas preserve termos técnicos. Texto corrido, sem markdown ou bullets,
pronto pra locução TTS. Duração alvo: 3-5min de leitura (~500-800 palavras).
```

Tom variants: `formal | fun | corporate` — system prompt muda levemente.

User prompt: inclui `groupName`, `period`, e para cada topic seu `startAt/endAt`, `participants`, `keywords`, e até top 20 mensagens por weight.

Response via structured output: `{ text: string, topics: string[], estimatedMinutes: number }`.

## Tarefas (5 agentes paralelos — Agente 1 faz migration sequencial antes)

### Agente 1 — Migration + tracking service
- `db/migrations/0004_ai_tracking.sql` com tabela `ai_calls` + RLS + indices
- Aplica via `scripts/db-query.mjs`
- `lib/ai-tracking/service.ts` com `trackAiCall(...)`
- Regen types
- Testes

### Agente 2 — Prompt builder + tests
- `lib/summary/prompt.ts` com `buildSummaryPrompt(conv, tone)` + variantes de tom
- Testes de snapshot: assert frases-chave presentes, participantes citados, tópicos listados, word count razoável

### Agente 3 — Summary generator + Inngest function
- `lib/summary/generator.ts` orquestrador
- `inngest/functions/generate-summary.ts` — event `summary.requested { tenantId, groupId, periodStart, periodEnd, tone }`
- Track AI calls
- Testes com mock Gemini

### Agente 4 — API routes
- `POST /api/summaries/generate` → emit Inngest event
- `GET /api/summaries?groupId=...&status=...`
- `GET /api/summaries/[id]`
- Rate limit: 10 generate/hora/tenant

### Agente 5 — Docs + status
- `docs/integrations/summary-generation.md`
- CLAUDE §13 + ROADMAP + README

## Critério de aceite

- [ ] typecheck + tests (target 170+)
- [ ] `generateSummary` fixture → row em `summaries` + row em `ai_calls`
- [ ] Build passes
- [ ] `AUDIT-fase-7.md`

## Riscos

- **Custo Gemini 2.5 Pro**: ~$0.005-0.02 por resumo dependendo do tamanho. Trackear.
- **Hallucination**: LLM pode inventar detalhes. Prompt explícito: "só use o que está nas mensagens".
- **Estouro de token**: conversas longas podem exceder context. Truncar por weight descending.
- **Tom "fun" pode ficar cringe**: ajustar com exemplos reais.

Ordem: Agente 1 sequencial primeiro, depois 2-5 paralelos.
