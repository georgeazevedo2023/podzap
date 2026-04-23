# Deploy — Hetzner + Portainer

podZAP é self-hosted. **Não usamos Vercel.**

## Stack

- **Hetzner Cloud** VM Ubuntu 24.04 (CX22: 2 vCPU / 4GB RAM / 40GB — suficiente pra MVP)
- **Docker** + **Portainer** (CE ou Business) na VM
- **Traefik** (recomendado) na frente pra TLS Let's Encrypt automático
- **Supabase** gerenciado (https://supabase.com) — database, auth, storage
- **Inngest Cloud** — workers (alternativa: Inngest self-hosted num container da stack)
- **UAZAPI** (`wsmart.uazapi.com`) — WhatsApp gateway

## Setup inicial da VM

```bash
# Instalar Docker + Portainer (fazer 1x no host)
curl -fsSL https://get.docker.com | sh
docker volume create portainer_data
docker run -d -p 8000:8000 -p 9443:9443 --name portainer --restart=always \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:latest

# Traefik (opcional mas recomendado pra TLS)
docker network create traefik
# Stack Traefik separada no Portainer com Let's Encrypt resolver
```

Depois: acessar `https://<ip-hetzner>:9443`, criar admin, adicionar o environment local.

## Deploy da stack podZAP

### Opção A — Build local / CI, push pro registry

```bash
# build multi-stage
docker build -t ghcr.io/georgeazevedo2023/podzap:latest .

# login no registry
echo $GITHUB_TOKEN | docker login ghcr.io -u georgeazevedo2023 --password-stdin

# push
docker push ghcr.io/georgeazevedo2023/podzap:latest
```

No Portainer:
1. **Stacks** → **Add stack** → nome `podzap`
2. **Build method**: Repository (aponta pro repo GitHub) ou Web editor (cola o `docker-compose.yml`)
3. **Environment variables** (colar todas do `.env.local`, menos `NODE_ENV=production`):
   - `NEXT_PUBLIC_APP_URL=https://podzap.app`
   - `NEXT_PUBLIC_SUPABASE_URL=https://vqrqygyfsrjpzkaxjleo.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...`
   - `SUPABASE_SERVICE_ROLE_KEY=eyJ...`  ⚠️ secreta
   - `UAZAPI_BASE_URL=https://wsmart.uazapi.com`
   - `UAZAPI_ADMIN_TOKEN=...`
   - `UAZAPI_WEBHOOK_SECRET=...`
   - `GROQ_API_KEY=gsk_...`
   - `GEMINI_API_KEY=AIza...`
   - `INNGEST_EVENT_KEY=...` (em branco em dev)
   - `INNGEST_SIGNING_KEY=...` (em branco em dev)
   - `ENCRYPTION_KEY=...` (32 bytes base64)
   - `CRON_SECRET=...`
   - `PODZAP_HOST=podzap.app` (usado pelos labels Traefik)
4. **Deploy the stack**

Portainer faz pull da imagem + sobe o container + labels do Traefik entram em efeito.

### Opção B — Build no host (rápido pra iterar)

O `docker-compose.yml` no repo tem `build: { context: ., dockerfile: Dockerfile }` como padrão. Portainer faz `docker compose build` antes de subir. Mais lento (build na VM), mas zero CI.

## Pós-deploy

1. **DNS**: A record `podzap.app` → IP da VM Hetzner
2. **Supabase Auth redirect URLs**: rodar `scripts/configure-auth.mjs` com URL de prod (ou manual no dashboard)
3. **Registrar webhook UAZAPI**:
   ```bash
   node --env-file=.env.local scripts/register-webhook.mjs https://podzap.app
   ```
4. **Inngest Cloud**: criar app, apontar `https://podzap.app/api/inngest`, confirmar 10 funções no dashboard
5. **Health**: `curl https://podzap.app/health` → JSON com todos os env vars verdes
6. **Login de teste**: magic link no email + `/home`

## Atualizações

```bash
# local ou CI: build + push
docker build -t ghcr.io/georgeazevedo2023/podzap:latest .
docker push ghcr.io/georgeazevedo2023/podzap:latest
```

No Portainer → Stack `podzap` → **Pull and redeploy**. Zero downtime se tiver replicas > 1 + redis compartilhado.

## Scaling horizontal

Antes de escalar:
1. Criar container Redis na mesma stack (descomentar bloco no compose)
2. Migrar `lib/ratelimit.ts` pra usar Redis (TODO documentado)
3. Aumentar `deploy: replicas: N` no compose

## Observabilidade

- **Logs**: `docker logs podzap-app` ou Portainer UI → Container → Logs. Já vem com rotação (10MB × 3).
- **Health**: `/health` responde JSON com estado das envs + Supabase.
- **Erros server-side**: recomendado adicionar Sentry (ver `sentry.server.config.ts` em pós-MVP).

## Rollback

Portainer guarda versões da stack. **Stack → Editor → histórico** ou manualmente:

```bash
docker compose pull                                 # pula
docker tag ghcr.io/georgeazevedo2023/podzap:prev \
           ghcr.io/georgeazevedo2023/podzap:latest  # retag local
docker compose up -d                                # recria container
```

Melhor: versionar tags (`podzap:v1.0.0`) em vez de `latest`.

## Segurança

- Nunca commitar `.env.local` (`.gitignore` já cobre)
- `SUPABASE_SERVICE_ROLE_KEY` e `ENCRYPTION_KEY` só nas env vars do Portainer — nunca no código
- Traefik: Let's Encrypt + HSTS headers
- Limite SSH na VM Hetzner (fail2ban, SSH key only)
- Firewall: portas 80/443 abertas, 9443 (Portainer) idealmente via VPN ou IP allowlist

## Custo mensal estimado

| Item | Custo |
|---|---|
| Hetzner CX22 | ~€5/mês |
| Supabase Pro | $25/mês (quando sair do free) |
| Inngest Cloud | free tier (100k steps/mês) |
| UAZAPI | conforme plano do usuário |
| Gemini + Groq | pay-as-you-go, ~$0.01-0.05 por resumo |
| Domain + TLS | ~$10/ano + free (Let's Encrypt) |

**Total fixo de infra** para os primeiros N tenants: ~€35/mês + uso AI.
