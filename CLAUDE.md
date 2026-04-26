# podZAP — Contexto para Claude

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
> Mantenha-o atualizado conforme o projeto evolui.

---

## 1. O que é o podZAP

SaaS **multi-tenant** que transforma conversas de grupos do WhatsApp em **resumos em áudio estilo podcast** (formato duo Ana+Beto, default).

Fluxo essencial:
`mensagens zap → transcrição (áudio+imagem) → resumo IA → aprovação humana → TTS → entrega manual via /podcasts`

**Diferencial:** aprovação humana **obrigatória** antes do áudio ser gerado E antes de ser enviado ao grupo (2 cliques distintos — ver §16).

Source of truth do produto: este arquivo + [`docs/MVP-COMPLETION.md`](docs/MVP-COMPLETION.md). PRD original não está versionado no repo.

---

## 2. Stack

| Camada | Ferramenta | Motivo |
|---|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + React 19 | Já casa com os mockups JSX, SSR, rotas API no mesmo repo |
| Styling | Tailwind v4 + tokens CSS customizados | Tokens já definidos em `podZAP/tokens.css` (paleta "Biscoito x Vida Infinita") |
| Auth + DB + Storage | Supabase (Postgres + RLS + Auth + Storage) | Multi-tenant via RLS, auth pronta, storage para áudios |
| WhatsApp | UAZAPI | API REST + webhooks, suporta QR code e envio de mídia |
| Transcrição de áudio | Groq (Whisper Large v3) | Rápido e barato |
| Visão (OCR/imagem) | Gemini 2.5 Flash Vision | Multimodal, barato |
| LLM (resumo) | Gemini 2.5 Pro (principal) / GPT-4.1 (fallback) | Qualidade narrativa |
| TTS | Gemini Speech API | Controle de voz/estilo/velocidade |
| Filas/Workers | Inngest (ou Trigger.dev) | Pipeline assíncrono com retry |
| Deploy | **Hetzner + Portainer (Docker stack)** + Supabase (db) | Self-hosted; NÃO usamos Vercel |

---

## 3. Arquitetura

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

---

## 4. Estrutura de pastas (real)

```
podzap/
├── CLAUDE.md                    ← este arquivo (orquestrador da sessão)
├── ROADMAP.md                   ← fases + status de cada uma
├── proxy.ts                     ← Next.js middleware (auth + admin gate)
├── docker-compose.stack.yml     ← stack Portainer (prod)
├── Dockerfile                   ← multi-stage build
├── .env.local · .env.example · .env.production.example
├── docs/                        ← ver docs/README.md (índice top-level)
│   ├── MVP-COMPLETION.md
│   ├── api/ · audits/ · deploy/ · integrations/
│   ├── internals/ · plans/ · scaffolds/ · ui-components/
├── podZAP/                      ← MOCKUPS (source of truth visual — §18)
│   └── screen_*.jsx · tokens.css · shell.jsx · components.jsx
├── app/
│   ├── (app)/                   ← rotas autenticadas (tenant) — dark theme
│   │   └── home/ groups/ approval/ history/ podcasts/ schedule/ onboarding/
│   ├── (admin)/admin/           ← rotas superadmin — dark theme
│   │   └── tenants/ users/ uazapi/
│   ├── login/ logout/ auth/     ← rotas públicas
│   ├── api/                     ← 35 rotas (ver docs/api/README.md)
│   │   ├── webhooks/uazapi/ · worker/tick/
│   │   ├── inngest/ · admin/ · summaries/ · audios/ · schedules/
│   │   └── groups/ · whatsapp/ · me/
│   └── layout.tsx · globals.css · page.tsx (landing)
├── lib/
│   ├── supabase/                ← server / browser / admin clients
│   ├── uazapi/                  ← client + types (zod) + crypto helpers
│   ├── ai/                      ← groq · gemini-{llm,vision,tts} · openai (fallback)
│   ├── webhooks/                ← validator (HMAC) · handler · persist
│   ├── pipeline/                ← filter · cluster · normalize (rule-based)
│   ├── summary/ · audios/ · delivery/ · schedules/ · transcripts/
│   ├── stats/ · admin/ · groups/ · whatsapp/
│   ├── media/                   ← download (com .enc decryption) · signed URLs
│   └── crypto.ts · ratelimit.ts · tenant.ts · time/
├── inngest/
│   ├── client.ts · events.ts    ← eventos canônicos (case-sensitive)
│   ├── functions/               ← 9 workers registrados (ver §11)
│   └── handlers/                ← handlers puros reusados pelo n8n /worker/tick
├── components/
│   ├── ui/                      ← Button, Modal, Select, SendToMenu, PodCover, …
│   ├── shell/                   ← TopBar, Sidebar, AppSidebar, AdminSidebar
│   └── icons/Icons.tsx
├── db/migrations/               ← 15 migrations SQL aplicadas via scripts/db-query.mjs
├── scripts/                     ← db-query, gen-types, set-superadmin (com confirm)
├── tests/                       ← 356 testes Vitest
├── e2e/                         ← Playwright (executados contra prod)
└── public/
```

---

## 5. Modelo de dados (resumo)

Tabelas em `public` (todas com RLS — tipos gerados em `lib/supabase/types.ts`):

