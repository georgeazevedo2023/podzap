# Fase 2 — Conexão WhatsApp (UAZAPI)

**Objetivo:** usuário autenticado consegue criar uma instância UAZAPI, escanear QR code com WhatsApp real, e ver status "conectado" no dashboard.

**Dependência:** Fase 1 (auth + tenant) aplicada e funcionando. Verificado no audit.

## ⚠️ Bloqueador externo

Esta fase exige um **WhatsApp real** para escanear o QR. O usuário precisa:
- Ter um celular com WhatsApp
- Scan manual quando chegar o momento
- Aceitar que o número usado vai aparecer como "sessão ativa" no aparelho

Se o usuário não tiver um número disponível agora, posso implementar toda a infra e parar antes do scan — ele escaneia quando puder.

## Componentes

### Rotas a criar
| Rota | Tipo | Propósito |
|---|---|---|
| `/(app)/onboarding` | Server component | Tela "conecte seu WhatsApp" com QR + polling |
| `POST /api/whatsapp/connect` | Route handler | Cria instância UAZAPI + salva em `whatsapp_instances` |
| `GET /api/whatsapp/qrcode` | Route handler | Retorna QR code atual (polling) |
| `GET /api/whatsapp/status` | Route handler | Retorna status (disconnected/qrcode/connected) |
| `POST /api/whatsapp/disconnect` | Route handler | Disconnecta instância |

### Código
- Atualizar `lib/uazapi/client.ts` — descobrir os endpoints reais de `createInstance`/`deleteInstance` via teste live (agente vai chamar a API)
- Encriptar `uazapi_token_encrypted` antes de salvar no banco (usar `ENCRYPTION_KEY` do env) — `lib/crypto.ts` (novo)
- `lib/whatsapp/service.ts` — camada de negócio: `ensureInstance`, `pollUntilConnected`, `syncStatus`

### Testes
- Mock UAZAPI client em tests — verificar flow create → QR → connected
- Polling é rate-limited (max 1 req/2s) — test com timers

## Tarefas para os 5 agentes

### Agente 1 — UAZAPI client: descobrir endpoints reais + encryption
- Testar live `POST /instance/init` no `https://wsmart.uazapi.com` (com admin token)
- Descobrir paths reais de create/delete + atualizar `lib/uazapi/client.ts` removendo "OPEN QUESTION"
- Criar `lib/crypto.ts` com `encrypt(plaintext)` e `decrypt(ciphertext)` usando AES-256-GCM + `ENCRYPTION_KEY` do env
- Test unitário de round-trip de crypto

### Agente 2 — Rotas API `/api/whatsapp/*`
- `POST /api/whatsapp/connect` — cria instância UAZAPI via `UazapiClient.createInstance`, encripta o token, insere em `whatsapp_instances` com `status='connecting'`, retorna `{ instanceId, qrCodeBase64 }`
- `GET /api/whatsapp/qrcode?instanceId=...` — lê token decriptado, chama `UazapiClient.getQrCode`, retorna QR
- `GET /api/whatsapp/status?instanceId=...` — lê status da UAZAPI + atualiza `whatsapp_instances.status`. Retorna para client
- `POST /api/whatsapp/disconnect` — chama `UazapiClient.deleteInstance`, marca status disconnected, limpa token
- Todas rotas exigem auth (`getCurrentUserAndTenant()`) + RLS correto

### Agente 3 — Tela `/onboarding`
- Design ref: `podZAP/screen_onboarding.jsx`
- Stepper: "1. Gerar QR → 2. Escanear → 3. Conectado"
- Server component busca `whatsapp_instances` existentes pro tenant
- Se já tem uma conectada: mostra status + botão "desconectar"
- Se não tem: botão "gerar QR" → chama `POST /api/whatsapp/connect` (client component faz o fetch)
- Client component: polling de `/api/whatsapp/status` a cada 2s até `connected`
- Mostra QR como `<img src="data:image/png;base64,...">`
- Feedback visual: chunky, sticker "QR pronto", timer de validade se UAZAPI tiver

### Agente 4 — Integration service + testes
- `lib/whatsapp/service.ts` — funções de alto nível:
  - `getTenantInstance(tenantId)` — retorna instância atual ou null
  - `createOrReuseInstance(tenantId)` — idempotente: se tem uma, retorna; senão cria
  - `refreshStatus(instanceId)` — fetch UAZAPI + update DB
- Testes unitários com mock de `UazapiClient` — verifica decisões de negócio sem burn de API

### Agente 5 — Atualizar Sidebar + CLAUDE.md + documentação
- Sidebar: atualizar badge de "Conectar Zap" (setup) com indicador visual de status (verde/cinza) baseado em `whatsapp_instances` do tenant
- `CLAUDE.md`: adicionar seção "Pipeline UAZAPI" com fluxo + envs relevantes
- `docs/integrations/uazapi.md`: fechar as "OPEN QUESTION" que o Agente 1 descobrir

## Critério de aceite (Nyquist)

- [ ] `npm run typecheck` + `npm run build` passam
- [ ] `/api/whatsapp/connect` (com user logado) retorna QR code válido (base64 começando com `data:image/png`)
- [ ] Polling `/api/whatsapp/status` retorna `'qrcode'` → (após scan manual) `'connected'`
- [ ] Banco mostra `whatsapp_instances` com `uazapi_token_encrypted` não vazio + status atualizado
- [ ] Encriptação é round-trip (teste unitário)
- [ ] RLS: user de outro tenant não vê a instância
- [ ] Smoke Playwright: `/onboarding` mostra QR (mesmo sem scanear)
- [ ] Screenshots + `AUDIT-fase-2.md`

## Riscos

- **UAZAPI endpoints desconhecidos**: Agente 1 faz descoberta live, pode falhar. Mitigação: se `createInstance` falhar, documenta erro + paramos pra pedir docs ao usuário.
- **Rate limit UAZAPI**: polling pesado pode dar 429. Mitigação: min interval 2s no client, exponential backoff em erros.
- **Token exposto**: `uazapi_token_encrypted` vazaria se ENCRYPTION_KEY vazasse. Mitigação: usar AES-GCM + nonce random, IV salvo junto com ciphertext, key só no servidor.
- **QR expira em ~30s** (padrão WhatsApp): se usuário demora, precisa regenerar. UI precisa handle.

## Ordem de execução

1. Agente 1 (sequential) — destrava os outros com endpoints reais + crypto
2. Agentes 2–5 em paralelo depois de Agente 1
3. Integração + testes + Playwright (com QR visível, sem scan)
4. **CHECKPOINT**: aviso ao usuário se ele precisa escanear pra validar end-to-end
