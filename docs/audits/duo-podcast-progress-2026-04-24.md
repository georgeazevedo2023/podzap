# Andamento — Duo podcast (Ana + Beto) · 2026-04-24

## O que foi implementado (commit `15c31e4`)

End-to-end: modal `/home` → API → Inngest → generator → DB → TTS
→ áudio WAV multi-speaker.

### Schema
- `db/migrations/0010_summary_voice_mode.sql` aplicada em prod:
  `summaries.voice_mode text default 'single' check in ('single','duo')`

### Backend
- `lib/summary/prompt.ts` — prompt **v3** com 2 variantes:
  - **SOLO**: narrador descontraído, pode saudar audiência do grupo
  - **DUO**: instrui LLM a gerar linhas `Ana: …` / `Beto: …`
  - `promptVersion = podzap-summary/v3-<mode>-<tone>`
- `lib/ai/gemini-tts.ts` — novo `mode: 'single' | 'duo'`:
  - solo: `prebuiltVoiceConfig` (Kore/Charon)
  - duo: `multiSpeakerVoiceConfig` com Ana (Kore) + Beto (Charon)
- `lib/summary/generator.ts` — grava `voice_mode` no row
- `lib/audios/service.ts` — lê `voice_mode` do summary, passa pro TTS
- `inngest/events.ts` — `summary.requested` carrega `voiceMode?`
- `inngest/functions/generate-summary.ts` — passthrough

### API + UI
- `POST /api/summaries/generate` aceita `voiceMode` no body
- `GenerateNowModal` ganhou RadioPill "formato do áudio" (default **duo**)

### Tests
- 342/342 passando (12 do prompt v3 + todos anteriores)
- Mocks atualizados: SummaryRow + fixtures

## Status de deploy
- Commit `15c31e4` pushed ✅
- CI: **pendente** (aguardando)
- Portainer redeploy: **pendente**

## Próximo passo
1. Aguardar CI verde
2. Disparar Portainer webhook
3. Rodar `e2e/generate-flow.spec.ts` — precisa bumped pra passar `voiceMode: 'duo'` no body OU deixar o default da UI (já é duo)
4. Colher signed URL do WAV duo e entregar

## Notas
- Entre a v1 e a v3, apaguei uma summary/audio de teste (v1 original) pra não poluir. v2 foi ouvida pelo usuário; v3 duo é o que falta entregar.
- Se Gemini TTS tiver algum issue com multi-speaker em PT-BR, fallback manual é voltar `voiceMode` pra 'single' no modal (UI preserva opção).
