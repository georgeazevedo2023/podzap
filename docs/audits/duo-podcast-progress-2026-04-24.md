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
- CI: **verde** (run 24887584228 + run 24887616302)
- Portainer redeploy: **disparado** (webhook 204) ✅
- Produção rodando v3-duo ✅

## Resultado end-to-end (2026-04-24 08:46 BRT)

Spec `e2e/generate-flow.spec.ts` passou contra prod em 2.5 min.

| campo | valor |
|---|---|
| summary_id | `ce1a6062-2645-4d87-89b7-d6a68ecdf746` |
| tenant_id | `13d4eb57-48fe-47b3-8902-fea11a850396` |
| status | `approved` |
| voice_mode | **`duo`** |
| tone | `fun` |
| prompt_version | `podzap-summary/v3-duo-fun` |
| audio size | 9.04 MB WAV |
| audio duração | **188 s** (~3m08s) |
| TTS model | `gemini-2.5-flash-preview-tts` |
| delivered_to_whatsapp | `true` (11:47:30 UTC) |
| storage_path | `audios/13d4eb57-48fe-47b3-8902-fea11a850396/2026/ce1a6062-2645-4d87-89b7-d6a68ecdf746.wav` |

Texto (amostra): `Ana: boa noite, ouvintes do PRO TOOLS BOX| NETWORK PRIME! / Beto: Boa noite, Ana! Que grupo agitado, hein?...` — diálogo natural Ana×Beto alternando falas, com brasileirismos (*cirúrgico*, *pra galera*, *hein?*). Gemini TTS produziu duas vozes distintas (Kore + Charon) no mesmo WAV 24 kHz mono.

## Notas
- Entre a v1 e a v3, apaguei uma summary/audio de teste (v1 original) pra não poluir. v2 foi ouvida pelo usuário; v3 duo entregue.
- Durante este ciclo ficaram 3 summaries extras pending/approved: `e795b06b` (duo, 11:43, delivered), `34554cc0` (duo, 11:48, **sem audio** — artefato de um 2º run que matei enquanto Playwright gerava report HTML blocante) e `717323a4` (v2 solo, 11:11, delivered). Limpeza pós-MVP — não deletei porque todos foram entregues ao grupo no WhatsApp.
- Pitfall de logging: `tee` + `tail -f` em Git Bash não flushou stdout do playwright pro arquivo — só o Monitor capturou o PIPELINE RESULT. Se reusar esse padrão, preferir `--reporter=json --output results.json`.
- Fallback se Gemini TTS der ruim em PT-BR multi-speaker: voltar `voiceMode` pra 'single' no modal (UI preserva opção).
