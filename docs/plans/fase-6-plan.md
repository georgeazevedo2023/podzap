# Fase 6 — Filtro de relevância + agrupamento por tópicos

**Objetivo:** dado um período (grupo + dia), produzir uma estrutura normalizada de "conversa relevante" agrupada em tópicos, pronta pra alimentar o LLM da Fase 7.

**Pré-condição:** Fase 5. Mensagens + transcripts existem.

## Estratégia

- **Não é AI-heavy**: regras simples primeiro. Embeddings ficam pós-MVP.
- Filter: drop ruído (ok/kkk/stickers/URLs-only/stopwords PT), boost áudios longos + mensagens longas + palavras-chave.
- Agrupamento: temporal (gap > 30min = novo tópico) + overlap de participantes.
- Output: `NormalizedConversation` pronto pra render em prompt.

## Tipos

```ts
export type NormalizedMessage = {
  id: string;
  senderName: string;
  at: Date;
  type: 'text' | 'audio' | 'image' | 'video' | 'other';
  content: string; // texto ou transcript ou descrição
  weight: number; // score de relevância 0-1
  hasMedia: boolean;
};

export type Topic = {
  id: string; // hash
  startAt: Date;
  endAt: Date;
  messages: NormalizedMessage[];
  participants: string[];
  dominant_keywords: string[];
};

export type NormalizedConversation = {
  tenantId: string;
  groupId: string;
  groupName: string;
  periodStart: Date;
  periodEnd: Date;
  topics: Topic[];
  discarded: number; // n msgs filtradas
  total: number;
};
```

## Tarefas (5 agentes paralelos)

### Agente 1 — `lib/pipeline/filter.ts`
- `filterMessages(messages, transcripts)` → `NormalizedMessage[]`
- Regras:
  - Drop se content vazio + sem mídia
  - Drop se content em stopwords `['ok','kkk','rsrs','hahaha', emojis só, '👍']`
  - Drop se < 3 chars
  - Drop se só URL (regex)
  - Weight boost: áudio > 20s (+0.3), content > 100 chars (+0.2), pergunta (termina com `?`) (+0.15), tem keyword `['decisão','atenção','importante','reunião','prazo','problema','erro']` (+0.3)
  - Weight base: 0.3
- Testes: input real fixtures → expected output

### Agente 2 — `lib/pipeline/cluster.ts`
- `clusterByTopic(messages, opts?)` → `Topic[]`
- Algoritmo simples:
  - Ordena por timestamp
  - Iterate: se gap > opts.gapMinutes (default 30) OU mudança forte de participantes (jaccard < 0.3) → novo topic
  - Collect 3-5 keywords por topic (simples: top tokens alfanuméricos > 4 chars, excluindo stopwords)
- Testes

### Agente 3 — `lib/pipeline/normalize.ts`
- Orchestrator: `buildNormalizedConversation(tenantId, groupId, periodStart, periodEnd)` via admin client
- Carrega messages + transcripts JOIN, mapeia pra `NormalizedMessage` (content = transcript.text ?? messages.content), chama filter → cluster → return
- Testes

### Agente 4 — Debug UI `/pipeline-preview`
- Rota dev-only (guarda `NODE_ENV !== 'production'`)
- Form: select group + date range → chama `buildNormalizedConversation` → renderiza JSON pretty + stats (n tópicos, n msgs, n descartadas)
- Usável pra inspeção manual antes da Fase 7
- Não precisa design polido, funcional only

### Agente 5 — Docs + CLAUDE update
- `docs/integrations/pipeline.md`: arquitetura, regras do filter, params do cluster
- CLAUDE §12 "Pipeline de normalização"
- ROADMAP fase 6 status

## Critério de aceite

- [ ] typecheck + tests (target 140+)
- [ ] `buildNormalizedConversation` com fixture: 500 msgs → 120 filtradas + 4-6 tópicos
- [ ] UI /pipeline-preview mostra output
- [ ] Commit + push

## Riscos

- **Filter muito agressivo**: podemos perder contexto importante. Weight = 0 em vez de drop em dúvida.
- **Cluster: gap temporal pode não ser bom** pra grupos assíncronos. Parametrizado desde início.
- **Performance**: 500+ msgs/dia em grupos ativos. Query indexada por `(group_id, captured_at desc)` já existe.

Ordem: todos em paralelo.
