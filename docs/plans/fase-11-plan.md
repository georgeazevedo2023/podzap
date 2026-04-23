# Fase 11 — Agendamento (última fase MVP)

**Objetivo:** resumos automáticos conforme `schedules` — cron roda, pra cada grupo monitorado com schedule ativo dispara o pipeline completo sem intervenção.

**Pré-condição:** Fases 1-10. Tabela `schedules` já existe.

## Componentes

### Service
- `lib/schedules/service.ts`:
  - `listSchedules(tenantId)`, `createSchedule(input)`, `updateSchedule`, `deleteSchedule`, `toggleActive`
  - `dueSchedulesNow(now: Date)` — returns all schedules due in current time window (service-role)

### Inngest
- `inngest/functions/run-schedules.ts` cron `*/5 * * * *`:
  - Lista dueSchedulesNow
  - Pra cada: calcula periodStart/End (ex: últimas 24h), emite `summary.requested` com a tone do schedule
  - Se `approval_mode='auto'`: após resumo gerar, auto-approve (nova event wire)
  - Se `optional`: fica em pending_review mas com hint "auto-approve em 24h"
  - Se `required`: fica pending

### Rotas
- `GET /api/schedules`
- `POST /api/schedules`
- `PATCH /api/schedules/[id]`
- `DELETE /api/schedules/[id]`

### UI
- `/(app)/schedule` (já tem item no Sidebar): listar + criar agendamento por grupo monitorado
- Form: grupo, horário, frequência (diário/semanal), tom, approval_mode, voice

## Agentes

A1 seq: service + worker cron + tests
A2: API CRUD + _shared
A3: UI /schedule com listagem + create + edit
A4: auto-approve flow (event `summary.auto_approved` + handler)
A5: docs + CLAUDE + ROADMAP + README

## Aceite

- [ ] Criar schedule "todo dia 18h" → cron dispara às 18h → resumo gerado
- [ ] Modo `auto` passa direto pra TTS + delivery
- [ ] Modo `required` fica pending
- [ ] UI CRUD funciona
- [ ] typecheck + tests + build
- [ ] AUDIT-fase-11.md + completion report

## Riscos

- **Timezones**: schedules tem `time_of_day` sem tz. Documentar como America/Sao_Paulo por ora.
- **Crons em Inngest dev não disparam**: testar via invoke manual no dashboard.
- **Overlap de resumos**: mesmo grupo + dia = 2 runs do cron = 2 summaries. Dedup check (já existe pending_review/approved no dia → skip).
