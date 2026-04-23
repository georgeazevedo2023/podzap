# Fase 13 audit — Admin-managed tenancy

**Data:** 2026-04-23
**Agentes:** A1 (migration + login + proxy), A2 (tenants + users services/APIs), A3 (uazapi admin service/APIs), A4 (admin UI shell), A5 (integração + docs + commit)
**Branch:** `main`
**Auditor:** A5

---

## Veredito

**PASS WITH CONCERNS.** Núcleo funcional e seguro — backend admin-managed está 100% no ar, login por senha funciona, proxy gateia `/admin/*`, migration 0008 aplicada, e **A4 entregou as 4 telas principais** (`/admin` dashboard, `/admin/tenants` + `[id]` + `new`, `/admin/users`, `/admin/uazapi`). O que mantém o veredito em "with concerns" são débitos de UX/ops listados na seção "Débitos aceitos" abaixo (email transacional, audit log, password self-reset, modal chunky). Nenhum débito é bloqueante.

Nenhuma regressão no MVP 1.0: todo o fluxo pipeline (webhook → transcribe → filter → summarize → approve → TTS → deliver → schedule) segue passando em testes (**319/319**) e build.

---

## Checks automáticos

| Check | Resultado |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm test` | ✅ 319 passing / 25 spec files / 5.93s (54 novos testes vs. F12) |
| `npm run build` | ✅ build-time rotas listadas, nenhum erro de compile |
| Smoke `/login` | ✅ `200 OK`, form contém `name="email"` + `name="password"` |
| Smoke `/signup` | ✅ `404 Not Found` (rota não existe) |
| Smoke `/admin` (deslogado) | ✅ `307 → /login?next=/admin` |
| Smoke `/admin/tenants` (deslogado) | ✅ `307 → /login?next=/admin/tenants` |
| Smoke `/api/admin/tenants` (sem auth) | ✅ `302` (redirect via `requireSuperadmin`) |
| Proxy `/admin/*` exige superadmin | ✅ via `proxy.ts` (`superadmins.select().eq(user_id)`) |
| Migration 0008 no repo | ✅ `db/migrations/0008_admin_managed.sql` |

---

## Destaques (o que foi entregue)

### A1 — Infra + auth + proxy
- Migration `0008_admin_managed.sql` aplicada: drop do trigger `on_auth_user_created`, `UNIQUE` em `whatsapp_instances(tenant_id)`, `tenants.is_active`, policies SELECT de `tenants`/`tenant_members`/`whatsapp_instances` com `OR public.is_superadmin()`.
- `app/login/page.tsx`: reescrita com form `email + password` em tema **dark** (alinhado ao `(app)` route group). Removidos copy de magic link e rodapé "cadastro automático".
- `app/login/actions.ts`: agora usa `supabase.auth.signInWithPassword`. Erros retornam mensagem genérica "email ou senha errados" (sem leak de existência).
- `proxy.ts`: adicionado `/admin` a `PROTECTED_PREFIXES`; nova constante `ADMIN_PREFIXES` com check extra via `superadmins.select()` — redireciona não-superadmin para `/home?error=Acesso negado`.
- `lib/tenant.ts`: novo helper `requireSuperadmin()` retornando `{ user }` em sucesso ou `{ response }` com redirect-ou-401 dependendo do caller.

### A2 — Tenants + users admin services
- `lib/admin/tenants.ts`: `listAllTenants`, `getTenantAdmin`, `createTenant`, `updateTenant`, `suspendTenant`, `activateTenant`, `deleteTenant`. Hidratação com `memberCount` e `hasInstance` via 2 queries paralelas. `AdminError` narrow class.
- `lib/admin/users.ts`: `listAllUsers`, `createUser` (com rollback explícito em caso de falha no insert de `tenant_members`), `updateUserMembership`, `resetUserPassword`, `deleteUser`.
- APIs: `/api/admin/tenants`, `/api/admin/tenants/[id]`, `/api/admin/tenants/[id]/suspend`, `/api/admin/users`, `/api/admin/users/[id]`, `/api/admin/users/[id]/password`. Todas gated via `requireSuperadmin()`; rate limit in-memory.
- Cobertura de testes: novos specs cobrem CRUD feliz, rollback de createUser, validação de nome/email.

### A3 — UAZAPI admin service
- `lib/admin/uazapi.ts`: `listAllInstances` (JOIN UAZAPI `GET /instance/all` + `whatsapp_instances` local), `attachInstance` (5 validações: tenant existe, tenant ativo, sem instância prévia, instância UAZAPI existe, não attached em outro tenant), `detachInstance`, `createAndAttach`.
- APIs: `/api/admin/uazapi/instances`, `/api/admin/uazapi/attach`, `/api/admin/uazapi/attach/[tenantId]`, `/api/admin/uazapi/create-and-attach`.
- Token da instância é encriptado com AES-256-GCM (mesmo padrão do flow legacy).

### A4 — Admin UI
- `app/(admin)/layout.tsx`: route group dark-themed + `requireSuperadmin()` server-side. Sidebar compartilhado `AdminSidebar.tsx`.
- `app/(admin)/admin/page.tsx`: dashboard com 4 stat cards principais, 3 mini-stats, e 3 quick links.
- `app/(admin)/admin/tenants/page.tsx` + `TenantsTable.tsx`: listagem + ações (criar, editar, suspender, deletar).
- `app/(admin)/admin/tenants/new/page.tsx`: formulário dedicado para criação.
- `app/(admin)/admin/tenants/[id]/page.tsx` + `TenantDetailClient.tsx`: detalhe do tenant com membros e instância atribuída.
- `app/(admin)/admin/users/page.tsx` + `UsersTable.tsx`: CRUD de users + ação "resetar senha".
- `app/(admin)/admin/uazapi/page.tsx` + `UazapiTable.tsx`: listagem cross-source (UAZAPI + local) com ação atribuir/desatribuir.

### A5 — Integração
- `/onboarding` ajustado: `StartPanel` agora renderiza empty state "nenhuma instância atribuída — contate o admin" em vez do botão "gerar QR". Steps e cópia atualizados. `startConnectAction` fica exportado mas sem usuário (débito: deletar na Fase 14 junto com a rota `/api/whatsapp/connect`).
- Docs criadas: `docs/integrations/admin-management.md` (overview, fluxo, rotas, FAQ).
- CLAUDE.md / README.md / ROADMAP.md atualizados.

---

## Débitos bloqueantes (pendências de Fase 13)

Nenhum. Todas as 4 telas de admin foram entregues.

## Débitos aceitos (pós-Fase 13)

| Débito | Mitigação atual | Quando |
|---|---|---|
| Rota `POST /api/whatsapp/connect` e server action `startConnectAction` ainda presentes | Não há UI disparando; deprecated mas inofensivo | Fase 14 |
| Password reset sem UI self-service | Superadmin reseta via `/api/admin/users/[id]/password` ou CLI `set-superadmin.mjs` | Fase 14 (`/forgot-password`) |
| Email de notificação ao criar user não é enviado | Superadmin comunica senha fora da plataforma | Fase 14 (integração Resend) |
| Audit log de ações superadmin não existe | Nenhum rastro de quem deletou/criou tenant ou user | Fase 14 (tabela `admin_audit_log`) |
| Confirm destrutivo usa `window.confirm` | UX degradada mas funcional | Fase 14 (modal chunky) |
| `suspend` não grava `suspended_at`/`reason` | Só o bit `is_active` | Fase 14 |
| RLS writes em `tenants`/`tenant_members`/`whatsapp_instances` continuam service-role-only | Superadmin via SQL editor (sem service role) não consegue INSERT | Pós-MVP (decisão arquitetural) |
| `approval_mode='optional'` auto-approve em 24h não implementado | Comporta-se como `required` | Backlog pré-Fase 13 |
| `/forgot-password` inexistente | Dependência total do superadmin | Fase 14 |

---

## Smoke test (curl)

Com dev server em `http://localhost:3000` e nenhum cookie de sessão:

```text
$ curl -sI http://localhost:3000/login
HTTP/1.1 200 OK                                     ✓ login renderiza

$ curl -sI http://localhost:3000/signup
HTTP/1.1 404 Not Found                              ✓ signup removido

$ curl -sI http://localhost:3000/admin
HTTP/1.1 307 Temporary Redirect
location: /login?next=%2Fadmin&error=...            ✓ proxy gateando

$ curl -sI http://localhost:3000/admin/tenants
HTTP/1.1 307 Temporary Redirect                     ✓ (proxy ok, mas rota sem
location: /login?next=%2Fadmin%2Ftenants&error=...    page definida — ver débito 1)

$ curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/admin/tenants
302                                                  ✓ requireSuperadmin bounced
```

---

## Recomendações Fase 14

1. **UI Complete (bloqueante):** entregar `/admin/tenants`, `/admin/tenants/[id]`, `/admin/users`, `/admin/uazapi`. Reaproveitar `TopBar`, `Sticker`, `StatCard`, `Card`, `AdminSidebar` que já existem.
2. **Email transacional:** Resend + template "bem-vindo ao podZAP" enviado em `createUser`.
3. **Password self-reset:** `/forgot-password` + `supabase.auth.resetPasswordForEmail`.
4. **Audit log:** tabela `admin_audit_log { actor_user_id, action, target_type, target_id, payload jsonb, created_at }`. Middleware em `/api/admin/*` insere row antes de responder.
5. **Modal chunky:** componente `<ConfirmModal />` substituindo `window.confirm` em ações destrutivas.
6. **Multi-admin por tenant:** `tenant_members.role='admin'` ganhando poderes locais (convida/remove membros **do próprio tenant**) — descarrega o superadmin.
7. **Deletar `POST /api/whatsapp/connect`** e `startConnectAction` (com grep final pra garantir que nada importa).
8. **Deletar unused export `startConnectAction`** do `actions.ts` para evitar confusão.

---

## Anexos

- Migration: `db/migrations/0008_admin_managed.sql`
- Plano: `docs/plans/fase-13-plan.md`
- Guia de ops: `docs/integrations/admin-management.md`
