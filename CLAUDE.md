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
- [ ] **Fase 0: scaffolding Next.js + Supabase** ← próximo passo
- [ ] Fase 1+: ver `ROADMAP.md`

---

## 9. Notas para Claude

- Sempre ler `ROADMAP.md` antes de iniciar uma fase — ele define ordem e dependências
- Ao implementar features, referenciar a seção correspondente do PRD
- Respeitar multi-tenancy em **toda** query de banco
- Usuários falam PT-BR; respostas e UI em português
- Quando tocar em integrações externas (UAZAPI, Gemini, Groq), validar antes com chamada real ou mock explícito