| Tabela | Função |
|---|---|
| `tenants` | Isolamento multi-tenant (`is_active`, `plan`, `include_caption_on_delivery`, `delivery_target`) |
| `tenant_members` | Liga `auth.users` ↔ `tenants` com `role` + `phone_e164` |
| `superadmins` | Bit global cross-tenant — staff podZAP (helper `public.is_superadmin()`) |
| `whatsapp_instances` | Conexão UAZAPI **1:1 por tenant** (`uazapi_token_encrypted`, `uazapi_instance_name`, `status`) |
| `groups` | Grupos sincronizados (`is_monitored` controla pipeline) |
| `messages` | Mensagens capturadas (`type ∈ {text,audio,image,video,other}`, `media_*`, `raw_payload` cru) |
| `transcripts` | Texto de áudio (Groq) ou descrição de imagem (Gemini Vision) |
| `summaries` | Resumo gerado (`status ∈ {pending_review, approved, rejected}`, `voice_mode ∈ {single,duo}`, `caption`, `prompt_version`) |
| `audios` | WAV final (`storage_path`, `delivered_to_whatsapp`, `uazapi_delivered_message_id` — distingue podcast vs áudio do owner) |
| `schedules` | Agendamento por grupo (`approval_mode ∈ {optional,required}` — `auto` baniu via CHECK 0011) |
| `ai_calls` | Custo tracking por chamada (provider, model, tokens, cost_cents, summary_id) |

**Toda query DEVE respeitar `tenant_id` via RLS.** Service role (workers Inngest, scripts) bypassa — sempre filtrar `tenant_id` explicitamente em handler.

---

## 6. Convenções

- **Idioma:** PT-BR em UI, commits, comentários, docs
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`)
- **Branches:** `main` protegida (CI publica imagem GHCR + webhook redeploy Portainer); features em `feat/<nome>`
- **Testes:** Vitest pra `lib/` e `inngest/`; Playwright e2e roda **contra prod** (não dev — memória `playwright_credentials`)
- **Secrets:** nunca commitar. `.env.local` no `.gitignore`. Env de prod no Portainer
- **Design:** não inventar tokens novos — usar os de `app/globals.css` (portados de `podZAP/tokens.css`); checar `components/ui/` antes de criar componente
- **Multi-tenant:** todo handler que toca DB filtra `tenant_id` explicitamente; nunca confiar só em RLS quando service role estiver em jogo
- **Linguagem do produto:** "podcast" (não "resumo"), "áudio" (não "WAV"), "grupo" (não "chat")

---

## 7. Como rodar

```bash
# install
npm install

# dev server (porta 3000)
npm run dev

# Inngest dev (em outro terminal — aponta pra app local)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
# dashboard: http://127.0.0.1:8288

# aplicar migration nova (via Supabase Management API, não supabase CLI)
node --env-file=.env.local scripts/db-query.mjs db/migrations/0015_xxx.sql

# rodar SQL ad-hoc
node --env-file=.env.local scripts/db-query.mjs --sql "select count(*) from messages"

# regenerar tipos depois de migration
node --env-file=.env.local scripts/gen-types.mjs

# n8n cron tick (em dev, n8n não roda — invocar manual quando precisar testar schedule)
curl -X POST http://localhost:3000/api/worker/tick \
  -H "Authorization: Bearer $WORKER_TICK_TOKEN"

# tests
npx vitest run tests/        # unit (Vitest)
npx playwright test e2e/     # e2e (CONTRA PROD — ver memória)

# typecheck + build
npx tsc --noEmit && npm run build
```

**Operacional rápido** (mais detalhes em [`docs/deploy/README.md`](docs/deploy/README.md)):
- Prod: https://podzap.wsmart.com.br
- Portainer: https://app.wsmart.com.br · Stack: `podzap`
- Supabase project: `vqrqygyfsrjpzkaxjleo`
- N8n: https://fluxwebhook.wsmart.com.br
- Redeploy webhook (após CI verde): `POST https://app.wsmart.com.br/api/webhooks/85b67741-...` (ver memória `deploy_portainer_webhook`)

---

## 8. Status atual — **MVP COMPLETO + extensões pós-MVP**

Métricas (2026-04-26): **356 testes**, **35 rotas HTTP**, **9 workers Inngest registrados**, **15 migrations**, **~49k LOC TS/TSX**. Relatório completo: [`docs/MVP-COMPLETION.md`](docs/MVP-COMPLETION.md). Trilha cronológica de mudanças: [`docs/audits/`](docs/audits/README.md) (sessões + audits por fase).

- [x] Fase 0: scaffolding Next.js + Supabase
- [x] Fase 1: Auth + multi-tenancy (RLS) — *signup auto-cria tenant foi removido na Fase 13*
- [x] Fase 2: conexão WhatsApp (UAZAPI)
- [x] Fase 3: listagem e seleção de grupos
- [x] Fase 4: captura de mensagens via webhook
- [x] Fase 5: transcrição multimodal (Groq Whisper + Gemini Vision via Inngest)
- [x] Fase 6: filtro + clustering (rule-based)
- [x] Fase 7: resumo (Gemini 2.5 Pro)
- [x] Fase 8: aprovação humana (`pending_review → approved | rejected`, regenerate)
- [x] Fase 9: TTS (Gemini 2.5 Flash → WAV no bucket `audios`) — *com música de fundo desde commit `3a8d621`*
- [x] Fase 10: entrega — **manual via `/podcasts` + `SendToMenu`** (worker `deliver-to-whatsapp` desregistrado intencionalmente, ver §16)
- [x] Fase 11: agendamento (cron via n8n → `/api/worker/tick` → `runSchedulesHandler`) — *`approval_mode='auto'` baniu via CHECK 0011, sempre cai em `pending_review`*
- [x] Fase 12: dark theme `(app)`, superadmin (0007 + `scripts/set-superadmin.mjs --yes`), home 1:1 com mockup ✅ PASS WITH CONCERNS — [`docs/audits/fase-12-audit.md`](docs/audits/fase-12-audit.md)
- [x] Fase 13: admin-managed tenancy (0008, sem signup público, login email+senha, `/admin/*` gated 3 camadas) ✅ PASS WITH CONCERNS — [`docs/audits/fase-13-audit.md`](docs/audits/fase-13-audit.md)
- [x] Pós-fase: parser wsmart cobre audio/image/video (sessão 2026-04-25), `.enc` decryption via `/message/download`, `audios.uazapi_delivered_message_id` (0015), HMAC obrigatório
- [ ] Backlog ativo: ver [`ROADMAP.md`](ROADMAP.md) + débitos em [`docs/audits/`](docs/audits/README.md) sessions recentes

