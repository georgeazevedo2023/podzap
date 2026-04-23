# Auditoria — Fase 11 (Agendamento) · LAST MVP PHASE

Auditor: Claude (Opus 4.7 1M). 2026-04-22.

## Veredito

**PASS.** Agendamento automático funcional end-to-end: cron → dueSchedulesNow → summary.requested → pipeline completo → (auto-approve se configurado) → TTS → delivery. 21 testes novos (246 total).

## Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 246/246 |
| build | ✅ 30 rotas |

## Destaques

- **Timezone América/São_Paulo** hard-coded via `Intl.DateTimeFormat` — sem dependência externa
- **Dedup por overlap de período** (`period_start <= end AND period_end >= start`) — belt-and-suspenders contra ticks duplicados
- **Auto-approve inline no generate-summary** — +1 event na wire em vez de worker separado, Inngest memoiza step
- **Modal form** pra create/edit com disabled states (`inactivity`/`dynamic_window` marcados "em breve")
- **UNIQUE (tenant_id, group_id)** no schedules impede 2 schedules no mesmo grupo
- **Cross-tenant NOT_FOUND** ao atualizar/deletar schedule alheio
- **CONFLICT** mapeado pra 409 no _shared.ts

## Débitos

1. **Crons Inngest dev não disparam** — documentado, testar via manual invoke dashboard
2. **`trigger_type` `inactivity|dynamic_window`** nos enums mas não implementados — UI disabled
3. **`approval_mode=optional`** sem timer de 24h auto-approve — hoje equivalente a `required`
4. **`frequency=custom`** reservado mas sem handler

---

## 🎉 MVP Completo

Com a Fase 11 fechada, o MVP do podZAP entrega:

| # | Fase | Status |
|---|------|--------|
| 0 | Scaffolding | ✅ |
| 1 | Auth + RLS | ✅ |
| 2 | Conexão UAZAPI | ✅ |
| 3 | Listagem de grupos | ✅ |
| 4 | Webhook + storage | ✅ |
| 5 | Transcrição Groq/Gemini | ✅ |
| 6 | Filter + cluster | ✅ |
| 7 | Geração LLM | ✅ |
| 8 | Aprovação humana | ✅ |
| 9 | TTS | ✅ |
| 10 | Entrega WhatsApp | ✅ |
| 11 | Agendamento | ✅ |

**Ver `docs/MVP-COMPLETION.md` pro relatório completo da jornada.**
