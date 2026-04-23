# Auditoria — Fase 3 (Listagem e seleção de grupos)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito geral

**PASS.** 18 testes unitários adicionais passando. Serviço upsert-por-JID preserva `is_monitored` em re-syncs. UI com busca debounced + optimistic toggle + estados vazios cobertos. RLS herdada funciona (testes cross-tenant existentes + nova função usa tenant_id em toda query). Débitos da Fase 2 fechados em conjunto.

---

## ✅ Checks executados

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ |
| `npm test` | ✅ 57/57 (+ 18 em `groups-service.spec.ts`) em 5.6s |
| `npm run build` | ✅ 15 rotas (novas: `/groups`, `/api/groups`, `/api/groups/sync`, `/api/groups/[id]/monitor`) |
| Débitos Fase 2 | ✅ proxy matcher exclui `/api/inngest`, grids responsivos, aria-live no QR, PGRST205 mapeado em `/health` |

## 🟢 Destaques

- **`is_monitored` preservado em re-sync**: service carrega existentes + decide update-vs-insert por JID. `.upsert()` nativo iria sobrescrever — decisão correta.
- **Constraint real usada**: migration 0001 tem `UNIQUE (instance_id, uazapi_group_jid)` (não `tenant_id`). Agente notou + fez dedupe via map keyed em JID dentro do escopo de tenant. Net: correto.
- **Optimistic UI toggle** com revert em erro + skeleton durante in-flight.
- **Search client-side**: debounce 150ms, ESC clears — preserva responsividade sem round-trip.
- **Empty states cobertos**: sem instância → CTA onboarding; connecting → link de volta; 0 grupos → botão sync; filtro 0 → "limpar filtros".
- **a11y**: `aria-pressed` nos toggles, `aria-label` dinâmica, `role="status"` + `aria-live="polite"` no contador. Card `tabIndex=0` com handler Enter/Space.
- **Rate limit sync**: 6/min/tenant em `/api/groups/sync`; list/toggle sem limit (cheap).
- **Cross-tenant leak-proof**: `toggleMonitor` retorna `NOT_FOUND` tanto pra "não existe" quanto pra "é de outro tenant" — nunca leakar existência.

## 🟡 Débitos (backlog)

1. **Groups removidos da UAZAPI não marcados stale** — upsert-only. Fica pós-MVP (se não apareceu em N syncs, mark archived).
2. **`listGroups` sem paginação** — verificar se UAZAPI pagina quando usuário tiver muitos grupos. Parse atual assume array completo.
3. **`GroupsError.DB_ERROR` → 500 genérico** — poderia ter `VALIDATION_ERROR` para FKs violadas, mas caso é raro.
4. **Mobile responsive ok** mas não testado com Playwright live (MCP desconectou). Visual inspection only.
5. **`CLAUDE.md` §8 ainda marca Fase 2 como 🟡** — vou atualizar ao commitar.

## 📋 Fluxo validado

```
/groups (server)
  → listGroups(tenantId) + getCurrentInstance(tenantId)
  → se sem instância: empty state com CTA /onboarding
  → se 0 grupos: empty + SyncButton
  → senão: GroupsList (client)

SyncButton click
  → POST /api/groups/sync (6/min/tenant)
  → syncGroups(tenantId)
  → decrypt token → UazapiClient.listGroups(token)
  → upsert preservando is_monitored
  → router.refresh() → re-fetch server
  → toast success

Toggle monitor
  → optimistic flip
  → POST /api/groups/[id]/monitor { on }
  → toggleMonitor(tenantId, groupId, on) — RLS via tenant_id no WHERE
  → reconciliate | revert on error
```

## Recomendações para Fase 4

1. **Fase 4** (webhook captura mensagens): 
   - `/api/webhooks/uazapi` JÁ tá excluído do matcher do proxy desde a Fase 2 (validado).
   - Matcher agora também exclui `/api/inngest` pra Fase 5.
   - Precisa de **URL pública** (ngrok/cloudflared) pra UAZAPI postar webhooks em localhost. Vou documentar no plan.
2. **Seed de dev**: se usuário ainda não escaneou QR, Fase 4 pode testar parsing com fixtures JSON.
3. Webhook recebe texto/áudio/imagem — a tabela `messages` já tá pronta desde 0001.
4. **Dedup por `(tenant_id, uazapi_message_id)`** (já aplicado em 0002_fixes).
