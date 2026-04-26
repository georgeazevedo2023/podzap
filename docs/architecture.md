# Arquitetura — podZAP

## Stack

| Camada | Ferramenta | Motivo |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + React 19 | Já casa com os mockups JSX, SSR, rotas API no mesmo repo |
| Styling | Tailwind v4 + tokens CSS customizados | Tokens em `app/globals.css` (portados de `podZAP/tokens.css`, paleta "Biscoito x Vida Infinita") |
| Auth + DB + Storage | Supabase (Postgres + RLS + Auth + Storage) | Multi-tenant via RLS, auth pronta, storage pra áudios/mídia |
| WhatsApp | UAZAPI (`wsmart.uazapi.com`) | API REST + webhooks, suporta QR code e envio de mídia |
| Webhook relay | n8n (`fluxwebhook.wsmart.com.br`) | Assina HMAC + forwarda pra app + roda cron tick |
| Transcrição áudio | Groq (Whisper Large v3) | Rápido e barato |
| Visão (imagem) | Gemini 2.5 Flash Vision | Multimodal, barato |
| LLM (resumo) | Gemini 2.5 Pro (principal) / GPT-4.1 (fallback) | Qualidade narrativa |
| TTS | Gemini 2.5 Flash TTS | Vozes Kore/Charon, single ou duo |
| Filas/Workers | Inngest | Pipeline assíncrono event-driven com retry; crons via n8n bate em `/api/worker/tick` |
| Deploy | Hetzner + Portainer (Docker stack) | Self-hosted; **NÃO** usamos Vercel |
| Auto-build | GitHub Actions → GHCR `ghcr.io/georgeazevedo2023/podzap:latest` | Image publicada em cada merge na `main` |

## Diagrama de fluxo

```
┌─────────────┐  webhook   ┌────────────┐  HMAC fwd   ┌─────────────────┐
│   UAZAPI    │──────────▶ │    n8n     │ ──────────▶ │  /api/webhooks/ │
│  (WhatsApp) │            │  (relay +  │             │      uazapi     │
└─────────────┘            │   cron)    │             └────────┬────────┘
       ▲                   └─────┬──────┘                      │ persist + emit
       │ /send/media             │ POST /api/worker/tick       ▼
       │ /message/download       │ (Bearer token, ~30s)  ┌────────────┐
       │                         ▼                       │  Inngest   │
       │                  ┌──────────────┐               │   Cloud    │
       │                  │ runSchedules │               │  (events)  │
       │                  │ retryPending │               └─────┬──────┘
       │                  │ transcrRetry │                     │
       │                  └──────┬───────┘                     │
       │                         │ trigger workers             │
       │                         ▼                             ▼
       │                  ┌─────────────────────────────────────────┐
       │                  │  Inngest workers (event-driven)         │
       │                  │  transcribe-audio · describe-image      │
       │                  │  generate-summary · generate-tts        │
       │                  │  media-download-retry · ping            │
       │                  └────────────────┬────────────────────────┘
       │                                   │
       │                                   ▼
       │  ┌──────────────────────────────────────────────────────────┐
       └──│  Next.js App (Hetzner + Portainer)                       │
          │  - app/(app) tenant UI · app/(admin) superadmin UI       │
          │  - lib/uazapi · lib/ai · lib/pipeline · lib/summary      │
          │  - lib/delivery · lib/audios · lib/webhooks              │
          └─────────┬──────────────────────────────────────┬─────────┘
                    │ RLS tenant_id                        │
                    ▼                                      ▼
          ┌──────────────────┐              ┌──────────────────────────┐
          │     Supabase     │              │  AI providers            │
          │  Postgres + RLS  │              │  Groq Whisper · Gemini   │
          │  Auth · Storage  │              │  2.5 Pro · 2.5 Flash TTS │
          │  (media+audios)  │              │  · 2.5 Flash Vision      │
          └──────────────────┘              └──────────────────────────┘
```

## Decisões críticas

- **Híbrido n8n + Inngest:** Inngest é event-bus interno (`message.captured`, `summary.requested`, `summary.approved`). Crons foram migrados pro n8n batendo em `/api/worker/tick` a cada ~30s — esse endpoint reusa os mesmos handlers puros (`runSchedulesHandler`, `retryPendingDownloadsHandler`, `transcriptionRetryHandler`). **NÃO criar worker novo event-driven dentro do n8n** — só relay UAZAPI + cron tick.
- **Aprovar ≠ enviar:** delivery exige clique humano explícito. Worker `deliver-to-whatsapp` foi desregistrado intencionalmente. `audio.created` é emitido por `generate-tts` mas ninguém ouve. Entrega só via clique em `/podcasts` → `SendToMenu` → `POST /api/audios/[id]/redeliver`.
- **HMAC obrigatório no webhook:** sem `UAZAPI_WEBHOOK_HMAC_SECRET` em prod, app fail-closed com 500. Anti-downgrade: header `x-podzap-signature` presente sem secret válido NÃO cai pra legacy `?secret=`.
- **`.enc` decryption:** WhatsApp manda URLs encrypted; `lib/uazapi/client.ts::downloadMedia` chama `POST /message/download` da UAZAPI pra resolver pra URL plain antes do fetch.
- **Multi-tenant via RLS:** toda tabela tenant-scoped tem RLS habilitada. Service role bypassa — handlers que usam admin client filtram `tenant_id` explicitamente.

Detalhe de cada subsistema: [`docs/integrations/`](integrations/README.md).
