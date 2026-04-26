# docs/deploy/ — operação e deploy

Self-hosted via Hetzner + Portainer. **NÃO usamos Vercel.**

## Documentos

- [`hetzner-portainer.md`](hetzner-portainer.md) — setup completo: stack file, env vars, healthcheck, redeploy webhook

## Operacional rápido

- **Prod URL:** https://podzap.wsmart.com.br
- **Portainer:** https://app.wsmart.com.br
- **Stack name:** `podzap` (service: `podzap_podzap`)
- **Image:** `ghcr.io/georgeazevedo2023/podzap:latest` (CI publica em cada merge na `main`)
- **Redeploy webhook (re-pull):** `POST https://app.wsmart.com.br/api/webhooks/85b67741-...` (fluxo: CI verde → webhook → re-pull + restart container, ~30-60s)

## Fluxo CI → deploy

1. Merge na `main` dispara `.github/workflows/release.yml`
2. Build da imagem multi-stage Docker → push pra GHCR
3. Após CI verde, dispara o Service webhook do Portainer
4. Portainer re-pulla a imagem e recria o container
5. Probe `/login` retornando 200 confirma deploy live

## Quando precisa de "Update the stack" manual (não basta o webhook)

- Mudou alguma env var no stack file/Portainer (webhook só re-pulla, não relê env)
- Mudou alguma config de rede/healthcheck/volume

## Env vars obrigatórias

Ver `.env.production.example` na raiz. Críticas que já causaram outage:

- `UAZAPI_WEBHOOK_HMAC_SECRET` — sem ela, webhook 500's tudo (descoberto 2026-04-25)
- `WORKER_TICK_TOKEN` — sem ela, n8n cron `/api/worker/tick` falha 503
- `ENCRYPTION_KEY` — sem ela, instance tokens não decriptam
