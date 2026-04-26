# Estrutura de pastas — podZAP

```
podzap/
├── CLAUDE.md                    ← orquestrador (≤150 lin); regras + ponteiros
├── ROADMAP.md                   ← fases + status de cada uma
├── proxy.ts                     ← Next.js middleware (auth + admin gate)
├── docker-compose.stack.yml     ← stack Portainer (prod)
├── Dockerfile                   ← multi-stage build
├── .env.local · .env.example · .env.production.example
│
├── docs/                        ← documentação viva — ver docs/README.md
│   ├── architecture.md          ← stack + diagrama + decisões críticas
│   ├── structure.md             ← este arquivo
│   ├── data-model.md            ← tabelas DB + relações
│   ├── MVP-COMPLETION.md        ← relatório consolidado MVP 1.0
│   ├── api/                     ← catálogo das 35 rotas + matriz auth
│   ├── audits/                  ← fase-N-audit.md + session-YYYY-MM-DD.md
│   ├── deploy/                  ← Hetzner + Portainer
│   ├── integrations/            ← UAZAPI, Gemini, Groq, Inngest, …
│   ├── internals/               ← lib/* (encryption, rate-limit, media, …)
│   ├── plans/                   ← PLAN.md por fase
│   ├── scaffolds/               ← snapshot histórico (não atualizar)
│   └── ui-components/           ← primitives + tokens
│
├── podZAP/                      ← MOCKUPS (source of truth visual)
│   └── screen_*.jsx · tokens.css · shell.jsx · components.jsx
│
├── app/
│   ├── (app)/                   ← rotas autenticadas (tenant) — dark theme
│   │   └── home/ groups/ approval/ history/ podcasts/ schedule/ onboarding/
│   ├── (admin)/admin/           ← rotas superadmin — dark theme
│   │   └── tenants/ users/ uazapi/
│   ├── login/ logout/ auth/     ← rotas públicas (login dark, landing light)
│   ├── api/                     ← 35 rotas (ver docs/api/README.md)
│   │   ├── webhooks/uazapi/     ← entrada do webhook (HMAC validation)
│   │   ├── worker/tick/         ← cron tick chamado pelo n8n
│   │   ├── inngest/             ← endpoint pra Inngest Cloud
│   │   ├── admin/               ← rotas superadmin (gated 3 camadas)
│   │   ├── summaries/ audios/ schedules/ groups/
│   │   ├── whatsapp/ me/
│   │   └── _shared.ts (cookie + admin error helpers)
│   └── layout.tsx · globals.css · page.tsx (landing)
│
├── lib/
│   ├── supabase/                ← server / browser / admin clients
│   ├── uazapi/                  ← client (download/sendAudio/groups) + types (zod)
│   ├── ai/                      ← groq · gemini-{llm,vision,tts} · openai (fallback)
│   ├── webhooks/                ← validator (HMAC) · handler · persist
│   ├── pipeline/                ← filter · cluster · normalize (rule-based)
│   ├── summary/                 ← prompt versioning + generator
│   ├── audios/                  ← service + mix.ts (música de fundo via ffmpeg)
│   ├── delivery/                ← service (sendAudio + markDelivered)
│   ├── schedules/               ← service + dueSchedulesNow
│   ├── transcripts/ stats/ admin/ groups/ whatsapp/
│   ├── media/                   ← download (com .enc decryption) · signed URLs
│   ├── time/                    ← relative + tz helpers
│   └── crypto.ts · ratelimit.ts · tenant.ts · ai-tracking.ts
│
├── inngest/
│   ├── client.ts · events.ts    ← eventos canônicos (case-sensitive!)
│   ├── functions/               ← 9 workers registrados (transcribe-audio, generate-summary, etc.)
│   └── handlers/                ← handlers puros reusados pelo n8n /worker/tick
│
├── components/
│   ├── ui/                      ← primitives: Button, Modal, Select, SendToMenu, PodCover, PlayerWave, …
│   ├── shell/                   ← TopBar, Sidebar, AppSidebar, AdminSidebar
│   └── icons/Icons.tsx
│
├── db/migrations/               ← 15 migrations SQL (0001..0015) aplicadas via scripts/db-query.mjs
│
├── scripts/                     ← db-query.mjs · gen-types.mjs · set-superadmin.mjs (com confirm)
│                                  · register-webhook.mjs · backfill-captions.mjs · ...
├── tests/                       ← 356 testes Vitest (lib/* + pipeline + workers)
├── e2e/                         ← Playwright (executados contra prod, ver memória)
├── .claude/skills/              ← skills locais do projeto (test-webhook, deploy, migration, db)
└── public/
```

## Convenções de localização

- **Service layer** (`lib/<domain>/service.ts`): toda DB write/read tenant-scoped passa aqui. Workers Inngest e API routes consomem.
- **Workers**: handler puro em `inngest/handlers/<name>.ts` + wrapper Inngest em `inngest/functions/<name>.ts`. Handler é testável + reusável (n8n cron tick).
- **Migrations**: `db/migrations/NNNN_descrição.sql`, sequencial, idempotente onde possível. Aplicação via `node --env-file=.env.local scripts/db-query.mjs db/migrations/NNNN_xxx.sql`.
- **Tests**: `tests/<feature>.spec.ts` pra lib/, `e2e/<flow>.spec.ts` pra Playwright. Mocks devem espelhar o shape PostgREST mas não emular tudo.
