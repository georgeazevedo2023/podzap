# Deploy — Hetzner + Portainer + GHCR

## Overview

Guia passo a passo para subir o podZAP em produção usando Hetzner + Portainer + Traefik, com imagens publicadas no GHCR (GitHub Container Registry) e redeploy automático via GitHub Actions.

**Estado final:**

- App rodando em `https://podzap.wsmart.com.br` com TLS Let's Encrypt.
- Push em `main` → GitHub Actions builda imagem → GHCR → webhook Portainer → redeploy automático.
- Todos os pipelines (webhook UAZAPI, Inngest, TTS, delivery) operacionais.

Artefatos complementares neste deploy (produzidos em paralelo):

- `.github/workflows/release.yml` — workflow de CI/CD.
- `docker-compose.stack.yml` — stack file do Portainer.
- `.env.production.example` — template de variáveis.

---

## 1. Pré-requisitos

Antes de começar, confirme que existe:

- [ ] Acesso de admin no Portainer do host Hetzner (`https://<ip>:9443`).
- [ ] Traefik rodando no host, anexado à network `wsmart`, com resolver `letsencryptresolver` já configurado e funcionando (confirmado pelo fato de `metrics.wsmart.com.br` rodar ok).
- [ ] DNS configurado: `A podzap.wsmart.com.br → <IP da VPS Hetzner>`. Teste com `dig +short podzap.wsmart.com.br`.
- [ ] Supabase do projeto provisionado (dev e prod podem ser o mesmo projeto no MVP).
- [ ] `UAZAPI_ADMIN_TOKEN` em mãos (tenant admin token no painel UAZAPI).
- [ ] `GEMINI_API_KEY` (Google AI Studio) e `GROQ_API_KEY` (console Groq).
- [ ] `INNGEST_EVENT_KEY` e `INNGEST_SIGNING_KEY` (Inngest Cloud → app → Keys).
- [ ] Repositório GitHub: `github.com/georgeazevedo2023/podzap` — branch `main` como default.
- [ ] CLI local com `openssl` (pra gerar secrets).

Se algum item acima estiver faltando, resolva antes de seguir.

---

## 2. Passo 1 — Setup do GHCR (GitHub Container Registry)

O workflow `.github/workflows/release.yml` publica a imagem em `ghcr.io/georgeazevedo2023/podzap`. Há dois caminhos de autenticação:

### 2.1 Caminho recomendado — `GITHUB_TOKEN` (zero config)

O workflow usa `${{ secrets.GITHUB_TOKEN }}`, que é injetado automaticamente pelo GitHub Actions. Só precisa garantir que o repo tem permissão de escrita em packages:

1. Repositório → **Settings** → **Actions** → **General**.
2. Seção **Workflow permissions** → marcar **Read and write permissions** → **Save**.

Pronto. Nada mais a configurar.

### 2.2 Caminho alternativo — Personal Access Token (PAT)

Use só se quiser pushar imagem localmente (fora do Actions):

1. GitHub → avatar → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
2. Scopes: `write:packages`, `read:packages`, `delete:packages`.
3. Gere, copie o token (começa com `ghp_…`).
4. Login local:

```bash
echo "<PAT>" | docker login ghcr.io -u georgeazevedo2023 --password-stdin
```

Guarde o PAT em um cofre (1Password, Bitwarden). Expira em 90 dias por padrão.

---

## 3. Passo 2 — Primeira release via GitHub Actions

Objetivo: gerar a primeira imagem no GHCR antes de criar a stack no Portainer.

### 3.1 Push para `main`

Com `.github/workflows/release.yml` já no repo:

```bash
git add .
git commit -m "chore(deploy): initial release workflow"
git push origin main
```

### 3.2 Acompanhar o build

1. Navegar até `https://github.com/georgeazevedo2023/podzap/actions`.
2. Abrir o run mais recente do workflow **release**.
3. Esperar todos os jobs ficarem verdes (build costuma levar 4-8 min — Next.js standalone).

Se quebrar, abra os logs da etapa que falhou e corrija. Problemas comuns:

- Falta de permissão em packages (voltar ao passo 2.1).
- `Dockerfile` referenciando arquivo que não está no contexto.
- Lint/typecheck quebrando — resolver local antes de empurrar.

