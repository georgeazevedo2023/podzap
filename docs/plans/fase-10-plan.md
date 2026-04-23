# Fase 10 — Entrega (WhatsApp)

**Objetivo:** áudio gerado chega no WhatsApp (enviado via UAZAPI pro grupo original ou pro usuário).

**Pré-condição:** Fase 9. Audio row com storage_path.

## Componentes

### Inngest
- Worker `deliver-to-whatsapp` on event `audio.created`
- `generate-tts` emite esse event após criar audio row

### Rotas
- `POST /api/audios/[id]/redeliver` — re-tentar entrega

### Código
- `lib/delivery/service.ts`:
  - `deliverAudio(tenantId, audioId, opts?)` — download do Storage → UAZAPI sendAudio → marca delivered
  - `getDeliveryTarget(tenantId, summaryId)` — decide pra onde enviar (config por tenant: grupo original ou DM do owner)

### Schema
- Se faltar coluna `delivery_target_jid` em `audios`, migration `0006_delivery.sql`
- Senão usar `groups.uazapi_group_jid` do summary.group_id

### UI
- `/podcasts` mostra badge "entregue no WhatsApp ✓" quando `delivered_to_whatsapp=true`
- Botão "reenviar" no card

## Agentes (A1 sequencial, 4 paralelos)

### A1 — Service + worker + Inngest event
- Add event `audioCreated` em `events.ts`
- `generate-tts.ts` emite no fim do step
- `inngest/functions/deliver-to-whatsapp.ts` on `audioCreated`
- `lib/delivery/service.ts` com `deliverAudio`
- Tests

### A2 — API route redeliver + _shared
- `POST /api/audios/[id]/redeliver` rate limit 6/h/tenant
- Error mapping DELIVERY_ERROR

### A3 — UI updates em /podcasts + /approval/[id]
- Badge delivered, botão reenviar
- Timestamp relativo

### A4 — Legenda configurável
- Adicionar flag `summary.include_caption` (toggle UI) — se true, envia texto junto
- Senão, só áudio

### A5 — Docs + status
- `docs/integrations/delivery.md`
- CLAUDE + ROADMAP + README

## Aceite

- [ ] typecheck + tests + build
- [ ] Aprovar summary → áudio gerado → entregue no WhatsApp com legenda
- [ ] Row `audios.delivered_to_whatsapp=true`
- [ ] Botão reenviar funciona
- [ ] AUDIT-fase-10

## Riscos

- **UAZAPI sendAudio**: buffer size limit? precisa testar. Fallback: upload to public URL + send URL.
- **Grupo desaparecido**: UAZAPI retorna erro. Marca delivered_to_whatsapp=false + error msg.
- **Rate limit UAZAPI**: ~10/min. Queue externa pós-MVP.
- **Fluxo requer instância conectada**: se desconectou entre aprovar e entregar, retry.
