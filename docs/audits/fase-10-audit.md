# Auditoria — Fase 10 (Entrega WhatsApp)

Auditor: Claude (Opus 4.7 1M). 2026-04-22.

## Veredito

**PASS.** Fluxo de entrega automático (via Inngest on audio.created) + manual redeliver funcionando. 12 testes novos (225 total).

## Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 225/225 |
| build | ✅ |

## Destaques

- Worker `deliver-to-whatsapp` on `audioCreated`, 3 retries
- Short-circuit em `delivered=true` (idempotência) vs redeliver force
- `tenants.include_caption_on_delivery` + `delivery_target` via migration 0006, worker lê dinamicamente
- DeliveryError codes: NOT_FOUND(404), NO_INSTANCE(409), INSTANCE_NOT_CONNECTED(409), UAZAPI_ERROR(502), DB_ERROR(500)
- UI dupla: /podcasts badges + /approval/[id] metadata card, reuso do endpoint signed-url
- Relative time helper PT-BR via `Intl.RelativeTimeFormat`
- Settings card no /home com optimistic PATCH + rollback
- Rate limit 6/h/tenant no redeliver

## Débitos

1. **Grupo removido vs UAZAPI_ERROR genérico** — consume retries inutilmente
2. **Buffer size UAZAPI** — sem fallback pra URL pública se passar
3. **`redeliver` endpoint não aceita `includeCaption` flag** — sempre usa default
4. **`delivery_target=owner_dm|both`** coluna existe mas worker ignora — só grupo por ora

## Fase 11 próxima — Agendamento

Worker cron que:
1. Lista tenants com `schedules` ativas
2. Pra cada: gera NormalizedConversation → emit `summary.requested` → resto do pipeline roda
3. Modos `auto|optional|required` definem o que acontece após pending_review (auto pula aprovação)

Plan a seguir.