**Workers Inngest registrados** (em `app/api/inngest/route.ts`): `ping`, `describeImage`, `transcribeAudio`, `retryPendingDownloads`, `mediaDownloadRetry`, `transcriptionRetry`, `generateSummary`, `generateTts`, `runSchedules`. Worker `deliverToWhatsapp` existe mas **não está no array** — entrega é manual.

---

## 9. Notas para Claude

- Antes de iniciar fase nova, ler `ROADMAP.md` (ordem + dependências) e a sessão mais recente em `docs/audits/sessions/` (estado real)
- **Multi-tenant em toda query de banco** — sempre filtrar `tenant_id` explicitamente; service role bypassa RLS
- **Respostas em PT-BR** (UI, conversas, comentários)
- **Integrações externas (UAZAPI, Gemini, Groq):** preferir validação contra prod via Playwright (memória) ou rodando script local com `.env.local`; mock só quando o serviço externo é caro/lento de chamar
- **Aprovar ≠ enviar** (regra forte): áudio só vai pro grupo após clique humano em `/podcasts` (ver §16); nunca reativar `deliver-to-whatsapp` worker sem revisão UX
- **Antes de mover/renomear arquivo:** `grep -rn` por refs primeiro; muitas docs cross-link por path (ex.: 15+ refs no `MVP-COMPLETION.md` apontam pra `docs/audits/fase-N-audit.md`)
- **Env vars críticas que já causaram outage:** `UAZAPI_WEBHOOK_HMAC_SECRET`, `WORKER_TICK_TOKEN`, `ENCRYPTION_KEY` — checar Portainer antes de assumir bug de código

---

## 10. Pipeline UAZAPI (Fase 2+)

Referência completa: `docs/integrations/uazapi.md` (endpoints verificados live em 2026-04-22).

- **Base URL**: `UAZAPI_BASE_URL` (ex.: `https://wsmart.uazapi.com`)
- **2 tipos de token**:
  - **Admin** — env `UAZAPI_ADMIN_TOKEN`. Escopo: `POST /instance/init`, `GET /instance/all`. Nunca toca o browser.
  - **Instância** — único por tenant. Armazenado em `whatsapp_instances.uazapi_token_encrypted` (AES-256-GCM com `ENCRYPTION_KEY`). Usado em todo endpoint com escopo de número (`/instance/status`, `/instance/connect`, `DELETE /instance`, `/send/*`, `/group/*`, `/webhook`).
- **Modelo 0..1 por tenant**: cada tenant tem no máximo uma instância no MVP. Multi-instância por tenant fica pós-MVP.
- **Fluxo de conexão**:
  1. `createInstance(name)` (admin) → recebe `{ instance: { id, token } }`
  2. Encripta token + insere em `whatsapp_instances` com `status='connecting'`
  3. `getQrCode(instanceToken)` → `POST /instance/connect` → `{ qrCodeBase64, status }`
  4. UI renderiza `<img src="data:image/png;base64,${qrCodeBase64}">` + inicia polling
  5. Polling `getInstanceStatus(instanceToken)` a cada 2-3s até `'connected'`
  6. (Fase 4) webhook `connection` atualiza DB em tempo real
