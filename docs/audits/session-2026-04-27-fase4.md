# Sessão 2026-04-27 (continuação) — Mobile-first Fase 4: admin no phone

Continuação da sessão da manhã ([`session-2026-04-27.md`](./session-2026-04-27.md)).
Fase 4 entregue, fechando o ciclo mobile-first.

## O que foi feito

Refatorou as 3 telas admin com tabelas (`/admin/tenants`, `/admin/users`,
`/admin/uazapi`) + tabela de membros em `/admin/tenants/[id]` pra
funcionarem em phones (390×844). Aboradagem **B do plano**: criar componente
`<AdminEntityList>` que renderiza `<table>` em md+ e cards stacked em <md.

Sem regressão de desktop — em md+ as tabelas continuam idênticas porque
o componente reaproveita o markup `<table>/<tr>/<td>` existente, só com
toggles `data-desktop-only`/`data-mobile-only` decidindo quando aparecem.

### Arquivos tocados

- **Novo:** `components/admin/AdminEntityList.tsx` (227 LOC) — componente
  genérico `<AdminEntityList<T>>` com props `columns`, `rows`, `getRowKey`,
  `mobileTitle`, `mobileSubtitle`, `actions`, `emptyState`. Renderiza tabela
  em md+ e cards (DL/DT/DD label:value) em <md.
- `app/globals.css` — 3 regras novas:
  - `.btn-xs` (text 12, padding 8×12, **min-height 44** pra WCAG 2.5.5)
  - `.admin-modal-footer` (row em md+, column full-width em <md)
  - `.admin-form-grid-2` (1fr em <40rem, 1fr 1fr em md+)
- `app/(admin)/admin/tenants/TenantsTable.tsx` — usa AdminEntityList. Exporta
  `ModalShell`, `ModalFooter`, `FormError`, `PlanBadge`, `StatusPill`,
  `fieldLabel`, `inputStyle`, `formatDate` pra reuso.
- `app/(admin)/admin/users/UsersTable.tsx` — usa AdminEntityList. Substituiu
  `window.confirm("promover...")` por modal próprio `SuperadminConfirmModal`.
  `NewUserModal` usa `.admin-form-grid-2` (tenant/role colapsam em <sm).
- `app/(admin)/admin/uazapi/UazapiTable.tsx` — usa AdminEntityList.
- `app/(admin)/admin/tenants/[id]/TenantDetailClient.tsx` — tabela de
  membros via AdminEntityList. Substituiu `window.confirm("remover...")` por
  modal `RemoveMemberModal`. Header actions com `.btn-tap` (44h floor).

### Testes

- **`e2e/mobile-audit.spec.ts`** estendido: `AuditFindings` ganhou
  `smallAdminActions[]`, com assertion hard de que `[data-admin-action]` em
  `/admin/*` precisa hit ≥44px. Cobrindo 4 rotas admin.
- **`e2e/admin-mobile.spec.ts`** novo: 4 testes
  - 3× cards stacked visíveis (e tabela escondida) em /admin/{tenants,users,uazapi}
  - 1× footer do modal "novo tenant" é `flex-direction: column` com CTAs ≥280px

Resultado: **15/15 testes passaram** local (`npx playwright test e2e/mobile-audit.spec.ts e2e/admin-mobile.spec.ts --workers=2`).

## Decisões importantes

1. **Plano B ganhou** — em vez de regra CSS `.admin-table-as-cards` global
   que viraria `<table>` em `display: block`, criamos um componente
   declarativo. O motivo: a coluna "ações" é um conjunto de botões com
   handlers de estado (busy, modal); descrever isso via `data-label` e CSS
   truques teria sido mais código, não menos.

2. **Botões `.btn btn-ghost btn-xs`** com atributo `data-admin-action` —
   o atributo é só pra Playwright atribuir asserções em massa nos botões
   de ação (separa dos links de navegação tipo "ver"). O floor de 44h vem
   do próprio `.btn-xs`, não do attribute.

3. **`window.confirm` ELIMINADO** — toda confirmação destrutiva agora tem
   modal chunky com:
   - Box explicativo colorido (red pra delete, yellow pra warning)
   - Quando "irreversível", input "digite o nome pra confirmar"
   - Botões dimensionados (`.btn-tap`)
   - `ModalFooter` empilha em <md

4. **`ModalShell` mais compacto em mobile** — padding 16px (era 24)
   no overlay, padding 20 (era 24) no card. Botão fechar passou de 32×32 →
   44×44 (passa o floor).

## Tap targets remanescentes (não-admin)

A auditoria mostra que `/admin/*` ainda tem 2 tap targets <44 fora do escopo
desta fase, herdados do shell:

- `header > a` "george.azevedo2023" (chip clicável → `/account`) — 154×24
- `header > a` "sair" — 40×29

Esses ficaram em backlog no [`session-2026-04-27.md`](./session-2026-04-27.md)
§"Tap targets <44px ainda pendentes (cross-fase)" como **cosméticos, baixa
prioridade** — eles aparecem em desktop sidebar e não têm equivalente
content-level em /admin. Vão ser tratados num passo de polish do shell.

## Como verificar em prod

Após deploy:

```bash
set -a; . ./.env.local; set +a
PLAYWRIGHT_BASE_URL=https://podzap.wsmart.com.br \
  npx playwright test e2e/admin-mobile.spec.ts e2e/mobile-audit.spec.ts \
  --workers=2 -g "admin"
```

Esperado: 7/7 verde (4 do mobile-audit admin + 3 cards stacked + ~1 modal).

Visualmente:

- iPhone 13 (390×844): cards empilhados em /admin/tenants, /admin/users,
  /admin/uazapi. Tabela só aparece em desktop (≥768).
- Modais em <md: CTAs cancelar/confirmar empilhados (cancelar em cima,
  primário embaixo, ambos full-width).
- Botões de ação ≥44h em todos os cards.

## Métricas finais

- **1 componente novo** + 5 arquivos refatorados + 1 spec novo + 1 spec estendido
- **+~200 / −~750 LOC** (componente abstrai duplicação dos 3 tables)
- **15/15 specs verdes** local
- **0 regressão desktop** (markup table preservado em md+)
- **0 horizontal overflow** em /admin/* @390px
- **0 small admin actions** (todos `[data-admin-action]` ≥44h)

## Próximos passos sugeridos

Mobile-first concluído. O que sobra do roadmap pós-MVP em [`ROADMAP.md`](../../ROADMAP.md):

- 🧊 Audit log de ações do superadmin (Fase 13 backlog)
- 🧊 Email transacional ao criar usuário
- 🧊 `/forgot-password` self-service
- 🧊 Tap targets cross-fase (Player buttons /home, switches /groups,
  pagination /history) — todos content-level
- 🧊 Settings page (Fase 12 backlog)
- 🧊 Schedules UI (Fase 11 backlog)
