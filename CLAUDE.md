# podZAP — orquestrador de sessão

> Auto-carregado pelo Claude Code em cada sessão. **Mantém ≤150 linhas.** Conteúdo denso vive em `docs/` (load on-demand via `@path`); skills procedurais em `.claude/skills/`. Não embed de novo aqui.

## Essência

SaaS multi-tenant: conversas de grupos WhatsApp → resumo IA → áudio podcast formato duo (Ana+Beto). Diferencial: **2 cliques humanos obrigatórios** (1) aprovar texto em `/approval/[id]`, (2) enviar pro grupo via `SendToMenu` em `/podcasts`. **Aprovar ≠ enviar.**

Stack + diagrama + decisões críticas: [`@docs/architecture.md`](docs/architecture.md). Tabelas DB: [`@docs/data-model.md`](docs/data-model.md). Pastas: [`@docs/structure.md`](docs/structure.md). Status: [`ROADMAP.md`](ROADMAP.md) + [`docs/audits/README.md`](docs/audits/README.md).

## Regras hard (alto custo se quebrar)

- **Multi-tenant em toda query** — service role bypassa RLS, handlers filtram `tenant_id` explicitamente
- **PT-BR** em UI, commits, comentários, docs
- **Aprovar ≠ enviar** — nunca reativar `deliver-to-whatsapp` worker sem revisão UX (ver [`@docs/integrations/delivery.md`](docs/integrations/delivery.md))
- **Playwright contra prod** (não dev) — credenciais em `.env.local`
- **Antes de mover/renomear arquivo:** `grep -rn` por refs primeiro (15+ docs cross-link por path)
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`)
- **Design:** não inventar tokens — usar `app/globals.css` (portados de `podZAP/tokens.css`); checar `components/ui/` antes de criar componente

## Env vars críticas (já causaram outage)

- `UAZAPI_WEBHOOK_HMAC_SECRET` — sem ela, webhook 500's tudo
- `WORKER_TICK_TOKEN` — sem ela, n8n cron `/api/worker/tick` 503
- `ENCRYPTION_KEY` — sem ela, instance tokens não decriptam

Antes de assumir bug de código, checar Portainer.

## Comandos bash não-óbvios

```bash
# Inngest dev (porta 3000 do Next, dashboard 8288)
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest

# Aplicar migration (NÃO usar supabase CLI — é via Management API)
node --env-file=.env.local scripts/db-query.mjs db/migrations/NNNN_xxx.sql

# SQL ad-hoc
node --env-file=.env.local scripts/db-query.mjs --sql "select count(*) from messages"

# Regerar tipos depois de migration
node --env-file=.env.local scripts/gen-types.mjs

# Cron tick manual (em dev, n8n não roda)
curl -X POST http://localhost:3000/api/worker/tick \
  -H "Authorization: Bearer $WORKER_TICK_TOKEN"

# Tests
npx vitest run tests/        # unit
npx playwright test e2e/     # e2e (CONTRA PROD)
npx tsc --noEmit             # typecheck
```

## Skills disponíveis (`.claude/skills/`)

- **`podzap-test-webhook`** — simula webhook UAZAPI com HMAC válido + verifica DB
- **`podzap-deploy`** — watch CI → Portainer webhook → probe (após push pra main)
- **`podzap-migration`** — cria migration nova (next number + template + apply + gen-types)
- **`podzap-db`** — wrapper pra `db-query.mjs` (queries SQL com env carregada)

Invocar via `/podzap-<name>` ou descrever a ação que o trigger casa.

## Operacional rápido

| | |
|---|---|
| Prod URL | https://podzap.wsmart.com.br |
| Portainer | https://app.wsmart.com.br · Stack `podzap` |
| Supabase project | `vqrqygyfsrjpzkaxjleo` |
| n8n | https://fluxwebhook.wsmart.com.br |
| Redeploy webhook | `POST https://app.wsmart.com.br/api/webhooks/85b67741-...` |

Detalhe completo + procedimento de redeploy + env vars completas: [`@docs/deploy/README.md`](docs/deploy/README.md).

## Subsistemas (load on-demand)

Lê só o que é relevante pra task atual:

| Mexendo em… | Ler… |
|---|---|
| Webhook ingestion / parser wsmart | [`@docs/integrations/uazapi.md`](docs/integrations/uazapi.md) |
| Worker novo Inngest | [`@docs/integrations/inngest.md`](docs/integrations/inngest.md) (eventos canônicos!) |
| Pipeline filter/cluster/normalize | [`@docs/integrations/pipeline.md`](docs/integrations/pipeline.md) |
| Resumo (Gemini 2.5 Pro + prompt) | [`@docs/integrations/summary-generation.md`](docs/integrations/summary-generation.md) |
| Aprovação humana | [`@docs/integrations/approval.md`](docs/integrations/approval.md) |
| TTS (música de fundo, voice_mode duo) | [`@docs/integrations/tts.md`](docs/integrations/tts.md) |
| Entrega WhatsApp (manual via /podcasts) | [`@docs/integrations/delivery.md`](docs/integrations/delivery.md) |
| Agendamento (cron via n8n) | [`@docs/integrations/scheduling.md`](docs/integrations/scheduling.md) |
| Admin panel | [`@docs/integrations/superadmin.md`](docs/integrations/superadmin.md) + [`@docs/integrations/admin-management.md`](docs/integrations/admin-management.md) |
| Lib internals (crypto, ratelimit, media, …) | [`@docs/internals/README.md`](docs/internals/README.md) |
| API rota nova / debug 4xx | [`@docs/api/README.md`](docs/api/README.md) |
| UI nova (componente, tela) | [`@docs/ui-components/README.md`](docs/ui-components/README.md) + `podZAP/screen_*.jsx` |

## Antes de iniciar trabalho

1. Ler sessão mais recente em [`docs/audits/README.md`](docs/audits/README.md) (estado real do projeto)
2. Se for fase nova: ver [`ROADMAP.md`](ROADMAP.md) + débitos
3. `git log --oneline -10` pra ver últimas mudanças

## Quando atualizar este arquivo

- Nova regra hard (custo alto se quebrar) → adicionar em "Regras hard"
- Comando bash novo não-óbvio → adicionar em "Comandos"
- Subsistema novo → adicionar linha na tabela "Subsistemas"
- **NÃO** copiar conteúdo das `docs/integrations/*` aqui — sempre `@path`