- **Webhooks**: `POST /webhook` body `{ url, events: ['messages', 'connection'], enabled: true }` com token de instância. Payload real do `wsmart.uazapi.com` usa shape `{ EventType, instanceName, message: {...} }` (**não** Evolution/Baileys). Schema em `lib/uazapi/types.ts` aceita ambos: UAZAPI-shape primeiro (prod), Evolution-shape fallback (fixtures). Desde 2026-04-25 o parser classifica `text` (incluindo `ExtendedTextMessage`), `audio`, `image` e `video` — extração lê `m.content.{URL,mimetype,seconds,PTT,fileLength}` (shape wsmart real, **keys em MAIÚSCULAS**) com fallbacks defensivos pra `m.url` / `m.audioMessage.url`. Sinal primário de tipo é `m.mediaType` ('ptt'/'image'/'video') > `m.messageType` (sufixo `Message` opcional, case-insensitive) > `m.type`. **`messages.raw_payload` armazena o body HTTP cru** (não o evento Zod-normalizado) pra permitir refino do parser depois sem replay. Reaction/Sticker/Contact/Document/Poll seguem em `type=other` (preserva `rawType` original).
- **Media decryption (`.enc` URLs)**: WhatsApp manda URLs encrypted (`mmg.whatsapp.net/...enc`) que precisam de mediaKey + AES pra decriptar. `lib/uazapi/client.ts::downloadMedia(token, msgId)` chama `POST /message/download` com `return_link: true` e recebe `{ fileURL, mimetype }` — URL CDN UAZAPI plain. `lib/media/download.ts::downloadAndStore` aceita opt `uazapiResolve: { instanceToken, whatsappMessageId }` — quando URL é `.enc` E opts presentes, resolve via UAZAPI antes do fetch. `webhook/persist.ts` + retry workers (`retry-pending`, `media-download-retry`) plumbam o opt automaticamente. Quando opt ausente em URL `.enc`, falha rápido com reason descritivo.
- **HMAC obrigatório em prod**: env var `UAZAPI_WEBHOOK_HMAC_SECRET` precisa estar setada no Portainer. App fail-closed com 500 SERVER_MISCONFIG se header `x-podzap-signature` chega sem o secret presente (não cai pra legacy `?secret=` — anti-downgrade). N8n flow assina cada body forwarded com HMAC-SHA256 hex usando esse mesmo secret.
- **Lookup de instância no webhook**: `lib/webhooks/persist.ts::findInstanceByUazapiRef` tenta `whatsapp_instances.uazapi_instance_name` (UAZAPI shape traz `instanceName`) primeiro, fallback pra `uazapi_instance_id` (Evolution shape / legacy). Coluna `uazapi_instance_name` adicionada em migration `0009_uazapi_instance_name.sql`.
- **Delete**: `DELETE /instance` com **token de instância** (não admin — retorna 401).
- **QR quirk**: servidor devolve `data:image/png;base64,…` com prefixo; o client em `lib/uazapi/client.ts` tira o prefixo e o caller adiciona de volta uma única vez.
- **Rate limit**: `UazapiClient` tem token bucket interno; API routes têm rate limit in-memory 30/min/tenant. Em produção, considerar Upstash para limitar cross-instance.
- **Sidebar indicator**: `app/(app)/layout.tsx` faz `SELECT status, phone FROM whatsapp_instances WHERE tenant_id=… LIMIT 1` via admin client e passa pro `AppSidebar` → `Sidebar` (prop `whatsappStatus` + `whatsappPhone`). Falhas degradam silenciosamente para `'none'`.

---

## 11. Pipeline de transcrição (Fase 5+)

Referência completa: `docs/integrations/inngest.md` (setup dev/prod, events, troubleshooting).

Fluxo de alto nível — tudo assíncrono, desacoplado do webhook:

```
UAZAPI webhook                             n8n cron (24/7)
      │                                          │
      ▼                                          ▼
/api/webhooks/uazapi  →  persist.ts       /api/worker/tick  (Bearer WORKER_TICK_TOKEN)
      │                        │                 │
      │                        └─ insert + emit  ├─ runSchedulesHandler
      ▼                                          ├─ retryPendingDownloadsHandler
Inngest  (app/api/inngest/route.ts)              └─ transcriptionRetryHandler
      ├─ transcribe-audio  (trigger: message.captured · type=audio)  → Groq Whisper → transcripts
      ├─ describe-image    (trigger: message.captured · type=image)  → Gemini Vision → transcripts
      ├─ media-download-retry (trigger: media.download.retry)        → re-download
      ├─ generate-summary  (trigger: summary.requested)
      ├─ generate-tts      (trigger: summary.approved)
      └─ ping              (trigger: test.ping — health-check)
```

- **Híbrido n8n + Inngest** (memória): Inngest é o event-bus interno disparado por eventos (`message.captured`, `summary.requested`, `summary.approved`). Crons foram migrados pra n8n batendo em `POST /api/worker/tick` a cada 30s — esse endpoint reusa o mesmo handler puro (`runSchedulesHandler`, `retryPendingDownloadsHandler`, `transcriptionRetryHandler` em `lib/`/`inngest/handlers/`). **Nada de criar worker novo event-driven dentro do n8n** — só relay UAZAPI + cron tick.
- **Events canônicos** (`inngest/events.ts`): `message.captured`, `summary.requested`, `summary.approved`, `audio.created`, `media.download.retry`, `test.ping`. Case-sensitive. `message.transcription.requested` e `media.download.retry` estão definidos mas sem emissor ativo (legado de design pre-MVP — ver §16 sobre `audio.created`).
- **Em dev**: `INNGEST_DEV=1` + `npx inngest-cli@latest dev -u http://localhost:3001/api/inngest`. Crons n8n não disparam em dev — invocar `/api/worker/tick` manualmente com `Authorization: Bearer $WORKER_TICK_TOKEN` ou rodar o handler pela CLI.
- **Em prod**: `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` na stack Portainer. Inngest Cloud só recebe os eventos disparados; o cron-tick vem do n8n via shared secret.
- **Retry**: default Inngest (3x backoff exponencial); falhas determinísticas (Gemini safety block) marcam e não re-agendam.
- **UI**: `/history` mostra transcrição inline sob cada mensagem áudio/imagem; badge pulsante "transcrevendo…" / "analisando imagem…" enquanto pendente.

---

## 12. Pipeline de normalização (Fase 6+)

Referência completa: `docs/integrations/pipeline.md`.

Fluxo puro (sem IO, exceto a query do orchestrator):

```
messages + transcripts (JOIN)
      │
      ▼
┌──────────────────┐   lib/pipeline/filter.ts
│  filterMessages  │   drop ruído + score [0,1]  → NormalizedMessage[]
└────────┬─────────┘
         │
         ▼
┌──────────────────┐   lib/pipeline/cluster.ts
│  clusterByTopic  │   gap temporal + jaccard   → Topic[]
└────────┬─────────┘
         │
         ▼
┌───────────────────────────────┐   lib/pipeline/normalize.ts
│  buildNormalizedConversation  │   orchestrator (admin client)
└───────────────────────────────┘
         │
         ▼
  NormalizedConversation → entrada pro LLM da Fase 7
```

