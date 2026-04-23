# Fase 4 — Captura de mensagens (webhook)

**Objetivo:** receber mensagens do WhatsApp em tempo real via webhook UAZAPI, persistir no banco (com mídia no Storage), deduplicar, respeitando tenant isolation.

**Pré-condição:** Fase 3 (grupos monitorados configurados). Idealmente uma instância UAZAPI conectada + grupos marcados `is_monitored=true`.

## ⚠️ Bloqueador: URL pública

UAZAPI precisa bater em URL acessível pela internet. Localhost não serve. Opções:
- **ngrok** (`ngrok http 3001`) → URL pública HTTPS
- **cloudflared** (`cloudflared tunnel`)
- **Deploy Vercel** preview (mais sustentável mas mais setup)

Para dev, **ngrok é o padrão**. Documentar no plan.

Alternativa sem URL pública: **simulador de webhook** que dispara payloads gravados, mimetizando UAZAPI. Ótimo pra dev mas não cobre o caminho real. Vamos ter os 2.

## Componentes

### Rotas
| Rota | Tipo | Propósito |
|---|---|---|
| `POST /api/webhooks/uazapi` | Route handler (matcher exclui auth) | Recebe payloads, valida, persiste |
| `GET /api/webhooks/uazapi` | Route handler | Health check p/ UAZAPI testar |
| `POST /api/webhooks/test` | Route handler (dev-only) | Disparador local de fixtures |

### Código
- `lib/webhooks/validator.ts` — valida secret + schema (zod)
- `lib/webhooks/handler.ts` — despacha por tipo de evento (`messages`, `connection`)
- `lib/webhooks/persist.ts` — cria rows em `messages`, dedup por `(tenant_id, uazapi_message_id)`
- `lib/media/download.ts` — baixa áudios/imagens da URL UAZAPI + upload pro Supabase Storage
- `lib/webhooks/fixtures/` — payloads gravados (texto, áudio, imagem, conexão)

### Storage
- Bucket `media` no Supabase Storage
- Path pattern: `<tenant_id>/<year>/<month>/<message_id>.<ext>`
- RLS no bucket por `tenant_id` (policies)

### Testes
- Unit: handler dispatches by event type, dedup, validator rejects malformed
- Integration: fixture → full persist chain → row no banco
- E2E: POST real com curl no dev server

## Tarefas para 5 agentes

### Agente 1 — Migration 0003 + Storage
- Criar bucket `media` via Management API
- Policies RLS no bucket: owner (service role) pode tudo; `authenticated` pode GET somente se path começa com seu tenant_id (verificar via função)
- Adicionar colunas faltantes em `messages` se necessário (ex: `media_mime_type`, `media_size_bytes`)
- Rodar migration live via script

### Agente 2 — Webhook validator + handler + persist
- `lib/webhooks/validator.ts`: valida `x-uazapi-secret` header contra `UAZAPI_WEBHOOK_SECRET` (descobrir se UAZAPI usa header signed ou URL secret)
- `lib/webhooks/handler.ts`: recebe payload zod-validated, despacha
- `lib/webhooks/persist.ts`: 
  - `persistMessage(payload)` — resolve `tenant_id` via `whatsapp_instances.uazapi_instance_id`
  - resolve `group_id` via `groups.uazapi_group_jid` + tenant_id (ignora se grupo não monitorado)
  - insert em `messages` com dedup
  - se tem media URL → enqueue download (não bloquear webhook)
- Testes unit com fixtures

### Agente 3 — `/api/webhooks/uazapi` route + fixtures + test endpoint
- `POST /api/webhooks/uazapi` — lê body, valida, chama handler, retorna 200 rapidamente (< 5s)
- `GET /api/webhooks/uazapi` — retorna `{ ok: true }` pra UAZAPI testar
- `POST /api/webhooks/test` (dev-only, guarded por `NODE_ENV !== 'production'`) — aceita `{ fixture: 'text'|'audio'|'image'|'connection' }` + tenant_id opcional
- Fixtures em `lib/webhooks/fixtures/*.json` (3-4 payloads reais gravados manualmente via curl real ao UAZAPI — ou criados sinteticamente se não der)

### Agente 4 — Media downloader + Storage integration
- `lib/media/download.ts`:
  - `downloadAndStore(messageId, url, tenantId)` — fetch URL (com timeout + SSRF guard), upload pro bucket `media`, retorna `storage_path`
  - Detectar mime via magic bytes (reaproveitar helper do UAZAPI client?)
  - Atualizar `messages.media_url` com o signed URL ou caminho relativo
- Por ora, chamar inline no handler (síncrono). Fase 5 move pra worker Inngest.
- Testes com mock de fetch + mock de storage

### Agente 5 — Dashboard de captura + docs + ngrok instructions
- Adicionar tela `/(app)/history` server que lista últimas N mensagens capturadas do tenant (simples, só pra feedback visual) — mockup `podZAP/screen_history_schedule.jsx`
- `docs/integrations/webhooks.md`: setup ngrok, como registrar webhook na UAZAPI (`POST /webhook`), payload format, dedup, security
- Atualizar `CLAUDE.md` + `ROADMAP.md`
- Script `scripts/register-webhook.mjs` — registra webhook URL no UAZAPI (chama `setWebhookConfig`)

## Critério de aceite

- [ ] typecheck + build + tests
- [ ] `POST /api/webhooks/test` com fixture de texto → row em `messages`
- [ ] Mesmo ID 2x → só 1 row (dedup)
- [ ] Fixture áudio → media baixada + em Storage + path no banco
- [ ] Webhook sem secret → 401
- [ ] Webhook com grupo não monitorado → ignora
- [ ] `/history` mostra últimas mensagens
- [ ] `AUDIT-fase-4.md` + screenshots

## Riscos

- **Secret model UAZAPI desconhecido**: Agente 1/2 descobrem live. Pode ser URL secret no path, header, ou payload-embedded.
- **Media URL expira**: se UAZAPI URLs expiram rápido, precisa download imediato. Se async (Fase 5), pode perder.
- **Payload shape em vídeo/document**: só texto/áudio/imagem no MVP; outros tipos → `type='other'` + content=name/tipo pra visibilidade.
- **Flood de mensagens**: grupos grandes podem mandar 100+/min. Webhook handler deve ser não-bloqueante. Por ora, insert síncrono + TODO pra fila.

## Ordem

Agente 1 primeiro (migration storage) → Agentes 2, 3, 4, 5 em paralelo.
