# Auditoria — Fase 5 (Transcrição multimodal)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito geral

**PASS COM CAVEAT.** Infra de workers (Inngest v4), funções de transcrição áudio (Groq) + descrição imagem (Gemini Vision), retries (cron + manual), UI mostrando transcrições, tudo implementado e testado (31 testes novos). Caveat: custo real de API — testes usam mocks, produção real só quando houver mensagens vindas de WhatsApp scaneado.

---

## ✅ Checks executados

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 123/123 (+31: 8 transcribe + 9 describe + 14 retry) em 7.6s |
| build | ✅ rotas incluindo `/api/inngest` |
| Inngest v4 serve handler | ✅ GET /api/inngest 200, 6 functions registradas |

## 🟢 Destaques

- **6 funções Inngest**: ping, transcribe-audio, describe-image, retry-pending-downloads, media-download-retry, transcription-retry
- **Handler puro exportado separadamente** (`transcribeAudioHandler`, `describeImageHandler`) para tests unit sem depender de internals v4
- **Early-return skip strategy**: todas as funções checam precondições (type match, downloaded, not-already-transcribed) + return cedo. Sem retries infinitos
- **Shared service**: `lib/transcripts/service.ts` usado pelos 2 workers (audio/image)
- **Cron safety nets**: retry-pending a cada 5min, transcription-retry a cada 15min — cobrem eventos perdidos (deploy window, Inngest down)
- **Re-emit `message.captured` após retry** — single code path pra processamento, elegante
- **Prompt PT-BR factual** pra imagens, evita opinião, foca em texto visível + elementos conversacionais
- **UI de transcrição** inline com `<audio>`/`<img>`, badge pulse "transcrevendo..." quando pending

## 🟡 Débitos

1. **Custo de API em produção real** — cada áudio 30s custa ~$0.0001 Groq, cada imagem ~$0.0005 Gemini. Em escala, tracking/limit por tenant precisa virar feature.
2. **Cron em Inngest dev não dispara** — local testing via manual Invoke no dashboard. Documentado.
3. **Sem tracking de custo por tenant** — `ai_calls` table prevista em plan 5 mas não implementada (escopo ficou enxuto). Pós-MVP.
4. **Áudios > 25MB** (limite Groq Whisper) não chunk — rejeita.
5. **Imagens sensíveis bloqueadas por Gemini** — marca falha, sem UI pra sinalizar motivo.
6. **Retries ignoram falhas de Gemini/Groq permanentes** — retry 3x depois desiste. Sem dead-letter queue.
7. **`transcription-retry` cron pode duplicar events** se Inngest der replay. Idempotência via `if transcript exists skip` resolve.

## 📋 Fluxo validado

```
webhook POST → persist → emit(message.captured)
  ├─ Inngest fan-out:
  │   ├─ transcribe-audio (se type=audio + downloaded)
  │   │   → Groq Whisper → upsert transcripts
  │   │
  │   └─ describe-image (se type=image + downloaded)
  │       → Gemini Vision → upsert transcripts
  │
  └─ Cron safety nets (a cada 5–15min):
      ├─ retry-pending: processa media download pending > 2min
      └─ transcription-retry: re-emit para messages sem transcript > 2min

UI /history:
  → JOIN messages + transcripts
  → renderiza badge "transcrevendo..." se null, texto se present
```

## Recomendações Fase 6

1. **Filter de relevância**: `lib/pipeline/filter.ts` que drop mensagens `ok`/`kkk`/stickers, boost áudios longos + keywords.
2. **Tópicos/agrupamento**: clusterização temporal simples (gap > 30min = novo tópico) para MVP. Embeddings ficam pós-MVP.
3. **Service `getMessagesForPeriod(tenantId, groupId, periodStart, periodEnd)`** retornando messages + transcripts normalizados → input pro LLM na Fase 7.
4. Tracking de custo pode entrar junto: migration + `ai_calls` inserts nos workers existentes.