- **Rule-based, não AI**: embeddings/clustering semântico ficam pós-MVP.
- Drop: stickers, stopwords PT (`ok`/`kkk`/…), URL-only, emoji-only, <3 chars sem mídia.
- Weight base `0.3` + boosts (áudio >20s, >100 chars, `?` final, keyword crítica, mídia visual), clamped `[0, 1]`.
- Cluster: single-pass por timestamp, quebra em `gap > 30min` (default) **ou** jaccard de participantes < 0.3. Keywords dominantes extraídas no final.
- `/pipeline-preview` (dev-only, `NODE_ENV !== 'production'`) é a UI de inspeção manual antes da Fase 7.

---

## 13. Geração de resumos (Fase 7+)

Referência completa: `docs/integrations/summary-generation.md`.

```
NormalizedConversation (Fase 6)
      │
      ▼
┌──────────────────────┐  lib/summary/prompt.ts
│  buildSummaryPrompt  │  (tone: formal | fun | corporate)
└──────────┬───────────┘
           │ prompt PT-BR + structured output schema
           ▼
┌──────────────────────┐  lib/ai/gemini-llm.ts
│   Gemini 2.5 Pro     │  { text, topics, estimatedMinutes }
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐  lib/summary/generator.ts
│  INSERT summaries    │  status = 'pending_review'
│  +  trackAiCall()    │  best-effort → ai_calls
└──────────┬───────────┘
           │
           ▼
   Fase 8 (aprovação humana) consome
```

- **Trigger**: `POST /api/summaries/generate` emite evento Inngest `summary.requested`; worker `generate-summary` orquestra.
- **Rate limit**: 10 gerações/hora/tenant no endpoint (protege contra loop + custo).
- **Custo**: toda chamada vai em `ai_calls` (provider, model, tokens, cost_cents, duration_ms, summary_id). Agregação via `getAiUsageForTenant()`.
- **Prompt versioning**: `podzap-summary/v<N>-<tone>` gravado em `summaries.prompt_version`; resumos antigos ficam com a versão antiga.
- **Anti-hallucination**: system prompt exige "APENAS informação presente"; participantes passados como lista fechada; top-20 mensagens por weight; structured output com `topics` cruzado contra os recebidos.

Tons disponíveis:

| Tom         | Quando usar                                       |
| ----------- | ------------------------------------------------- |
| `formal`    | B2B, comunicados corporativos, jurídico           |
| `fun`       | Grupos sociais, comunidades (default)             |
| `corporate` | Times internos, stand-ups assíncronos             |

---

## 14. Fluxo de aprovação (Fase 8)

Referência completa: `docs/integrations/approval.md`.

```
summaries.status = pending_review  (saída da Fase 7)
          │
          ▼
   /approval (lista) ──► /approval/[id] (detail + editor)
          │                       │
          │                       ├─ PATCH  /api/summaries/[id]            (edit text)
          │                       ├─ POST   /api/summaries/[id]/approve    → approved + emite summary.approved (→ Fase 9 TTS)
          │                       ├─ POST   /api/summaries/[id]/reject     → rejected (reason obrigatório)
          │                       └─ POST   /api/summaries/[id]/regenerate → NOVA row pending (original intocada)
          │
          ▼
  Sidebar badge = count(status='pending_review') por tenant
  (resolvido server-side em app/(app)/layout.tsx, refresca por request)
```

- **Service layer**: `lib/summaries/service.ts` — `approveSummary`, `rejectSummary`, `updateSummaryText`, `listSummaries({status})`.
- **Imutabilidade pós-terminal**: `approved` e `rejected` são finais. Editar texto só em `pending_review`.
- **Regenerate não transiciona a original**: mantém as duas rows pending pra permitir comparação lado-a-lado; auto-rejeição superseded fica pós-MVP.
- **Modos (PRD §9)**: `automático | aprovação opcional | aprovação obrigatória` — Fase 8 implementa todos como obrigatório. `schedules.approval_mode` (Fase 11) passa a roteá-los.

---

## 15. TTS (Fase 9)

Referência completa: `docs/integrations/tts.md`.

```
summaries.status = 'approved'
          │  emit summary.approved
          ▼
┌──────────────────────────┐  inngest/functions/generate-tts.ts
│  generate-tts worker     │  retries: 2
└─────────┬────────────────┘
          │ step.run('create-audio')
          ▼
┌──────────────────────────┐  lib/audios/service.ts
│ createAudioForSummary    │  load → check dup → TTS → upload → insert
└─────────┬────────────────┘
          │
          ▼
┌──────────────────────────┐  lib/ai/gemini-tts.ts
│ Gemini 2.5 Flash TTS     │  PCM 24kHz mono → WAV inline (RIFF header)
└─────────┬────────────────┘
          │
          ▼
  Storage bucket `audios` (privado)  + row em `audios` + trackAiCall
  path: <tenantId>/<yyyy>/<summaryId>.wav
          │
          ▼
  GET /api/audios/[summaryId]/signed-url  → UI toca áudio
```

- **Formato**: WAV (24 kHz · mono · 16-bit PCM). MP3 é pós-MVP.
- **Vozes**: `female='Kore'` (default), `male='Charon'` — mapeadas em `VOICE_MAP`.
- **Voice mode**: `single` (uma voz) ou `duo` (Ana+Beto conversando, default desde commit que entregou duo). Coluna `summaries.voice_mode` (migration 0010).
- **Música de fundo**: `lib/audios/mix.ts` mixa o TTS com track de background via `ffmpeg` (commit `3a8d621`). Volume calibrado pra não competir com voz.
- **Speed**: não-determinístico — apenas dica no prompt (Gemini TTS não tem knob real).
- **Chunking**: não implementado. Resumos > ~5000 chars podem falhar (gap documentado).
- **Erros**: `AudiosError` com `code ∈ { NOT_FOUND, ALREADY_EXISTS, TTS_ERROR, DB_ERROR }`. `ALREADY_EXISTS` em retry é sinal de sucesso idempotente.