### 3.3 Verificar a imagem no GHCR

1. Perfil `georgeazevedo2023` → **Packages** → `podzap`.
2. Confirmar que existem as tags `latest` e o SHA do commit (ex.: `sha-a1b2c3d`).

### 3.4 Tornar o pacote público (opcional mas simplifica)

Por padrão o pacote é **privado**. Duas opções:

- **Opção A — tornar público:** Package → **Package settings** → rolar até **Danger Zone** → **Change visibility** → **Public**. Pronto: o host Hetzner consegue pullar sem login.
- **Opção B — manter privado:** no host Hetzner, executar login antes do primeiro deploy:

```bash
ssh root@<ip-hetzner>
echo "<PAT ou GITHUB_TOKEN>" | docker login ghcr.io -u georgeazevedo2023 --password-stdin
```

O Portainer então consegue pullar usando as credenciais do Docker local. Para o MVP, recomendo **Opção A** — podZAP é o código do app, não tem secret nele (secrets estão em env vars).

---

## 4. Passo 3 — Criar a stack no Portainer

### 4.1 Acessar Portainer e criar a stack

1. `https://<ip-hetzner>:9443` → login.
2. Environment `local` (ou o nome do seu environment Hetzner).
3. Menu lateral → **Stacks** → **+ Add stack**.
4. **Name:** `podzap` (lowercase, sem hífen — fica `podzap_podzap` quando usado em hostnames internos do Docker).

### 4.2 Build method — Web editor (recomendado)

Colar o conteúdo de `docker-compose.stack.yml` direto no editor. Vantagem: permite ajustes rápidos sem commit.

Alternativa: **Repository** → URL `https://github.com/georgeazevedo2023/podzap` → Reference `refs/heads/main` → Compose path `docker-compose.stack.yml`. Desvantagem: Portainer precisa de acesso ao repo (se privado, configurar credentials no Portainer).

Use **Web editor** se o repo for privado — é mais simples.

### 4.3 Preencher as environment variables

Baixar `.env.production.example` e preencher cada variável. No Portainer, seção **Environment variables** → **Advanced mode** → colar todas as linhas `KEY=value`.

Gerar os secrets locais:

```bash
# ENCRYPTION_KEY (AES-256-GCM — usado pra encriptar UAZAPI tokens)
openssl rand -hex 32

# CRON_SECRET (bearer token pros crons internos)
openssl rand -hex 32

# UAZAPI_WEBHOOK_SECRET (valida webhooks entrantes)
openssl rand -hex 32
```

Valores que devem ir pra esse painel (fonte de cada um em comentários):

- `NEXT_PUBLIC_APP_URL=https://podzap.wsmart.com.br`
- `NEXT_PUBLIC_SUPABASE_URL=` → Supabase → Project settings → API → Project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY=` → mesmo painel, chave `anon`.
- `SUPABASE_SERVICE_ROLE_KEY=` → mesmo painel, chave `service_role`. **Nunca no browser.**
- `UAZAPI_BASE_URL=https://wsmart.uazapi.com`
- `UAZAPI_ADMIN_TOKEN=` → painel UAZAPI.
- `UAZAPI_WEBHOOK_SECRET=` → gerado via `openssl rand -hex 32`.
- `GROQ_API_KEY=` → console.groq.com.
- `GEMINI_API_KEY=` → aistudio.google.com/apikey.
- `INNGEST_EVENT_KEY=` → Inngest Cloud → app podzap → Keys → Event keys.
- `INNGEST_SIGNING_KEY=` → mesma tela → Signing key.
- `ENCRYPTION_KEY=` → `openssl rand -hex 32` (**critical — ver §12 sobre rotação**).
- `CRON_SECRET=` → `openssl rand -hex 32`.
- `PODZAP_HOST=podzap.wsmart.com.br` (lido pelos labels Traefik no compose).
- `NODE_ENV=production`

⚠️ **Não setar `INNGEST_DEV=1`.** Essa flag só existe em dev — se vazar, a app tenta falar com um servidor local e quebra silenciosamente.

### 4.4 Deploy

