# Auditoria — Fase 4 (Captura de mensagens — webhook)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito geral

**PASS COM CAVEAT DE E2E.** Toda infra de recepção, validação, persistência, media download e RLS de Storage implementada e testada (35 testes unit novos). Caveat: E2E real requer URL pública (ngrok) + mensagem real vinda de um WhatsApp conectado, que por sua vez requer o scan humano da Fase 2. Smoke via curl local confirma comportamento correto em todos os cenários.

---

## ✅ Checks executados

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ 92/92 (+35: 13 validator, 22 persist) em 7.5s |
| `npm run build` | ✅ 19 rotas (novas: `/history`, `/api/webhooks/{uazapi,test}`, `/api/history`) |
| Migration 0003 | ✅ 5 colunas novas em `messages` + 2 índices |
| Bucket `media` criado | ✅ idempotente via script |
| Storage RLS policies | ✅ 4 policies, `safe_uuid` helper pra paths malformados |
| Smoke HTTP webhook | ✅ GET 200, POST sem secret 401, POST com secret errado 401, body ruim 200 ignored |
| Smoke auth `/history` | ✅ 307 → `/login` |

## 🟢 Destaques

- **Defense-in-depth dedup**: pre-check + 23505 race catch.
- **Secret validation constante em tempo**: `crypto.timingSafeEqual`.
- **Auth secret: header OR query** — UAZAPI registra URL sem header, query fallback essencial.
- **fromMe=true ignorado**: evita loops.
- **Grupos não-autoCreate**: tenant tem que sync explicitamente.
- **`raw_payload` jsonb**: debug invaluable, round-trip JSON pra estripar undefined.
- **Fire-and-forget media download** com status trackado em DB — worker Fase 5 pode re-tentar `pending` stale.
- **SSRF guards**: scheme allow-list, IPv4/IPv6 literal blocks pra ranges privadas, hostname blocks `localhost`/`ip6-*`. DNS lookup skipado (cost/benefit).
- **MIME sniff por magic bytes**: PNG/JPEG/GIF/WebP/OGG/MP3/MP4 (com disambig M4A/M4B/M4P vs video), fallback encadeado (Content-Type → hintedMime → octet-stream).
- **Storage: `safe_uuid(text)`** helper retorna NULL em path malformado → RLS nega em vez de erro.
- **`/history` signed URLs server-side** (client nunca vê service role), `<img loading="lazy">`, `<audio preload="none">`, lightbox pra images.
- **Pending placeholder** na UI quando mídia ainda não downloaded.

## 🟡 Débitos

1. **E2E real requer ngrok + WhatsApp conectado** — humano precisa.
2. **Fixture substitution depende de instância real no DB** — placeholder `__TENANT_ID__` só popula se houver `whatsapp_instances` row. Dev standalone sem QR scan não consegue testar fluxo completo.
3. **Media download síncrono inline** — pode atrasar webhook. Fase 5 move pra Inngest worker.
4. **DNS resolution pra hostname SSRF** não implementado. Se algum dia aceitarmos URLs de fontes não-trusted, adicionar.
5. **Nenhuma quota/rate limit no webhook handler** — UAZAPI pode flood. Considerar semaphore ou queue depth limit.
6. **`updateInstanceConnection` só bump `last_seen_at`** — deixa status transition pra Fase 5 ou worker futuro.
7. **`raw_payload` pode crescer** — cada mensagem guarda o payload inteiro. Retention policy fica pós-MVP.
8. **`register-webhook.mjs` tem crypto inline** (mirror de `lib/crypto.ts`) — duplicação. Refatorar pra compartilhar ESM.

## 📋 Fluxo validado (smoke)

```
POST /api/webhooks/uazapi
  → validateSecret (header OR query, timingSafeEqual)
  → parseWebhookBody (zod discriminated union)
  → handleWebhookEvent
    → persistIncomingMessage (se event=message)
      → resolve tenant via uazapi_instance_id
      → resolve group, check is_monitored
      → insert messages (on conflict do nothing)
      → void downloadAndStore (fire-and-forget)
    → updateInstanceConnection (se event=connection)
  → 200 { ok, status, cid }
  (handler throw → catch, log, still 200 pra não retry)
```

## Recomendações para Fase 5

1. **Inngest worker**: transcrição áudio (Groq) + descrição imagem (Gemini Vision) a partir de `messages.media_download_status='downloaded'` com `type IN ('audio', 'image')`. Inserir em `transcripts`.
2. Workers também processam `media_download_status='pending'` stale (>5min) para retry.
3. **`/api/inngest`** (JÁ excluído do matcher proxy) recebe Inngest events.
4. **Instrument tracking de custo** em `messages.raw_payload` ou tabela nova `ai_calls`. Tenants podem estourar tier; monitorar.
5. Preparar fixture com media_url real (pequeno OGG) em `lib/webhooks/fixtures/` pra teste E2E.
