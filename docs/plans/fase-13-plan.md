# Fase 13 — Admin-managed (Switch from self-service)

**Origem:** usuário confirmou modelo B2B enterprise: superadmin é o único admin, cadastra tenants + usuários + atribui instâncias UAZAPI. Sem signup público. Login com senha obrigatório.

## O que muda em relação ao que está

| Hoje | Novo |
|---|---|
| Magic link no login | Email+senha (remove magic link) |
| Trigger `handle_new_user` cria tenant auto | Trigger removido; tenant criado manualmente |
| Qualquer email faz signup | Sem signup público |
| 0..1 instância UAZAPI por tenant (implícito) | Constraint UNIQUE(tenant_id) — 1:1 tenant↔instância |
| UAZAPI instância criada via `/onboarding` | Superadmin atribui instâncias existentes da UAZAPI a tenants |
| Sidebar sem área admin | Área `/admin/*` gated por `is_superadmin()` |

## Schema

### Migration `0008_admin_managed.sql`

```sql
-- F13: switch to admin-managed tenancy

-- 1. Drop auto-create trigger + function (signup não cria mais tenant)
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- 2. Enforce 1:1 tenant↔UAZAPI instance
-- (Hoje não há UNIQUE(tenant_id); existe UNIQUE (tenant_id, uazapi_instance_id) composto
-- Mas uma row por tenant é a regra do MVP admin-managed.)
create unique index if not exists uniq_whatsapp_instances_tenant
  on public.whatsapp_instances(tenant_id);

-- 3. Expandir policies pra dar visibilidade cross-tenant ao superadmin
-- (Padrão: adicionar `OR public.is_superadmin()` nas policies de SELECT das tabelas-chave)

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants
  for select to authenticated
  using (id in (select public.current_tenant_ids()) OR public.is_superadmin());

drop policy if exists tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) OR public.is_superadmin());

drop policy if exists whatsapp_instances_select on public.whatsapp_instances;
create policy whatsapp_instances_select on public.whatsapp_instances
  for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()) OR public.is_superadmin());

-- Writes continuam sendo service-role (scripts/APIs do admin usam service role).
-- Não abrimos WRITE policies pra superadmin direto via session — mantém audit trail
-- via logs de quem chamou qual endpoint admin.
```

Aplicar live + regen types + verificar.

## Código

### A1 (sequencial) — Migration + login senha + proxy + landing

1. Aplicar `0008_admin_managed.sql` via script
2. Remover trigger/função confirmado via introspection
3. **Login redesign** `app/login/page.tsx` + `actions.ts`:
   - Form: email + password (type=password)
   - Action chama `supabase.auth.signInWithPassword({ email, password })`
   - Remove magic link. Remove subtitle "a gente te manda um link mágico". Novo subtitle: "use seu email e senha corporativos"
   - Erro 400 → "email ou senha errados" (genérico — não leak se email existe)
   - Mesmo visual chunky, mas dark (pra consistência com `/(app)/*`)
   - Remove footer "cadastro automático no primeiro login"
4. **Landing `app/page.tsx`**: mantém mas ajusta subtítulo pra refletir modelo ("acesso por convite" ou tira o texto de cadastro livre)
5. **proxy.ts**: adicionar `/admin` aos `PROTECTED_PREFIXES` + fazer check extra `is_superadmin()` via RPC (ou deferir pro layout — decisão do A1)
6. Deletar/404 `/signup` se existir
7. Regen types
8. typecheck + tests + build devem passar

### A2 — Admin service + API (tenants + users)

`lib/admin/service.ts`:
```ts
export type TenantAdminView = {
  id: string; name: string; plan: string;
  memberCount: number; hasInstance: boolean;
  createdAt: string;
};

export type UserAdminView = {
  id: string; email: string; createdAt: string;
  tenants: Array<{ tenantId: string; tenantName: string; role: 'owner' | 'admin' | 'member' }>;
  isSuperadmin: boolean;
};

export async function listAllTenants(): Promise<TenantAdminView[]>
export async function getTenant(id: string): Promise<TenantAdminView | null>
export async function createTenant(input: { name: string; plan?: string }): Promise<TenantAdminView>
export async function updateTenant(id: string, patch: { name?: string; plan?: string }): Promise<TenantAdminView>
export async function deleteTenant(id: string): Promise<void>

export async function listAllUsers(): Promise<UserAdminView[]>
export async function createUser(input: { email: string; password: string; tenantId: string; role?: 'owner'|'admin'|'member'; isSuperadmin?: boolean }): Promise<UserAdminView>
export async function updateUserMembership(userId: string, tenantId: string, role: 'owner'|'admin'|'member'): Promise<UserAdminView>
export async function deleteUser(userId: string): Promise<void>
```

