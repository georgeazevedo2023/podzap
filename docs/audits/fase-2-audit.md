# Auditoria — Fase 2 (Conexão WhatsApp / UAZAPI)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito geral

**PASS COM CAVEAT DE VALIDAÇÃO HUMANA.** Toda a infra da conexão está implementada, testada e validada via HTTP smoke + 39 unit tests. Falta **uma ação humana**: escanear um QR code real com WhatsApp para validar o fluxo end-to-end. Esse bloqueador é inerente à natureza do WhatsApp — nenhum teste automatizado consegue contornar.

---

## ✅ Checks executados

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ 39/39 (8 RLS + 13 crypto + 18 whatsapp-service) em 5.5s |
| `npm run build` | ✅ 12 rotas (novas: `/onboarding`, `/api/whatsapp/{connect,status,qrcode,disconnect}`) |
| UAZAPI live discovery | ✅ Agente 1 identificou endpoints reais, limpou 3 instâncias de teste |
| Auth guard `/onboarding` (HTTP) | ✅ GET 307 → `/login?next=/onboarding&error=...` |
| Auth guard APIs (HTTP) | ✅ 401 `{"error":{"code":"UNAUTHORIZED",...}}` |
| Encryption round-trip | ✅ 13 testes (IV random, tamper detection, formato) |

## 🟢 Destaques

- **Descoberta live de endpoints**: Agente 1 hit UAZAPI ao vivo, descobriu 8 endpoints, corrigiu assumptions do primeiro pass (`deleteInstance` usa instance token, não admin). Zero litter — todas instâncias de teste deletadas.
- **Crypto AES-256-GCM**: formato `<iv>.<ct>.<tag>`, erros tipados (`CryptoError`), IV random verificado.
- **Rate limiter**: 30/min/tenant em `/status` e `/qrcode`, retorna `429` com `Retry-After`.
- **DELETE em `disconnectInstance`**: cascateia `groups → messages → transcripts/summaries` via FKs existentes. Semanticamente "desconectar = recomeçar", documentado em JSDoc.
- **Polling resiliente**: 3s → backoff exponencial 6→12→24→30s no erro, reset em sucesso.
- **QR expiry UX**: após 45s em `connecting`, UI oferece botão "regenerar QR" (não dispara auto pra não queimar quota).
- **Sidebar**: badge de status real (verde/amarelo pulse/cinza) com fallback `'none'` em exceção.

## 🟡 Débitos (backlog)

1. **Validação E2E requer humano** — escanear QR real. Sem automação possível.
2. **Rate limiter in-memory** — per-process, não funciona com múltiplas instâncias Vercel. TODO comentado no código aponta Upstash/Redis.
3. **`refreshInstanceStatus` não atualiza `phone`** — UAZAPI status endpoint não retorna `owner`. Telefone popula pelo webhook (Fase 4).
4. **Rate limit UAZAPI** no client ainda usa mock — token bucket real quando chegar volume.
5. **Mobile responsiveness** do `/onboarding`: grids fixos em `1.1fr 1fr` quebram < 720px.
6. **QR auto-regen desativado** (só manual via botão). Em prod, pode frustrar — revisar quando houver dados.
7. **Webhook events `status`/`all`** não foram verificados live (doc oficial lista, API não respondeu). Tratar com cuidado na Fase 4.

## 📋 Fluxo validado

```
user logado → /onboarding
  → POST /api/whatsapp/connect
    → createInstanceForTenant → UAZAPI POST /instance/init (admintoken)
    → encrypt(instance.token) → insert whatsapp_instances (status='connecting')
  → GET /api/whatsapp/qrcode?instanceId=
    → UAZAPI POST /instance/connect (instance token)
    → returns base64 PNG (stripped of data: prefix)
  → UI: <img src="data:image/png;base64,{qr}"> + polling 3s
  → GET /api/whatsapp/status polling
  → (user scans QR manualmente)
  → status = 'connected' → UI redirect /home
```

## Recomendações para Fase 3

1. **Primeiro**: usuário escaneia um QR real uma vez pra validar Fase 2 end-to-end. Deixa uma instância `connected` no banco que serve de fixture pra Fase 3.
2. **Fase 3** (listagem de grupos) usa `UazapiClient.listGroups(instanceToken)` — já pronto. Sync + persistência + toggle.
3. Prep pra Fase 4 (webhook): adicionar `/api/inngest` ao matcher do proxy agora evita esquecer depois.
4. Se o usuário ainda não tiver escaneado, Fase 3 pode seguir com grupos semeados via service-role pra dev — marcar como "pendente validação UAZAPI real".
