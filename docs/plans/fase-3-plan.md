# Fase 3 — Listagem e seleção de grupos

**Objetivo:** usuário com WhatsApp conectado vê todos os grupos da instância, liga/desliga "monitorar" por grupo, e a escolha persiste no banco respeitando RLS.

**Pré-condição:** Fase 2. Uma instância com status `connected` (ou grupos seedados para dev).

## Componentes

### Rotas
| Rota | Tipo | Propósito |
|---|---|---|
| `/(app)/groups` | Server component | Lista os grupos com toggles |
| `POST /api/groups/sync` | Route handler | Faz pull dos grupos do UAZAPI pro banco |
| `POST /api/groups/:id/monitor` | Route handler | Toggle `is_monitored` |
| `GET /api/groups` | Route handler (opcional) | Retorna lista pro client (client-side refresh) |

### Código
- `lib/groups/service.ts` — `syncGroups(tenantId)`, `toggleMonitor(tenantId, groupId, monitored)`, `listGroups(tenantId)`
- Upsert no `groups` por `(tenant_id, uazapi_group_jid)` (já tem unique no SQL)
- Atualizar `last_synced_at` no sync

### UI
- Design ref: `podZAP/screen_groups.jsx`
- Lista de cards chunky com: avatar/picture, nome, # membros, toggle "monitorar"
- Filtro/busca (client-side)
- Sticker indicando # de grupos monitorados
- Botão "sincronizar" dispara `POST /api/groups/sync`

## Tarefas para 5 agentes

### Agente 1 — Service layer + testes
- `lib/groups/service.ts`:
  - `syncGroups(tenantId)` — carrega instance, chama `UazapiClient.listGroups`, faz upsert por `(tenant_id, uazapi_group_jid)`, atualiza `last_synced_at`
  - `listGroups(tenantId, { monitoredOnly? })` — query simples
  - `toggleMonitor(tenantId, groupId, on)` — update com tenant check
- Testes em `tests/groups-service.spec.ts` com mock de UazapiClient + fake Supabase

### Agente 2 — API routes `/api/groups/*`
- `POST /api/groups/sync` — auth → service → retorna `{ count }`
- `POST /api/groups/[id]/monitor` — auth → service → retorna `{ ok, group }`
- `GET /api/groups` — opcional, retorna lista
- Error envelope padrão + rate limit leve (sync: 6/min/tenant)

### Agente 3 — Tela `/groups`
- Server component: lista grupos via `listGroups(tenantId)`
- Estado vazio: "sincroniza seu WhatsApp pra listar" + botão sync
- Client components para toggles + filtro/busca (client-side)
- Contagem de monitorados no header
- Chamada de `POST /api/groups/sync` com loading state
- Mobile-friendly: uma coluna em < 720px

### Agente 4 — Integração: limpar débito Fase 2
- Atualizar matcher do proxy pra excluir `/api/inngest` (débito pendente)
- Fix responsividade do `/onboarding` (grids auto-fit)
- Adicionar aria-live nos status/counters do QrCodePanel (a11y)
- Garantir que `/groups` aparece no Sidebar como ativo quando navegado

### Agente 5 — Docs + link mental
- Atualizar `ROADMAP.md` (Fase 3 em andamento)
- Atualizar `CLAUDE.md` §8 status
- Criar `docs/integrations/groups-sync.md` explicando o fluxo
- Após integração, screenshots + checklist

## Critério de aceite

- [ ] `npm run typecheck` + `npm run build` + `npm test`
- [ ] `POST /api/groups/sync` popula `groups` com UAZAPI data (fixture ou live)
- [ ] Toggle persiste `is_monitored` e RLS bloqueia cross-tenant
- [ ] `/groups` mostra lista + contador + filtro + sync button funcionando
- [ ] Screenshot em `docs/audits/screenshots/fase-3-groups.png`
- [ ] `AUDIT-fase-3.md`

## Riscos

- **Sem instância conectada**: `listGroups` retorna vazio. Agentes devem testar com mock — live fica pra "quando usuário escanear".
- **Grupos removidos na UAZAPI**: sync atual faz upsert, não delete. Por enquanto, `is_monitored=false` + UI marca "não encontrado no último sync" é suficiente.
- **Grupos com muitos membros**: `listGroups` pode paginar na UAZAPI. Verificar live, adicionar paginação se necessário.

## Ordem

Todos os 5 em paralelo — não há dependências sequenciais (interfaces bem definidas).