Todas usam service role admin client. `createUser` chama `supabase.auth.admin.createUser({ email, password, email_confirm: true })` + insert em `tenant_members`.

API routes:
- `GET/POST /api/admin/tenants`
- `GET/PATCH/DELETE /api/admin/tenants/[id]`
- `GET/POST /api/admin/users`
- `PATCH/DELETE /api/admin/users/[id]`

Gated por `requireSuperadmin()` helper em `lib/tenant.ts` (novo). Rate limit 30/min/user.

Tests: mock admin client + crypto.

### A3 — UAZAPI admin service + API

`lib/admin/uazapi.ts`:
```ts
export type UazapiInstanceAdminView = {
  // UAZAPI source
  uazapiInstanceId: string;
  name: string;
  status: 'connected' | 'connecting' | 'disconnected';
  phone: string | null;
  createdAt: string;
  // Local attachment
  attachedTenantId: string | null;
  attachedTenantName: string | null;
  localInstanceId: string | null;   // whatsapp_instances.id if attached
};

export async function listAllInstances(): Promise<UazapiInstanceAdminView[]>
// Full join: UAZAPI API (admintoken) + local whatsapp_instances

export async function attachInstance(uazapiInstanceId: string, tenantId: string): Promise<UazapiInstanceAdminView>
// Validate: tenant has no instance yet (UNIQUE), UAZAPI instance exists, not already attached
// Fetch instance token from UAZAPI listAll response
// Encrypt token, insert whatsapp_instances row

export async function detachInstance(tenantId: string): Promise<void>
// Delete whatsapp_instances row (cascades groups/messages/etc — warn in UI)

export async function createAndAttach(tenantId: string, name: string): Promise<UazapiInstanceAdminView>
// UazapiClient.createInstance(name) + attachInstance
```

API routes:
- `GET /api/admin/uazapi/instances` → list
- `POST /api/admin/uazapi/attach { uazapiInstanceId, tenantId }`
- `DELETE /api/admin/uazapi/attach/[tenantId]` → detach
- `POST /api/admin/uazapi/create-and-attach { tenantId, name }`

Tests: mock UazapiClient + admin client.

### A4 — Admin UI

Route group `app/(admin)/` com layout protegido:
- `app/(admin)/layout.tsx`: `requireSuperadmin()` server-side (redirect `/login` ou `/home` com erro se não for sa)
- TopBar "Superadmin" com badge distintivo

Páginas:
- `app/(admin)/admin/page.tsx` — dashboard: counts de tenants, users, instâncias UAZAPI (attached/unattached)
- `app/(admin)/admin/tenants/page.tsx` — tabela listTenants + botão "novo tenant" (modal com nome + plano)
- `app/(admin)/admin/tenants/[id]/page.tsx` — detalhe: nome, plano, lista de membros, instância atribuída (se houver), botões editar/deletar
- `app/(admin)/admin/users/page.tsx` — tabela listUsers + botão "novo user" (modal com email + password + tenant select + role)
- `app/(admin)/admin/uazapi/page.tsx` — tabela listAllInstances com filtros (attached/unattached); ação por linha: "atribuir a tenant" (modal dropdown de tenants sem instância) OU "desatribuir" (confirm destrutivo, explica cascade)

Design: dark theme (herda), chunky, stickers pra status (verde=connected/attached, amarelo=connecting, cinza=detached).

Sidebar: adicionar item "Admin" que só aparece se `sidebar props.isSuperadmin === true`. `AppSidebar` fetcha via RPC `is_superadmin()` ou via `fromSuperadmins.select()`.

### A5 — Integração + docs + audit

- Verificar imports resolvem
- Remover SettingsCard refs obsoletas (já foi na F12)
- **Deletar `app/(app)/onboarding/page.tsx`** (ou manter como "fluxo legado" dev-only)? Decisão no audit. Plano: mantém como read-only pra ver status da instância vinculada; não permite mais criar via UI do tenant (superadmin atribui).
- Atualizar:
  - CLAUDE.md: nova seção "Modelo admin-managed" (copiar da memory)
  - README.md: status + modelo
  - ROADMAP.md: Fase 13 ✅
  - docs/integrations/admin-management.md: guia completo (criar tenant, criar user, atribuir instância)
- Audit `docs/audits/fase-13-audit.md`
- Commit + push

## Critério de aceite

