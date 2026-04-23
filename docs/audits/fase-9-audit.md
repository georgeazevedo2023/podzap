# Auditoria — Fase 9 (TTS)

Auditor: Claude (Opus 4.7 1M). 2026-04-22.

## Veredito

**PASS.** Infra TTS completa + storage isolado + polling client + docs. 13 testes novos (213 total). E2E real só com custo API.

## Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 213/213 |
| build | ✅ inclui /podcasts + /api/audios + /api/audios/[id]/signed-url |

## Destaques

- Bucket `audios` isolado do `media` + 4 RLS policies
- Service `createAudioForSummary` idempotente (ALREADY_EXISTS guard), best-effort tracking
- `getSignedUrl` generalizado bucket-agnostic com backcompat
- Polling client em `/approval/[id]` com timeout 60s + retry button
- Nova página `/podcasts` com audio controls nativo + fallbacks (pulsando/erro)
- Error codes TTS_ERROR (502) + ALREADY_EXISTS (409) mapeados em `_shared.ts`

## Débitos

1. **Chunking > 5000 chars** não implementado — resumos longos falham
2. **Speed é placebo** — coluna `speed` audit only
3. **WAV format** (não MP3) — arquivos maiores em Storage
4. **Voices PT-BR** fixas (Kore/Charon) sem validação formal
5. **Audio retry manual** — se Inngest desistir após 2 retries, user precisa recriar

## Recomendações Fase 10

1. Worker `deliver-to-whatsapp` on `audio.created` event
2. UAZAPI `sendAudio(instanceToken, groupJid, buffer)` já existe
3. Marcar `audios.delivered_to_whatsapp=true, delivered_at=now()`
4. Enviar texto também (legenda configurável)
