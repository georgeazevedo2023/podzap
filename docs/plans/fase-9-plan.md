# Fase 9 — TTS (geração de áudio)

**Objetivo:** resumo aprovado vira arquivo de áudio (Gemini Speech) no Storage.

**Pré-condição:** Fase 8. Summaries com `status='approved'`.

## Componentes

### Storage
- Bucket `audios` (privado) separado do `media`
- Path: `<tenant_id>/<yyyy>/<summary_id>.<ext>` (ext=wav inicial, pode ser mp3 depois)
- RLS análoga ao `media`

### Worker
- `inngest/functions/generate-tts.ts` on `summary.approved`
- Steps: load summary → call `generateAudio` (gemini-tts.ts) → upload Storage → insert audios → trackAiCall

### Rotas
- `GET /api/audios/:summaryId/signed-url` — retorna signed URL pra UI tocar

### Service
- `lib/audios/service.ts`:
  - `createAudioForSummary(tenantId, summaryId)` — orquestra (usado pelo worker)
  - `getAudioBySummary(tenantId, summaryId): AudioView | null`
  - `listAudios(tenantId, opts?)`

### Migration (opcional)
- Se faltar coluna, adicionar. `audios` table já existe mas verificar `storage_path` + `mime_type`

## Agentes (Agente 1 sequencial, depois 4 paralelos)

### Agente 1 — Bucket + service + worker
- Criar bucket `audios` via script
- RLS policies (análogas ao media)
- `lib/audios/service.ts` + tests
- `inngest/functions/generate-tts.ts` (on `summary.approved`) + register em `/api/inngest`
- Gemini TTS integration já existe (`lib/ai/gemini-tts.ts`)

### Agente 2 — API routes + signed URL
- `GET /api/audios/[summaryId]/signed-url`
- `GET /api/audios` lista
- Auth + RLS

### Agente 3 — UI `/history` integrar player audio
- Mostrar áudio aprovado junto com summary na timeline
- `<audio controls>` com signed URL

### Agente 4 — Approval UI updates
- Após aprovar, polling do `/api/audios/[summaryId]/signed-url` até retornar 200
- Mostrar "gerando áudio..." durante
- Quando pronto, link pra download + player

### Agente 5 — Docs + status
- `docs/integrations/tts.md`
- CLAUDE §15 + ROADMAP + README

## Aceite

- [ ] Aprovar summary → worker dispara → áudio em Storage em < 60s
- [ ] Signed URL retorna áudio playable
- [ ] Row em `audios` com mime, duration, path
- [ ] `ai_calls` com tokens/duration
- [ ] typecheck + tests + build

## Riscos

- **Gemini TTS limite**: max ~5000 chars por chamada. Se resumo > 5000, chunk + concat.
- **Formato**: wrapper atual retorna WAV com header RIFF inline. Conversão pra MP3 (menor) ficaria pós-MVP.
- **Voice names em PT-BR**: precisa testar quais voices Gemini suporta bem PT.

Ordem: A1 sequencial, depois 4 paralelos.