- [ ] `/signup` não existe (404)
- [ ] Trigger `on_auth_user_created` não existe no DB
- [ ] Login `/login` com email+senha funciona (george+123456@ entra)
- [ ] Novo user criado via `/admin/users` pode logar direto com email+senha
- [ ] `/admin/tenants` lista, cria, edita, deleta
- [ ] `/admin/users` lista, cria, edita, deleta
- [ ] `/admin/uazapi` lista instâncias (todas da API UAZAPI) + indica tenant atribuído
- [ ] Atribuir instância a tenant funciona + persiste em `whatsapp_instances`
- [ ] Desatribuir funciona
- [ ] User normal (não-sa) que tenta acessar `/admin/*` → redirect
- [ ] typecheck + tests + build clean
- [ ] Audit + commit + push

## Riscos

- **Deletar tenant cascateia** muito (messages/summaries/audios/groups). UI precisa confirm forte.
- **Desatribuir instância** deleta whatsapp_instances row — cascade no groups e relatadas. Idem aviso na UI.
- **Senha em plain text no POST** — usar HTTPS em prod. Em dev localhost. Nunca logar.
- **`supabase.auth.admin.createUser` sem email_confirm** deixa user em estado `unconfirmed`. Passar `email_confirm: true` sempre.
- **Erros de `updateUserMembership`** se user já tá em outro tenant — decisão: permitir múltiplos tenants por user (`tenant_members` é M2M) ou enforced 1:1? Default do projeto: M2M, mas UI simplifica pra 1. Documentar.

## Ordem

A1 sequencial → A2, A3, A4, A5 em paralelo.

---

# Auto-audit

## O que tá bom
- A1 é claramente sequencial — muda infra (trigger, login, proxy) que os outros dependem.
- A2 + A3 + A4 podem paralelizar com contratos TS precisos.
- Critério de aceite cobre fluxo completo (superadmin logar → criar tenant → criar user → user logar).

## Riscos do plano não cobertos

### 1. Como o admin UI autentica chamadas service-role?
Os endpoints `/api/admin/*` são HTTP com session cookie (authenticated user). Eles precisam verificar `is_superadmin()` na sessão E usar service role internamente pra escrever. Solução: `requireSuperadmin()` em `lib/tenant.ts` retorna `{ user, tenant } | redirect`, então rota usa `createAdminClient()` (service role) por baixo. **Plano ok, só explicitar.**

### 2. Remover magic link quebra recuperação de senha
Se user esquece senha, hoje não tem nada. Precisa:
- `/forgot-password` pedindo email → superadmin gera nova senha via `/admin/users` (simplest) OU 
- password reset flow (Supabase suporta via `auth.admin.generateLink({ type: 'recovery' })` retornando link)

**Mitigação:** Fase 13 não implementa password reset. Superadmin reseta manualmente via `/admin/users/[id]` "reset password". Documentar.

### 3. `onboarding` vira tela vazia
Hoje `/onboarding` é o fluxo do tenant conectar WhatsApp. No novo modelo, só superadmin atribui. Tenant vê só status. **Mitigação:** `/onboarding` vira tela read-only "sua instância está [status]" + link pra contato se detached. A5 implementa.

### 4. RLS write expansion
Plano só expande SELECT. Para criar tenant via `/admin/tenants` POST, o endpoint usa service-role (bypass RLS) — ok. Mas se um dia superadmin quiser usar o Supabase dashboard SQL editor como ele mesmo (sem service role), não consegue INSERT em tenants. **Decisão:** mantém service-role-only writes no MVP. Audit registra.

### 5. `delete tenant` de verdade vs soft-delete
Hard delete cascata em messages/transcripts/summaries/audios/schedules. Se o tenant teve dados, tudo some. Superadmin deve poder "suspender" tenant sem perder dados. **Decisão Fase 13:** hard delete com confirm triplo + backup automático é overkill. Usar soft delete via `tenants.status = 'suspended'` column? Adiciona complexity. **Fase 13 usa hard delete explícito. Doc cita risco.** Opção: adicionar `is_active boolean` em `tenants` em 0008 e UI mostrar "suspender" como alternativa ao delete. Vou adicionar.

### 6. Dark theme no /login
Decidido incluir no A1. Login público mas dark pra consistência.

## Adições ao plano

- A1: adicionar coluna `is_active boolean default true` em `tenants` (migration 0008). UI permite "suspender" (= `is_active=false`) além de "deletar" (hard).
- A2: `suspendTenant(id)` + `activateTenant(id)` service methods.
- A4: ação "suspender" no card de tenant + badge visual.
- A5: doc inclui password reset manual pelo admin + login dark.

## Veredito

**Plano aprovado com 4 adições acima.** Custo ~2-2.5h de agents. Proceder com A1 sequencial.
