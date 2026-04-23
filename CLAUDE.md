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
- [ ] 🟡 **Fase 4: captura de mensagens (webhook) — em andamento**
- [ ] Fase 5+: ver `ROADMAP.md`

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