1. Scroll até o fim → **Deploy the stack**.
2. Status esperado: **running** em ~30-90s (pull da imagem + start do container).
3. Se ficar **error** ou **unhealthy**, **Stack → Logs** → ler o stderr.

Erros comuns na primeira subida:

- Imagem privada sem login → fazer login no host (§3.4 opção B) ou tornar pública.
- Variável faltando (Next.js quebra em build-time se faltar `NEXT_PUBLIC_*`) → revisar env vars e redeploy.
- Network `wsmart` inexistente → ver §1 (pré-requisito Traefik).

### 4.5 Verificar logs de boot

**Services** → `podzap_podzap` → **Logs**. Deve aparecer:

```
▲ Next.js 15.x.x
- Local:        http://localhost:3000
- Network:      http://0.0.0.0:3000
- Environments: .env.production
✓ Ready in ...ms
```

Se aparecer stack trace de Supabase ou UAZAPI, dupla-checar as env vars.

---

## 5. Passo 4 — Sanity check do routing Traefik

Com a stack up, testar do seu laptop:

```bash
curl -v https://podzap.wsmart.com.br
```

Esperado:

- `HTTP/2 200` ou `307` (redirect pra `/login`).
- Header `server: …` (irrelevante) e certificado válido emitido por Let's Encrypt (`issuer: R3` / `Let's Encrypt`).

### Troubleshooting Traefik

- **404 page not found (Traefik default):** o router não encontrou a regra. Checar no `docker-compose.stack.yml` que os labels `traefik.enable=true`, `traefik.http.routers.podzap.rule=Host(\`${PODZAP_HOST}\`)` e `traefik.http.routers.podzap.entrypoints=websecure` estão presentes.
- **Conexão recusada:** a network `wsmart` não está anexada no serviço — confirmar no compose.
- **SSL ERR_CERT_AUTHORITY_INVALID:** Let's Encrypt ainda não emitiu — aguardar até 2min na primeira request. Se persistir, ver logs do Traefik: `docker logs traefik 2>&1 | grep podzap`.
- **502 Bad Gateway:** Traefik encontrou o router mas o container não responde na porta (healthcheck falhando). Ver logs do serviço.

Se `curl` retornar 200 (ou redirect válido), abrir `https://podzap.wsmart.com.br` no browser e conferir que a tela de login/home carrega.

---

## 6. Passo 5 — Service webhook para CD automático

### 6.1 Habilitar webhook no Portainer

1. **Services** (ou **Containers** → **Stacks** dependendo da versão) → `podzap_podzap`.
2. Aba **Service webhook** (ou, em versões antigas do Portainer CE, dentro de **Container** → toggle **Webhook**).
3. **Create service webhook** → toggle **ON**.
4. Copiar a URL gerada — formato `https://<ip-hetzner>:9443/api/stacks/webhooks/<uuid>` ou `https://<ip-hetzner>:9443/api/webhooks/<uuid>`.

### 6.2 Adicionar secret no GitHub

1. Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Name: `PORTAINER_WEBHOOK_URL`.
3. Value: colar URL copiada acima.
4. **Add secret**.

### 6.3 Teste end-to-end

Mudança trivial no repo:

```bash
# qualquer edit visível — ex.: timestamp no README
git commit -am "chore: trigger deploy"
git push origin main
```

Observar em sequência:

1. GitHub Actions: `release.yml` inicia, builda, pusha nova tag `sha-<shortsha>` + atualiza `latest`.
2. Último step do workflow: `curl -X POST $PORTAINER_WEBHOOK_URL` → HTTP 204.
3. Portainer: serviço `podzap_podzap` troca de status pra **updating** por alguns segundos e volta a **running**.
4. `curl https://podzap.wsmart.com.br` continua respondendo 200 (zero-downtime com `update_config` configurado no compose).

Se algum passo falhar, ver logs do Actions + logs do container.

---

## 7. Passo 6 — Promover o primeiro superadmin

O podZAP exige um superadmin pra cadastrar tenants. Sem ele, ninguém consegue entrar em `/admin`.

### Caminho recomendado — Supabase SQL editor

Simples e não exige instalar nada no servidor:

1. Supabase Studio → projeto de produção → **SQL editor** → **+ New query**.
2. Rodar:

```sql
-- 1) descobrir o uuid do usuário que vai virar superadmin
-- (ele precisa já existir em auth.users — faça login ao menos 1x antes)
select id, email from auth.users where email = 'seu-email@exemplo.com';

-- 2) promover
insert into public.superadmins (user_id, note)
values ('<uuid-do-passo-1>', 'founder')
on conflict (user_id) do update set note = excluded.note;
```

3. Deslogar/logar na app → confirmar que link **Admin** aparece no sidebar.

### Caminho alternativo — rodar o script local contra o DB de prod

Funciona, mas exige a `SUPABASE_SERVICE_ROLE_KEY` de prod no `.env.local` (risco de vazar):

```bash
# .env.local temporariamente apontando pra prod
NEXT_PUBLIC_SUPABASE_URL=https://<proj-prod>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-prod>

node --env-file=.env.local scripts/set-superadmin.mjs seu-email@exemplo.com --note "founder"
```

Depois reverter o `.env.local` pra apontar pro Supabase de dev.

**Por que não `docker exec`?** O container produção não tem `.env` em disco (tudo injetado pelo Portainer), e a imagem `standalone` do Next.js não traz `scripts/` por padrão. Caminho SQL é o mais limpo.

---

## 8. Passo 7 — Conectar WhatsApp em produção

Com superadmin criado:

1. `https://podzap.wsmart.com.br/login` → entrar com email/senha do superadmin.
2. Sidebar → **Admin** → **/admin/tenants** → **+ Criar tenant** (ex.: "Meu Tenant de Teste").
3. **+ Criar usuário** vinculado ao tenant (pode usar o mesmo email do superadmin).
4. **/admin/uazapi** → **+ Criar instância** → atribuir ao tenant.
5. A instância entra em status `connecting` → abrir `/onboarding` no mesmo browser → aparece QR code.
6. Abrir WhatsApp no celular → **Dispositivos conectados** → **Conectar dispositivo** → scan.
7. Status troca pra `connected` em 5-10s.
8. Registrar o webhook UAZAPI pra apontar pra produção:

```bash
# ajustar .env.local pra prod (ou criar um .env.production local)
node --env-file=.env.local scripts/register-webhook.mjs https://podzap.wsmart.com.br
```

Se o script não existir no branch, registrar manualmente via admin UAZAPI:

```bash
curl -X POST https://wsmart.uazapi.com/webhook \
  -H "token: <instance-token>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://podzap.wsmart.com.br/api/webhooks/uazapi","events":["messages","connection"],"enabled":true}'
```

---

## 9. Verificação end-to-end (smoke test)

Checklist pós-deploy. Todos têm que passar antes de considerar produção estável.

- [ ] `curl -sI https://podzap.wsmart.com.br | head -1` → `HTTP/2 200` ou `307`.
- [ ] `/login` carrega e aceita email+senha do superadmin.
- [ ] `/admin` renderiza dashboard (count de tenants/users/instâncias).
- [ ] `/onboarding` do tenant de teste mostra QR code ou "conectado".
- [ ] **Inngest Cloud → podzap app → Functions**: aparecem 10 funções registradas (`transcribe-audio`, `describe-image`, `generate-summary`, `generate-tts`, `deliver-to-whatsapp`, `retry-pending-downloads`, `transcription-retry`, `run-schedules`, etc.). Se 0 funções: sync URL (Inngest → app → Sync) → `https://podzap.wsmart.com.br/api/inngest`.
- [ ] **Smoke test de pipeline completo:**
  1. Habilitar um grupo monitorado em `/groups`.
  2. Enviar mensagem de áudio nesse grupo pelo WhatsApp.
  3. Em `/history` do tenant, a mensagem aparece em <10s.
  4. Em 1-2min, transcrição aparece inline.
  5. Em `/approval`, se tiver mensagens suficientes, aparece resumo `pending_review`.

Se o passo 6 não dispara sozinho, forçar: `POST /api/summaries/generate { groupId, tone: 'fun' }` com bearer de cookie de sessão.

---

## 10. Troubleshooting

### Traefik devolve 404

- **Causa típica:** container fora da network `wsmart` ou router com nome conflitante.
- **Fix:**
  ```bash
  docker inspect podzap_podzap-1 | grep NetworkMode
  # deve aparecer "wsmart"
  ```
  Se não, conferir `networks:` do compose e redeploy.

### HTTP 502

- Container saiu ou health check está falhando. `docker ps -a | grep podzap` → se `Exited`, ver logs (`docker logs <id>`).
- Porta wrong: Traefik tenta porta 3000 por default; se o compose expõe outra, ajustar `traefik.http.services.podzap.loadbalancer.server.port`.

### Inngest Cloud não recebe eventos

- `INNGEST_EVENT_KEY` errado (prod vs dev) — comparar com Inngest → Keys.
- `INNGEST_DEV=1` vazando nas env vars → remover e redeploy. Lib detecta e **não** conecta na cloud se essa flag tá setada.
- App não registrada: Inngest → app podzap → **Sync new app** → colar `https://podzap.wsmart.com.br/api/inngest`.

### GHCR pull error (`unauthorized: authentication required`)

- Pacote privado + host sem login:
  ```bash
  ssh root@<ip-hetzner>
  echo "<token>" | docker login ghcr.io -u georgeazevedo2023 --password-stdin
  ```
- Ou tornar público (§3.4 Opção A).

### Supabase retorna `new row violates row-level security`

- Mistura de `anon` key e `service_role` no servidor: rotas `/api/*` que precisam bypassar RLS têm que usar `createAdminClient()` (`SUPABASE_SERVICE_ROLE_KEY`). Se tá usando o cookie client em rota admin, RLS bloqueia.
- Checar: no container, `env | grep SUPABASE` — as duas chaves têm que estar presentes e diferentes.

### Tokens UAZAPI não descriptam (`bad decrypt` em logs)

- **DESASTRE.** `ENCRYPTION_KEY` mudou entre deploys. Todos os tokens em `whatsapp_instances.uazapi_token_encrypted` ficaram inacessíveis.
- Fix possível:
  1. Restaurar a key antiga (se ainda tiver), subir a app, rodar script de re-encrypt com a key nova, deployar com a nova.
  2. Se a key antiga se perdeu: `DELETE FROM whatsapp_instances` e reconectar todas as instâncias do zero (scan QR de novo). Tenants vão ficar offline até reconectarem.
- **Prevenção:** nunca trocar `ENCRYPTION_KEY` sem um plano de migração (ver §12).

### Build no Actions falha com "out of memory"

- Next.js build é pesado. Se `ubuntu-latest` (7GB RAM) não der, reduzir paralelismo: `NEXT_TELEMETRY_DISABLED=1` + `--max-old-space-size=4096` no Dockerfile, ou migrar pro `runs-on: ubuntu-latest-4-cores` (paid).

---

## 11. Rotina de manutenção

### Redeploy manual

Se quiser forçar um redeploy sem push:

1. Portainer → Stacks → `podzap` → **Pull and redeploy** (confirma pull da tag `latest`).
2. Ou via CLI no host:
   ```bash
   docker pull ghcr.io/georgeazevedo2023/podzap:latest
   docker compose -f /data/compose/<stack-id>/docker-compose.yml up -d
   ```

### Rollback de um deploy ruim

1. Descobrir a tag anterior: GitHub → Packages → `podzap` → **Versions** → copiar o SHA da penúltima.
2. No Portainer, editar a stack → trocar `image: ghcr.io/georgeazevedo2023/podzap:latest` por `image: ghcr.io/georgeazevedo2023/podzap:sha-<anterior>`.
3. **Update the stack** → Portainer pulla a tag específica e sobe.
4. Opcional: voltar o `image:` pra `latest` depois de corrigir o bug na `main`.

Boa prática: usar tags SHA (immutable) como padrão no compose em vez de `latest`, e atualizar manualmente quando validar.

### Backup do Supabase

- Supabase cloud faz backup diário automático (retenção 7 dias no Free, 30 no Pro). Dashboard → **Database** → **Backups** → **Restore**.
- Para backup adicional off-Supabase: `pg_dump` via connection string em cron externo:
  ```bash
  pg_dump "$DATABASE_URL" > podzap-$(date +%F).sql
  ```

### Storage backup

- Bucket `audios` cresce rápido. Sem limpeza, ~100MB/mês por tenant ativo.
- Política sugerida: objeto `audios/<tenant>/<year>/*` → lifecycle rule no Supabase Storage (pós-MVP) pra deletar após 90 dias.

### Rotação de secrets

**Regra geral:** Portainer → stack → Environment variables → editar → **Update the stack**. O container reinicia com os novos valores.

Secrets com zero dano ao trocar:

- `GEMINI_API_KEY`, `GROQ_API_KEY`, `CRON_SECRET`, `UAZAPI_WEBHOOK_SECRET`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. Trocar na fonte (console provider), atualizar Portainer, redeploy.

Secret com CUIDADO — `ENCRYPTION_KEY`:

- Essa key descripta `whatsapp_instances.uazapi_token_encrypted`. **Se trocar sem migrar, todas as instâncias quebram.**
- Processo correto:
  1. Manter a key antiga numa env var auxiliar `ENCRYPTION_KEY_OLD`.
  2. Rodar script `scripts/rotate-encryption-key.mjs` (TODO — não existe ainda) que lê todos os tokens com `OLD`, re-encripta com a nova key, salva.
  3. Só então trocar `ENCRYPTION_KEY` e remover `OLD`.
- Para MVP com 1-2 tenants, mais simples: deletar `whatsapp_instances`, redeploy com key nova, reconectar todo mundo via QR.

### Monitoramento básico

- **Logs:** Portainer → Service → Logs (ou `docker logs -f podzap_podzap-1`). Rotação já configurada (10MB × 3).
- **Inngest:** dashboard mostra falhas em cada função com stack trace. Configurar alerta (Inngest → Notifications → Slack/email) em falhas >5/h.
- **UAZAPI:** monitorar `whatsapp_instances.status` — se algum tenant fica `disconnected` por >30min, alertar.
- **Supabase:** dashboard → **Database** → **Performance** mostra slow queries e uso de connection pool.

### Atualização do Next.js / deps

1. Local: `npm outdated` → `npm update <pkg>` → `npm run build` → `npm test`.
2. Commit → PR → review → merge.
3. GitHub Actions roda, publica nova imagem, webhook dispara redeploy. Nenhum passo manual.

---

## 12. Referências cruzadas

- `.github/workflows/release.yml` — CI/CD completo.
- `docker-compose.stack.yml` — stack file.
- `.env.production.example` — lista canônica de env vars.
- `docs/integrations/uazapi.md` — detalhes de webhook, QR, encriptação de token.
- `docs/integrations/inngest.md` — setup Inngest Cloud + troubleshooting.
- `docs/integrations/admin-management.md` — modelo admin-managed (superadmin, tenants, users).
- `docs/integrations/superadmin.md` — promoção de superadmin.
- `scripts/set-superadmin.mjs` — promote via CLI.
- `scripts/register-webhook.mjs` — registrar webhook UAZAPI.

---

## 13. Custo mensal estimado

| Item                     | Custo                                        |
| ------------------------ | -------------------------------------------- |
| Hetzner CX22             | ~€5/mês                                      |
| Supabase Pro (quando sair do Free) | $25/mês                              |
| Inngest Cloud            | free tier (100k steps/mês)                   |
| UAZAPI                   | conforme plano do usuário                    |
| Gemini + Groq            | pay-as-you-go, ~$0.01-0.05 por resumo        |
| Domain + TLS             | ~$10/ano + free (Let's Encrypt)              |

**Fixo de infra** pros primeiros N tenants: ~€35/mês + uso de AI.

---

## 14. Segurança

- **Nunca commitar** `.env.local`, `.env.production`, ou qualquer variante (`.gitignore` já cobre).
- `SUPABASE_SERVICE_ROLE_KEY` e `ENCRYPTION_KEY` só vivem no painel de env vars do Portainer — nunca no código, nunca no client bundle.
- Traefik: Let's Encrypt + HSTS headers (herdados da config padrão `metrics.wsmart.com.br`).
- SSH na VM Hetzner: fail2ban + SSH key only + porta 22 movida ou atrás de firewall.
- Portainer UI (porta 9443): idealmente atrás de VPN ou IP allowlist (Hetzner Cloud Firewall).
- Rotação de secrets a cada 90 dias (exceto `ENCRYPTION_KEY` — ver §11).
