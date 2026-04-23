# podZAP — Contexto para Claude

> Este arquivo é lido automaticamente pelo Claude Code no início de cada sessão.
> Mantenha-o atualizado conforme o projeto evolui.

---

## 1. O que é o podZAP

SaaS **multi-tenant** que transforma conversas de grupos do WhatsApp em **resumos em áudio estilo podcast**.

Fluxo essencial:
`mensagens zap → transcrição (áudio+imagem) → resumo IA → aprovação humana → TTS → entrega`

**Diferencial:** aprovação humana obrigatória/opcional antes do áudio ser gerado e enviado.

PRD completo: `docs/PRD.md`

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
| Deploy | Vercel (app) + Supabase (db) | Padrão Next.js |

---

## 3. Arquitetura

```
┌─────────────────┐      webhook      ┌──────────────┐
│    UAZAPI       │──────────────────▶│  /api/       │
│  (WhatsApp)     │                   │  webhooks/   │
└─────────────────┘                   │   uazapi     │
        ▲                             └──────┬───────┘
        │ envio áudio+texto                  │ enqueue
        │                                    ▼
┌───────┴────────┐                   ┌──────────────┐
│  Next.js App   │◀──────────────────│   Inngest    │
│   (Vercel)     │                   │   Workers    │
└───────┬────────┘                   └──────┬───────┘
        │                                   │
        │          RLS multi-tenant         │
        ▼                                   ▼
┌────────────────────────────────────────────────────┐
│                    Supabase                        │
│  Auth · Postgres · Storage (áudios)                │
└────────────────────────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
      ┌──────┐   ┌──────┐   ┌──────────┐
      │ Groq │   │Gemini│   │  Gemini  │
      │ STT  │   │Vision│   │   TTS    │
      └──────┘   └──────┘   └──────────┘
```

---

## 4. Estrutura de pastas (proposta)

```
podzap/
├── CLAUDE.md                    ← este arquivo
├── ROADMAP.md                   ← fases do projeto
├── README.md
├── .env.example                 ← template de variáveis
├── .env.local                   ← variáveis reais (NÃO commitar)
├── docs/
│   ├── PRD.md                   ← PRD original
│   ├── architecture.md
│   └── integrations/
│       ├── uazapi.md
│       ├── supabase.md
│       └── gemini.md
├── podZAP/                      ← MOCKUPS ORIGINAIS (design source of truth)
│   ├── tokens.css               ← tokens já prontos, migrar pra Tailwind config
│   ├── shell.jsx
│   ├── screen_*.jsx
│   └── components.jsx
├── app/                         ← Next.js App Router
│   ├── (auth)/
│   ├── (dashboard)/
│   │   ├── home/
│   │   ├── groups/
│   │   ├── approval/
│   │   ├── history/
│   │   └── schedule/
│   ├── api/
│   │   ├── webhooks/uazapi/
│   │   ├── inngest/
│   │   └── trpc/ (opcional)
│   └── layout.tsx
├── lib/
│   ├── supabase/                ← clients (server, browser, admin)
│   ├── uazapi/                  ← cliente UAZAPI
│   ├── ai/
│   │   ├── groq.ts              ← transcrição
│   │   ├── gemini-vision.ts     ← imagens
│   │   ├── gemini-llm.ts        ← resumo
│   │   └── gemini-tts.ts        ← áudio
│   └── pipeline/                ← lógica de processamento
├── components/                  ← React components (migrados dos mockups)
├── db/
│   ├── migrations/              ← SQL do Supabase
│   └── seed.sql
├── inngest/                     ← workers
│   └── functions/
└── public/
```

---

## 5. Modelo de dados (resumo)

Ver PRD §14 para detalhes. Tabelas principais:

- `tenants` — isolamento multi-tenant
- `users` — vinculados a 1+ tenant
- `whatsapp_instances` — conexão UAZAPI por tenant
- `groups` — grupos monitorados
- `messages` — mensagens capturadas (texto/áudio/imagem)
- `transcripts` — transcrição de áudio/imagem → texto
- `summaries` — resumo gerado (status: pending_review / approved / rejected)
- `audios` — URL do podcast final
- `schedules` — configuração de agendamento por grupo

**Toda query DEVE respeitar `tenant_id` via RLS.**

---

## 6. Convenções

- **Idioma:** português nos textos de UI, comentários em PT-BR ou EN (escolher um e manter)
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `refactor:`)
- **Branches:** `main` protegida, features em `feat/<nome>`
- **Testes:** obrigatórios para pipelines (transcrição, filtro, resumo) — usar Vitest
- **Secrets:** nunca commitar. `.env.local` no `.gitignore`
- **UAZAPI:** usar a skill `uazapi` do Claude quando for integrar
- **Design:** não inventar novos tokens — usar os de `podZAP/tokens.css`

---

## 7. Como rodar (após setup)

```bash
# instalar
npm install

# rodar dev
npm run dev

# migrations supabase
npx supabase db push

# workers inngest (dev)
npx inngest-cli dev
```

---

## 8. Status atual

- [x] PRD definido
- [x] Layout/design system (mockups em `podZAP/`)
- [x] Fase 0: scaffolding Next.js + Supabase
- [x] Fase 1: Auth + multi-tenancy (RLS, signup auto-cria tenant)
- [x] Fase 2: conexão WhatsApp (UAZAPI)
- [x] Fase 3: listagem e seleção de grupos
- [x] Fase 4: captura de mensagens (webhook) ✅
- [x] Fase 5: transcrição multimodal (Groq + Gemini Vision via Inngest) ✅
- [x] Fase 6: filtro de relevância + agrupamento por tópicos ✅
- [x] Fase 7: geração do resumo (Gemini 2.5 Pro) ✅
- [x] Fase 8: aprovação humana (review + edit + approve/reject/regenerate) ✅
- [x] Fase 9: TTS (Gemini 2.5 Flash TTS → WAV no bucket `audios`) ✅
- [ ] 🟡 **Fase 10: entrega via UAZAPI (worker `deliver-to-whatsapp` on `audio.created` + redeliver manual) — em andamento**
- [ ] Fase 11+: ver `ROADMAP.md`