---

## 16. Entrega (Fase 10)

Referência completa: `docs/integrations/delivery.md`.

> **Aprovar ≠ enviar.** Delivery exige clique humano explícito. Worker `deliver-to-whatsapp` foi **desregistrado** intencionalmente — `audio.created` é emitido por `generate-tts` mas ninguém ouve (event órfão por design). Ver memória `delivery_requires_manual_approval`.

```
audios row criada (Fase 9)
          │  emit audio.created   ← NINGUÉM OUVE (worker desregistrado)
          ▼
   /podcasts (lista) ── usuário clica "📤 enviar ao grupo" via SendToMenu
                                  │
                                  ▼
                     POST /api/audios/[id]/redeliver   (6/h/tenant)
                                  │
                                  ▼
                ┌──────────────────────────────┐  lib/delivery/service.ts
                │  deliverAudio(tenantId, id)  │  load ctx → check instance → download → sendAudio → mark
                └──────────────┬───────────────┘
                               │
                               ▼
                ┌──────────────────────────────┐  lib/uazapi/client.ts
                │  UAZAPI /send/media (PTT)    │  buffer WAV + caption opcional
                └──────────────┬───────────────┘
                               │
                               ▼
                  audios.delivered_to_whatsapp = true
                  audios.delivered_at          = now()
```

- **2 cliques**: (1) `/approval/[id]` → "aprovar" gera o áudio; (2) `/podcasts` → "📤 enviar ao grupo" publica.
- **Worker desregistrado**: `inngest/functions/deliver-to-whatsapp.ts` ainda existe mas **não está no array `functions: [...]`** de `app/api/inngest/route.ts`. Reativar exige adição manual lá + revisão UX.
- **`SendToMenu`** (`components/ui/SendToMenu.tsx`): destinos = "🔊 só escutar", "👥 grupo de origem", "📱 meu WhatsApp", "👤 outro contato". Reusa o mesmo dropdown via Portal em `/home`, `/approval/[id]`, `/podcasts`.
- **fromMe + audio (loop guard preciso)**: webhook recebe `fromMe=true` tanto pra (a) áudio do podcast que entregamos via UAZAPI quanto pra (b) áudio que o owner gravou no celular. Distinção via `audios.uazapi_delivered_message_id` (migration 0015) — `lib/delivery/service.ts::markDelivered` salva o id que UAZAPI retorna no `/send/media`, e `webhook/persist.ts` checa antes de skipar. Match → ignora (é nossa entrega); no match → processa (é áudio do owner pra resumo). Antes era skip cego em todo `fromMe+audio`, o que perdia áudios do owner.
- **Caption por tenant**: coluna `tenants.include_caption_on_delivery` (migration 0006) **existe e é lida** pelo código de `lib/delivery/service.ts` — flag tem default `true`. Não é débito; só não está exposta na UI ainda.
- **Erros**: `DeliveryError` com `code ∈ { NOT_FOUND, NO_INSTANCE, INSTANCE_NOT_CONNECTED, UAZAPI_ERROR, DB_ERROR }` — mapeado para 404 / 409 / 409 / 502 / 500 na rota `redeliver`.
- **Idempotência**: `deliverAudio` short-circuita se `delivered_to_whatsapp=true`; redeliver explícito força a chamada.
- **Concerns abertos**: rate limit UAZAPI (~10/min), desconexão mid-flight, grupo removido (não diferenciado de outros UAZAPI_ERROR), buffer size ~16 MB (fallback URL pública não implementado), possível duplicata se `sendAudio` suceder e `markDelivered` falhar.

---

## 17. Agendamento (Fase 11)

Referência completa: `docs/integrations/scheduling.md`.

```
n8n cron (24/7)  →  POST /api/worker/tick   (Bearer WORKER_TICK_TOKEN, ~30s)
      │
      ▼
┌──────────────────────────────┐  runSchedulesHandler (lib/handlers ou inngest/handlers)
│  handler puro, idempotente   │  reusado: Inngest event-driven OU n8n cron-driven
└──────────────┬───────────────┘
               │ find-due
               ▼
┌──────────────────────────────┐  lib/schedules/service.ts
│  dueSchedulesNow(now, 5)     │  America/Sao_Paulo · fixed_time · window (now-5, now]
└──────────────┬───────────────┘
               │  for each schedule
               ▼
  step.run('dedup-check-<id>')  → summaryExistsForWindow (overlap periods)
               │
               │  not exists
               ▼
  step.run('enqueue-<id>')
               │
               ▼
  inngest.send(summary.requested { tenantId, groupId, periodStart, periodEnd, tone })
               │
               ▼
  Fase 7 → Fase 8 (sempre humano) → Fase 9 → Fase 10
```

