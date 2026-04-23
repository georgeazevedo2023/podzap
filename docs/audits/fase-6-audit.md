# Auditoria — Fase 6 (Filtro + agrupamento por tópicos)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito geral

**PASS.** Pipeline de normalização completo: filter puro (14 testes), cluster com Jaccard + temporal (9 testes), normalize orquestrador com Supabase join (6 testes). UI de debug dev-only `/pipeline-preview`. Total 29 testes novos, 152 no projeto.

---

## ✅ Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 152/152 (+29: 14 filter + 9 cluster + 6 normalize) em 10.2s |
| build | ✅ |

## 🟢 Destaques

- **Filter puro** — zero IO, determinístico, stopwords PT-BR extensas (kkkk/kk/k/rs/haha/uhum/aham/sim/não/vlw), keyword boost `decisão/atenção/importante/reunião/prazo/problema/erro/deadline/urgente/contrato`, emoji-only regex, URL-only regex
- **Cluster determinístico** — sort by (at, id) pra tie-break estável, Jaccard participant overlap janela 5, topic id = sha1 primeiros 8 hex → replayable
- **Defensive Supabase embed unwrap** em normalize — aguenta array ou objeto
- **Throws em periodEnd < periodStart** — input validation clara, width 0 ok
- **Dev-only `/pipeline-preview`** usando `notFound()` em prod (sem leak), form GET sem JS, `<details>` nativos pra collapse, JSON pretty-print

## 🟡 Débitos

1. **Filter tuning empírico** — parâmetros vão precisar ajuste com dados reais. Nenhum teste com corpus representativo.
2. **Cluster participant overlap janela 5** — mágico, não testado com grupos > 10 participantes.
3. **Keywords por topic são stopwords-filtered tokens** — trivial. Poderia usar TF-IDF mas pós-MVP.
4. **`dominantKeywords` pode vir vazio** em tópicos com texto pouco significativo. UI precisa tolerar.
5. **`buildNormalizedConversation` não cacheia** — mesma query rodada 2x é 2x DB hit. Fase 7 pode adicionar.

## Recomendações Fase 7

1. **Prompt builder**: `lib/summary/prompt.ts` recebe `NormalizedConversation` + `tone` → string prompt PT-BR
2. **Gemini 2.5 Pro** com structured output (responseSchema) retornando `{ text, topics[] }`
3. **Service `generateSummary(tenantId, groupId, periodStart, periodEnd, tone)`** persiste em `summaries` + tracking de custo em `ai_calls` (nova tabela)
4. **Inngest function `generate-summary`** on cron OR on manual trigger (pra aprovação Fase 8)
