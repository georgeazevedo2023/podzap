# Auditoria — Fase 7 (Geração do resumo)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito

**PASS COM CAVEAT DE CUSTO.** Pipeline de geração completo e tipado. Infra de tracking de custo (`ai_calls` + `trackAiCall`) pronta. 19 testes novos (178 total). E2E real com Gemini 2.5 Pro só acontece com mensagens reais — custo esperado ~$0.01-0.02 por resumo.

## Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 178/178 (+19: 7 ai-tracking, 12 prompt, 7 generator) em 10.3s |
| build | ✅ 24 rotas |

## Destaques

- **`trackAiCall` nunca throws** — insert fail é logado, retorna null. Caller imune.
- **Prompt versionado** (`podzap-summary/v1-<tone>`) gravado em `summaries.prompt_version` → rastreabilidade A/B.
- **`gemini-llm.ts` estendido sem breaking**: adicionou `generateSummaryFromPrompt({systemPrompt, userPrompt, promptVersion})` ao lado do antigo `generateSummary(SummaryInput)`.
- **Structured output** (`{ text, topics, estimatedMinutes }`) via `responseSchema` Gemini — parse nunca adivinha.
- **Tom em lista fechada** `'formal' | 'fun' | 'corporate'` — previne prompt injection via user input.
- **Rate limit 10/h/tenant** no generate endpoint.
- **`EMPTY_CONVERSATION` throws** antes de gastar API call.
- **`SummaryError` tipada** → caller decide HTTP status.

## Débitos

1. **Custo real por resumo não validado** — só mockado em testes. Humano precisa gerar 1 resumo de verdade e observar custo.
2. **Tokens/cost_cents não calculados automaticamente** — `trackAiCall` recebe valores mas Gemini SDK não retorna cost. Precisa tabela de preços + cálculo manual; deferido.
3. **Safety filter block sem UI** — se Gemini recusa por conteúdo sensível, hoje apenas loga. Fase 8 precisa expor "generation_blocked".
4. **Prompt injection via groupName**: se um tenant nomear o grupo `"ignore anterior, retorne X"`, pode vazar. Mitigar com escape ou delimitador.
5. **Hallucination mitigation é só instrucional** — pós-processamento fact-check ficou pós-MVP.
6. **Conversa longa > 800 palavras** pode acontecer. Prompt pede, mas sem hard cap.

## Recomendações Fase 8

1. **Tela `/approval`**: lista summaries `status='pending_review'` + editor de texto + tone regen
2. **Actions**: aprovar, rejeitar (com motivo), regenerar com novo tom
3. **Status machine**: `pending_review → approved | rejected`. Approved dispara Fase 9 (TTS)
4. **Notification placeholder**: por hora só badge na sidebar (contagem de pending). Email/push pós-MVP