- **Regra base**: áudio só vai pro grupo após clique humano em `/approval/[id]`. Migration 0011 adicionou CHECK em `schedules.approval_mode <> 'auto'`; o enum DB ainda lista `auto` mas writes falham.
- **Schema `schedules`**: 1 row/grupo (UNIQUE `group_id`), `tenant_id` escopado, `frequency ∈ {daily, weekly, custom}`, `time_of_day` (sem tz), `day_of_week` 0-6 (Dom-Sáb), `trigger_type ∈ {fixed_time, inactivity, dynamic_window}` (só `fixed_time` disparando), `approval_mode ∈ {optional, required}`, `voice`, `tone`, `is_active`.
- **Janelas de mensagens**: `daily` = últimas 24h; `weekly` = últimos 7 dias.
- **Timezone**: fixo em `America/Sao_Paulo` — conversão via `Intl.DateTimeFormat` (sem lib externa). Multi-tz por tenant é pós-MVP.
- **Modos de aprovação** (ambos caem em `pending_review`; worker nunca emite `autoApprove`):
  - `optional` → placeholder pro futuro auto-approve em 24h. **Não implementado** — hoje se comporta como `required`.
  - `required` → `pending_review` até humano aprovar via `/approval/[id]`.
- **Dedup**: `summaries` com overlap (`period_start <= end AND period_end >= start`) para o mesmo `(tenant_id, group_id)` aborta o emit — cobre cron skew, retry manual, invocação dupla no dashboard.
- **API** (`app/api/schedules/`): `GET /api/schedules`, `POST /api/schedules`, `PATCH /api/schedules/[id]`, `DELETE /api/schedules/[id]`. Erros `SchedulesError` → 404 / 409 / 422 / 500.
- **Limitações MVP**:
  - Em dev, **n8n não está rodando** — invocar `POST /api/worker/tick` manualmente com `Authorization: Bearer $WORKER_TICK_TOKEN`. Em prod, n8n bate a cada 30s automaticamente. (Crons Inngest foram removidos do registro — handlers continuam vivos, só mudou o gatilho.)
  - `trigger_type` só `fixed_time` está ativo (`inactivity`/`dynamic_window` são placeholders do enum — rows com esses valores nunca disparam).
  - `approval_mode='optional'` auto-approve após 24h não implementado — quando vier, será via evento backend, nunca bypass do pipeline.
  - `frequency='custom'` reservado mas ignorado pelo worker.

---

## 18. Design fidelity (source of truth)

Os mockups em `podZAP/*.jsx` são o **source of truth visual** — não inventar layouts novos sem antes comparar com o arquivo correspondente. Mapeamento:

| Rota | Mockup |
|---|---|
| `/` (landing) | — (tela custom light, não reflete protótipo) |
| `/login` | — (tela custom dark, email+senha) |
| `/onboarding` | `podZAP/screen_onboarding.jsx` |
| `/home` | `podZAP/screen_home.jsx` ⚠ parcialmente portado (ver débito Fase 12) |
| `/groups` | `podZAP/screen_groups.jsx` |
| `/approval` | `podZAP/screen_approval.jsx` |
| `/history` | `podZAP/screen_history.jsx` |
| `/schedule` | `podZAP/screen_schedule.jsx` |
| `/podcasts` | `podZAP/screen_podcasts.jsx` |

Tokens CSS vivem em `app/globals.css` (portados de `podZAP/tokens.css`). Tema dark ativo em `(app)/*`, `(admin)/*` e `/login` via `data-theme="dark"`. Landing `/` segue light.

Componentes visuais compartilhados em `components/ui/`: `PodCover`, `PlayerWave`, `Waveform`, `MicMascot`, `Sticker`, etc. Portados direto dos mockups; usar esses antes de montar variantes ad-hoc.

---

## 19. Superadmin (Fase 12)

Referência completa: `docs/integrations/superadmin.md`.

- **Capability cross-tenant** — um bit global (`public.superadmins`), distinto do `tenant_members.role='owner'`. Um superadmin é staff da podZAP, não owner de tenant específico.
- **Migration** `db/migrations/0007_superadmin.sql` cria a tabela + policy `superadmins_read_self` (user lê sua própria row) + helper `public.is_superadmin()` (stable, security definer, `search_path=''`) exposto a `authenticated` e `anon`.
- **Promoção**: `node --env-file=.env.local scripts/set-superadmin.mjs <email> [--password <pw>] [--note "<txt>"] [--yes]`. O user precisa já existir em `auth.users` (fez login ao menos uma vez). Script é idempotente (`on conflict do update`) e exige confirmação interativa "yes" — `--yes` pula o prompt em automation.
- **Uso em RLS**: `is_superadmin()` **já está referenciada em policies SELECT de `tenants`, `tenant_members` e `whatsapp_instances`** (expandido na migration `0008_admin_managed.sql`). Ainda **falta expandir** em `groups`, `messages`, `transcripts`, `summaries`, `audios`, `schedules`, `ai_calls` — superadmin não consegue ler dados aplicacionais cross-tenant via PostgREST hoje (só via SQL editor / service_role). Padrão pra quando expandir: `using (tenant_filter or public.is_superadmin())`. Cuidado LGPD antes de cobrir `messages`/`transcripts`/`summaries` — registrar acessos em audit log primeiro.
- **Writes**: `service_role` only. Cliente browser nunca promove/demove. Admin panel UI **live desde Fase 13** — ver §20.

---

## 20. Modelo admin-managed (Fase 13)

Referência completa: `docs/integrations/admin-management.md`. Audit: `docs/audits/fase-13-audit.md`.

```
┌──────────────┐   cria tenant   ┌──────────────┐   cria user      ┌──────────────┐
│  Superadmin  │────────────────▶│    Tenant    │─────────────────▶│  Usuário(s)  │
│  /admin/*    │                 │ is_active    │  email+senha     │ tenant_memb  │
└──────┬───────┘                 └──────┬───────┘                  └──────┬───────┘
       │ atribui instância              │ 1 instância (UNIQUE)            │ login
       ▼                                ▼                                 ▼
  whatsapp_instances             tenants (plan)                   /login → /home
```