---

## 9. Notas para Claude

- Sempre ler `ROADMAP.md` antes de iniciar uma fase — ele define ordem e dependências
- Ao implementar features, referenciar a seção correspondente do PRD
- Respeitar multi-tenancy em **toda** query de banco
- Usuários falam PT-BR; respostas e UI em português
- Quando tocar em integrações externas (UAZAPI, Gemini, Groq), validar antes com chamada real ou mock explícito

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
- **Webhooks**: `POST /webhook` body `{ url, events: ['messages', 'connection'], enabled: true }` com token de instância. Evento `event` na payload de entrada fan-out por tipo.
- **Delete**: `DELETE /instance` com **token de instância** (não admin — retorna 401).
- **QR quirk**: servidor devolve `data:image/png;base64,…` com prefixo; o client em `lib/uazapi/client.ts` tira o prefixo e o caller adiciona de volta uma única vez.
- **Rate limit**: `UazapiClient` tem token bucket interno; API routes têm rate limit in-memory 30/min/tenant. Em produção, considerar Upstash para limitar cross-instance.
- **Sidebar indicator**: `app/(app)/layout.tsx` faz `SELECT status, phone FROM whatsapp_instances WHERE tenant_id=… LIMIT 1` via admin client e passa pro `AppSidebar` → `Sidebar` (prop `whatsappStatus` + `whatsappPhone`). Falhas degradam silenciosamente para `'none'`.

---

## 11. Pipeline de transcrição (Fase 5+)

Referência completa: `docs/integrations/inngest.md` (setup dev/prod, events, troubleshooting).

Fluxo de alto nível — tudo assíncrono, desacoplado do webhook:

```
UAZAPI webhook
      │
      ▼
/api/webhooks/uazapi  →  lib/webhooks/persist.ts
      │                        │
      │                        └─ insert messages row + emit `message.captured`
      ▼
Inngest  (app/api/inngest/route.ts + inngest/functions/*)
      ├─ transcribe-audio      (trigger: message.captured com type=audio) → Groq Whisper  → transcripts
      ├─ describe-image        (trigger: message.captured com type=image) → Gemini Vision → transcripts
      ├─ retry-pending-downloads    (cron */5m)   safety net p/ media_download_status='pending'
      └─ transcription-retry        (cron */15m)  safety net p/ áudio/imagem sem transcripts
```

- **Events canônicos** (`inngest/events.ts`): `message.captured`, `message.transcription.requested`, `media.download.retry`. Case-sensitive — erro comum é usar underscore.
- **Em dev**: `INNGEST_DEV=1` em `.env.local` + `npx inngest-cli@latest dev -u http://localhost:3001/api/inngest` em paralelo ao `npm run dev`. Dashboard em `http://127.0.0.1:8288`.
- **Em prod**: `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` no Vercel; crons rodam pela Inngest Cloud.
- **Retry**: default Inngest (3x backoff exponencial); falhas determinísticas (Gemini safety block) marcam e não re-agendam.
- **UI**: `/history` mostra transcrição inline sob cada mensagem áudio/imagem; quando ainda não existe, aparece badge pulsante "transcrevendo…" / "analisando imagem…".

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
- **Speed**: não-determinístico — apenas dica no prompt (Gemini TTS não tem knob real).
- **Chunking**: não implementado. Resumos > ~5000 chars podem falhar (gap documentado).
- **Erros**: `AudiosError` com `code ∈ { NOT_FOUND, ALREADY_EXISTS, TTS_ERROR, DB_ERROR }`. `ALREADY_EXISTS` em retry é sinal de sucesso idempotente.

---

## 16. Entrega (Fase 10)

Referência completa: `docs/integrations/delivery.md`.

```
audios row criada (Fase 9)
          │  emit audio.created
          ▼
┌──────────────────────────────┐  inngest/functions/deliver-to-whatsapp.ts
│  deliver-to-whatsapp worker  │  retries: 3
└──────────────┬───────────────┘
               │ step.run('deliver')
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

  Retry manual: POST /api/audios/[id]/redeliver  (6/h/tenant)
```

- **Destino atual**: grupo de origem do resumo (`summaries.group_id → groups.uazapi_group_jid`). DM do owner / lista custom ficam pós-MVP.
- **Caption**: hoje hardcoded `true` no worker (usa `summaries.text`); `false` no redeliver. Flag por tenant (`tenants.include_caption_on_delivery` no plano) ainda não implementada.
- **Erros**: `DeliveryError` com `code ∈ { NOT_FOUND, NO_INSTANCE, INSTANCE_NOT_CONNECTED, UAZAPI_ERROR, DB_ERROR }` — mapeado para 404 / 409 / 409 / 502 / 500 na rota `redeliver`.
- **Idempotência**: `deliverAudio` short-circuita se `delivered_to_whatsapp=true`; `redeliver` força a chamada.
- **Retry**: Inngest 3x (backoff exponencial) para transientes + botão "Reenviar" manual com rate limit 6/h/tenant.
- **Concerns abertos**: rate limit UAZAPI (~10/min), desconexão mid-flight, grupo removido (não diferenciado de outros UAZAPI_ERROR), buffer size ~16 MB (fallback URL pública não implementado), possível duplicata se `sendAudio` suceder e `markDelivered` falhar.
