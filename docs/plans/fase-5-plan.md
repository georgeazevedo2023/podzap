# Fase 5 — Transcrição multimodal

**Objetivo:** toda mensagem `type IN ('audio','image')` gerada em grupos monitorados recebe texto (áudio → Groq Whisper, imagem → Gemini Vision) persistido em `transcripts`.

**Pré-condição:** Fase 4. Mensagens aparecem em `messages` com `media_download_status='downloaded'` (ou 'pending' que o worker resolve).

## Infra de workers: Inngest

Escolha: Inngest pela simplicidade (events + retry automático + dashboard). Alternativa descartada: Trigger.dev (mais complexo pra este escopo).

Em dev: `npx inngest-cli dev` roda localmente + assina em `/api/inngest` do Next. Em prod: Vercel + Inngest cloud.

### Eventos

- `message.captured` — emitido pelo webhook handler após persist (Agente 1 adiciona)
- `message.transcription.requested` — pra refazer on-demand
- `media.download.retry` — pra pending stale

### Funções

1. `transcribe-audio` — trigger: `message.captured` onde `type=audio`
   - Carrega `messages` row via service role
   - Verifica `media_download_status='downloaded'`; se pending, trigger backoff
   - Gera signed URL → Groq Whisper → upsert em `transcripts`
2. `describe-image` — trigger: `message.captured` onde `type=image`
   - Similar, usa Gemini Vision
3. `retry-pending-downloads` — cron a cada 5min, processa `media_download_status='pending'` mais velhos que 2min
4. `transcription-retry` — retry failed transcripts com backoff

## Files

### Fixtures fase-4 para dev
- Áudio OGG de 5s (um "hello world" em PT-BR) em `lib/webhooks/fixtures/media/`
- Imagem JPG pequena com texto visível

### Código
- `app/api/inngest/route.ts` — Inngest serve handler
- `inngest/client.ts` — Inngest client export
- `inngest/functions/transcribe-audio.ts`
- `inngest/functions/describe-image.ts`
- `inngest/functions/retry-pending.ts`
- `inngest/events.ts` — event type map
- `lib/transcripts/service.ts` — `upsertTranscript(messageId, text, metadata)`, `getTranscript(messageId)`
- Update `lib/webhooks/persist.ts` — após insert, `inngest.send({ name: 'message.captured', data: { messageId, tenantId, type } })`

## Tarefas (5 agentes)

### Agente 1 — Inngest setup + emit events
- Instalar `inngest` npm
- Criar client + serve handler em `/api/inngest`
- Criar event schema + função de health `ping`
- Hook no `lib/webhooks/persist.ts`: após `persisted`, emit `message.captured`
- Testar `npx inngest-cli dev` + dispatch do event via curl

### Agente 2 — Função transcribe-audio (Groq)
- `inngest/functions/transcribe-audio.ts`:
  - step: carregar message + verificar downloaded
  - step: signed URL pro Storage
  - step: Groq `transcribeAudio({ url })` (o wrapper em `lib/ai/groq.ts` existe)
  - step: `upsertTranscript(messageId, text, { language, model })`
  - Retry com backoff (Inngest config)
- Testes unit com mock de fetch

### Agente 3 — Função describe-image (Gemini Vision)
- `inngest/functions/describe-image.ts`:
  - Similar, usa `lib/ai/gemini-vision.ts`
  - Prompt default: "Descreva o conteúdo desta imagem em português, focando em texto visível e elementos relevantes para um resumo de conversa."
  - Salva em `transcripts.text`
- Testes unit

### Agente 4 — Service layer + retry scheduler
- `lib/transcripts/service.ts`: CRUD typed
- `inngest/functions/retry-pending.ts` — cron 5min, busca `media_download_status='pending' AND created_at < now() - interval '2 minutes'`, chama `downloadAndStore`
- `inngest/functions/transcription-retry.ts` — events de falha, backoff exponencial
- Testes

### Agente 5 — UI + docs + status feedback
- `/history`: mostrar transcrição junto da mensagem áudio/imagem (quando existe)
- `docs/integrations/inngest.md`: setup dev + prod, event map, retry policy
- `CLAUDE.md` + `ROADMAP.md` fase 5 status
- Adicionar spinner/pending state em `MessagesList` quando áudio/image sem transcript

## Critério de aceite

- [ ] typecheck + build + tests (target 100+)
- [ ] Inngest dev server roda sem erro
- [ ] Dispatch manual de `message.captured` → worker executa
- [ ] Fixture de áudio processada → texto em `transcripts`
- [ ] Fixture de imagem → descrição em `transcripts`
- [ ] Retry de pending funciona (cron)
- [ ] `/history` mostra transcrição
- [ ] Screenshots + audit

## Riscos

- **Custo**: Groq + Gemini têm custo por chamada. Fixture-based test evita queima até ter instância real.
- **Inngest dev quirks**: recebe eventos via polling localhost.
- **Tamanho de áudio**: Groq Whisper limit ~25MB. Para grupos longos, chunk.
- **Erro de descrição em imagens sensíveis**: Gemini bloqueia. Tratar + marcar `transcription_failed`.

## Ordem

Agente 1 primeiro (setup Inngest + client) → demais em paralelo.