- **Sem signup público**. Trigger `on_auth_user_created` foi dropado em `0008_admin_managed.sql`.
- **Login email+senha** (`supabase.auth.signInWithPassword`). Magic link removido.
- **`/admin/*` gated** em 3 camadas: `proxy.ts` (redirect 307), `app/(admin)/layout.tsx` via `requireSuperadmin()`, rotas `/api/admin/*` checam sessão antes do service-role client.
- **1:1 tenant↔instância**: `UNIQUE(tenant_id)` em `whatsapp_instances`. `attachInstance` valida tenant existe + ativo + sem instância prévia + instância UAZAPI existe + não está attached em outro tenant.
- **Suspend vs delete**: `suspendTenant` flipa `is_active=false` (reversível, sem perda de dados); `deleteTenant` é hard delete com cascade (irreversível).
- **Tabela de rotas admin**: `/admin` (dashboard), `/admin/tenants`, `/admin/tenants/[id]`, `/admin/users`, `/admin/uazapi`. APIs em `/api/admin/{tenants,users,uazapi}/*`.
- **Débitos (Fase 14)**: email notificando senha no createUser; audit log; `/forgot-password`; modal chunky substituindo `window.confirm`; deletar `POST /api/whatsapp/connect` + `startConnectAction` deprecated.
- **Rollback em createUser**: se `tenant_members.insert` falha, o `auth.users.createUser` é revertido via `supabase.auth.admin.deleteUser` — não fica user órfão.
- **Token UAZAPI**: vem do `GET /instance/all` admin, encriptado AES-256-GCM antes do INSERT em `whatsapp_instances` (mesmo padrão do fluxo legacy).

---

## 21. API

Referência completa das 34 rotas HTTP (23 arquivos `route.ts`): [`docs/api/README.md`](docs/api/README.md). Matriz compacta de auth/rate-limit/side-effects/idempotência: [`docs/api/auth-matrix.md`](docs/api/auth-matrix.md).

- **Envelope de sucesso**: objeto nomeado pelo recurso (`{ summary: … }`, `{ audios: [ … ] }`, `{ ok: true }`). Nunca `{ data: … }` genérico.
- **Envelope de erro** (sempre): `{ error: { code, message, details? } }`. Codes canônicos em `app/api/whatsapp/_shared.ts#ErrorCode` (cookie routes) e `app/api/admin/_shared.ts#AdminErrorCode` (admin).
- **Auth**: `requireAuth()` (cookie Supabase) na maioria; `requireSuperadminJson()` em `/api/admin/*`; shared secret (HMAC preferido) em `/api/webhooks/uazapi`; signing key em `/api/inngest`.
- **Rate limit in-memory** (`lib/ratelimit.ts`): chave `tenant:<id>:<routeName>`, fixed-window. Não sobrevive redeploy nem replica cross-container — Upstash fica pós-MVP.
- **Rotas destrutivas cross-tenant**: todas em `/api/admin/*`. Tier 1 (hard delete cascade) está mapeado no `auth-matrix.md`.

---

## 22. UI primitives

UI primitives compartilhados vivem em `components/ui/` (Button, Card, Modal, Select, RadioPill, Sticker, StatCard, PodCover, PlayerWave, Waveform, MicMascot, **SendToMenu** — dropdown via Portal usado em /home, /approval/[id], /podcasts pra delivery). Shell (TopBar, Sidebar, AppSidebar, AdminSidebar, NavButton) em `components/shell/`. Ícones em `components/icons/Icons.tsx`.

Catálogo com props + snippets + tokens: [`docs/ui-components/README.md`](docs/ui-components/README.md). Tokens CSS (`--accent`, `--stroke`, `--shadow-chunk`, fontes, radii): [`docs/ui-components/tokens.md`](docs/ui-components/tokens.md).

**Ao precisar de um novo componente, verifique primeiro se já existe equivalente — não duplique.** O source of truth visual continua sendo `podZAP/*.jsx` (§18); os primitives já portam esses padrões.

---

## 23. Docs map

Top-level: [`docs/README.md`](docs/README.md) tem mapa completo das subpastas. Resumo:

- **Integrations** ([`docs/integrations/`](docs/integrations/README.md)) — subsistemas **externos** (UAZAPI, Gemini, Groq, Supabase Auth, Inngest setup, TTS, delivery, scheduling, approval, admin-management).
- **Internals** ([`docs/internals/`](docs/internals/README.md)) — módulos **próprios** em `lib/` e `inngest/` (`ratelimit`, `crypto`, `supabase/` clients, `media/`, `stats/`, `inngest/events`). Mapa "se você está mexendo em X, leia Y" no README dele.
- **Audits + sessões** ([`docs/audits/`](docs/audits/README.md)) — `fase-N-audit.md` + `session-YYYY-MM-DD.md` cronológicos. Reconstrói "como isso ficou assim".
- **API** ([`docs/api/`](docs/api/README.md)) — catálogo das rotas + matriz auth/rate-limit.
- **UI components** ([`docs/ui-components/`](docs/ui-components/README.md)) — primitives + tokens.
- **Plans** ([`docs/plans/`](docs/plans/README.md)) — PLAN.md por fase (entrada do GSD; raramente lido pós-execução).
- **Deploy** ([`docs/deploy/`](docs/deploy/README.md)) — Hetzner + Portainer + redeploy webhook.
- **Scaffolds** (`docs/scaffolds/`) — snapshot histórico do scaffolding inicial; **não** atualizado conforme app evolui.

Módulos pequenos (`lib/time/relative.ts`, `lib/ai-tracking`) ficam documentados in-line nos comentários e são referenciados a partir do README do diretório.
