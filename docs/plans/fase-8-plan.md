# Fase 8 — Aprovação humana ⭐ (feature principal)

**Objetivo:** usuário revisa, edita ou rejeita o resumo gerado. Só aprovados avançam pra TTS (Fase 9).

**Pré-condição:** Fase 7. `summaries` com `status='pending_review'`.

## Componentes

### Rotas
| Rota | Tipo | Propósito |
|---|---|---|
| `/(app)/approval` | Server | Lista summaries pending |
| `/(app)/approval/[id]` | Server | Detalhe + editor |
| `POST /api/summaries/[id]/approve` | Handler | `status → approved`, dispara Fase 9 |
| `POST /api/summaries/[id]/reject` | Handler | `status → rejected` com motivo |
| `POST /api/summaries/[id]/regenerate` | Handler | Gera nova versão (novo tone ou instruções) |
| `PATCH /api/summaries/[id]` | Handler | Salva edit manual do texto |

### Código
- `lib/summaries/service.ts` estender com `approveSummary`, `rejectSummary`, `updateSummaryText`
- Sidebar badge: count de pending_review

### UI
- Design ref: `podZAP/screen_approval.jsx`
- Lista: cards com group, period, texto truncado, status pill
- Detalhe: textarea grande editável, metadata (tokens, cost, prompt version), 3 botões (aprovar, rejeitar, regenerar)
- Regenerar: dropdown de tom + botão "regenerar" → emit `summary.requested` com novo tom, volta pra lista com nova row pending

## Agentes

### Agente 1 — Service extensions + actions
- Extender `lib/summaries/service.ts` com `approveSummary(tenantId, id, userId)`, `rejectSummary(tenantId, id, reason, userId)`, `updateSummaryText(tenantId, id, text)`
- Validações: só pending_review pode mudar
- Tests

### Agente 2 — API routes
- `POST /approve` → service + emit event `summary.approved` (para Fase 9)
- `POST /reject` → service
- `POST /regenerate` → emit `summary.requested` novo
- `PATCH` → updateSummaryText

### Agente 3 — Tela `/approval` (lista)
- Server, filtros status + groupId
- Cards com truncate, tone badge (color-coded)
- Click → `/approval/[id]`

### Agente 4 — Tela `/approval/[id]` (detail + editor)
- Textarea com state client
- "Salvar" → PATCH
- "Aprovar" / "Rejeitar (motivo)" / "Regenerar com tom X"
- Metadata side panel

### Agente 5 — Sidebar badge + docs
- Count de pending em Sidebar (usa tenant_id, cached 30s)
- Docs `/docs/integrations/approval.md`
- CLAUDE + ROADMAP + README

## Aceite

- [ ] typecheck + build + tests
- [ ] Aprovar summary → status atualiza + evento emit
- [ ] Rejeitar com motivo → status + reason salvos
- [ ] Regenerar → nova row pending criada
- [ ] Edit manual preserva
- [ ] RLS: outro tenant não vê/muda
- [ ] AUDIT-fase-8.md

Ordem: Agente 1 sequencial, depois 2-5 paralelos.
