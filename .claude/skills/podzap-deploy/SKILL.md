---
name: podzap-deploy
description: Após push na main, watch CI → POST no Portainer Service webhook → aguarda re-pull → probe da prod. Triggers - "deploy", "atualizar prod", "redeploy", "subir pra prod", "publicar".
---

# podzap-deploy

Pipeline completo de deploy pós-push: CI verde → Portainer webhook → wait → probe.

## Quando usar

- Após `git push origin main` quando o user pediu pra publicar
- Após adicionar/mudar env var no Portainer (precisa "Update the stack" manual; webhook só re-pulla imagem, não relê env — ver "Quando NÃO basta")
- Recovery após outage

## Procedimento

### 1. Garantir push feito

```bash
git log origin/main..HEAD --oneline
# Se tiver output, push primeiro:
git push origin main
```

### 2. Watch CI até passar

```bash
# Pega o run id do commit recém-empurrado
gh run list --branch main --limit 1 --json databaseId,headSha -q '.[0].databaseId'

# Watch (timeout ~5min)
gh run watch <run-id> --exit-status
gh run view <run-id> --json conclusion -q '.conclusion'
# Esperado: "success"
```

Se CI falhar — **NÃO** disparar webhook. Investigar: `gh run view <run-id> --log-failed`.

### 3. Disparar Portainer webhook

```bash
curl -sS -o /dev/null -w "HTTP %{http_code} (%{time_total}s)\n" \
  -X POST https://app.wsmart.com.br/api/webhooks/85b67741-3a79-4707-9c1a-696e52aec652
```

Esperado: **HTTP 204** (sem body — Portainer aceitou e vai re-pull + recreate).

### 4. Aguardar + probe

Container leva ~30-90s pra terminar re-pull + restart. Use `ScheduleWakeup` com `delaySeconds: 75` e prompt `"probar prod"` em vez de poll com sleep. Quando acordar:

```bash
curl -sS -o /dev/null -w "/login HTTP %{http_code} %{time_total}s\n" \
  https://podzap.wsmart.com.br/login
# Esperado: HTTP 200

curl -sS -o /dev/null -w "/api/webhooks/uazapi HTTP %{http_code}\n" \
  https://podzap.wsmart.com.br/api/webhooks/uazapi
# Esperado: HTTP 200 (GET = healthcheck)
```

Se ambos 200 = deploy live ✅. Se 504 ou timeout = container ainda subindo, dá mais 30s.

## Quando NÃO basta o webhook (precisa "Update the stack" manual)

- **Mudou env var** no Portainer Stack file/UI: webhook re-pulla a imagem mas o container **NÃO** relê env. Tem que clicar "Update the stack" ou fazer "Recreate" no service.
- **Mudou config de rede/healthcheck/volume** no compose

Sintoma típico: variáveis novas não tomam efeito após webhook → user vê 500 SERVER_MISCONFIG ou similar.

## Reportar

Após probe OK:
- Lista de commits deployed (`git log origin/main~N..origin/main --oneline`)
- Resumo das mudanças (1 frase por commit)
- Confirmação dos endpoints respondendo

## Riscos

- **Não disparar com env vars novas sem confirmação explícita** — o redeploy pode pegar imagem nova mas com env stale, e a app pode subir quebrada
- **Não re-disparar enquanto o probe está pending** — Portainer pode entrar em recreate loop
- **Em caso de rollback necessário:** ver "Rollback de deploy" em `docs/deploy/README.md` (não fazer hard reset sem confirmação)
