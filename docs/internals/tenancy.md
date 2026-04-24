# Tenancy + Supabase clients

Arquivos-fonte:
- [`lib/tenant.ts`](../../lib/tenant.ts)
- [`lib/supabase/server.ts`](../../lib/supabase/server.ts)
- [`lib/supabase/browser.ts`](../../lib/supabase/browser.ts)
- [`lib/supabase/admin.ts`](../../lib/supabase/admin.ts)
- [`lib/supabase/middleware.ts`](../../lib/supabase/middleware.ts)

Relacionado: [`docs/integrations/supabase-auth.md`](../integrations/supabase-auth.md), [`docs/integrations/admin-management.md`](../integrations/admin-management.md), [`docs/integrations/superadmin.md`](../integrations/superadmin.md).

## Os 3 clientes Supabase (+ middleware)

| Client | Fonte | Auth mode | Quando usar |
|---|---|---|---|
| **server** | `@supabase/ssr` `createServerClient` via `cookies()` (`lib/supabase/server.ts:5-29`) | Session JWT do cookie — roda sob RLS como o user autenticado | Server components, Route Handlers, Server Actions — qualquer coisa que precise da identidade do user e queira RLS protegendo dados |
| **browser** | `@supabase/ssr` `createBrowserClient` (`lib/supabase/browser.ts:4-9`) | Session JWT do localStorage — RLS como o user | Componentes client (`'use client'`) — login form, realtime subscriptions |
| **admin** | `@supabase/supabase-js` `createClient` com `SUPABASE_SERVICE_ROLE_KEY` (`lib/supabase/admin.ts:11-22`) | `service_role` — **bypassa RLS** | Webhooks (`/api/webhooks/*`), Inngest workers, admin tooling, best-effort writes (ai-tracking) |
| **middleware** | `createServerClient` via `NextRequest.cookies` (`lib/supabase/middleware.ts:8-25`) | Atualiza cookie de sessão antes de cada request | Apenas `middleware.ts` raiz — nunca em rota |

### Por que 3 clientes e não 1

SSR + RLS + service role são **mutuamente exclusivos**: cada um precisa do seu transport.

- `server` lê cookie via `next/headers` — só existe em contexto server.
- `browser` lê cookie via `document.cookie` + storage — só existe no navegador.
- `admin` **NUNCA pode tocar o browser**. Se `SUPABASE_SERVICE_ROLE_KEY` vaza num bundle client, **qualquer usuário vira root**. O import de `lib/supabase/admin.ts` em arquivo com `'use client'` tem que quebrar o build.

## `getCurrentUserAndTenant()`

Localização: `lib/tenant.ts:35-73`.

```ts
const ctx = await getCurrentUserAndTenant();
if (!ctx) redirect('/login');
const { user, tenant } = ctx; // { id, email } + { id, name, plan, role }
```

**Quando retorna `null`:**
1. Sem sessão (`supabase.auth.getUser()` retornou null).
2. User autenticado mas **sem membership em tenant** (`tenant_members` vazio pra esse `user_id`). Depois da Fase 13 (admin-managed) isso acontece até o superadmin criar o user vinculado a um tenant.

**Primary tenant**: a primeira linha de `tenant_members` (`.limit(1).maybeSingle()`). MVP = 1 tenant por user, então é determinístico. Multi-membership (invites) precisa de resolver — cookie/url param/pref — antes de suportar vários tenants ativos (`lib/tenant.ts:32-34`).

**Usa qual client?** O `server` (`lib/tenant.ts:38`), então a query de `tenant_members` passa por RLS. Policy: user só lê sua própria membership.

## `isSuperadmin(userId)` e `requireSuperadmin()`

Localização: `lib/tenant.ts:84-147`.

- `isSuperadmin(userId)` — usa o **admin client** (bypassa RLS) porque a tabela `superadmins` tem policy só-self e queremos poder responder sem depender da sessão bater com a row. Retorna `false` em qualquer erro (fail-closed).
- `requireSuperadmin()` — guard pra `/admin` server components e rotas `/api/admin/*`. Retorna `{ user, tenant, isSuperadmin: true }` ou `{ response: Response }` com redirect 307. Padrão discriminado:

```ts
const guard = await requireSuperadmin();
if ('response' in guard) return guard.response;
// …seguir com guard.user / guard.tenant
```

Superadmin pode não pertencer a tenant algum — `tenant` é nullable (`lib/tenant.ts:110-111`).

## RLS × cada client

RLS **só protege dados** quando a conexão passa o JWT do user. Tabela-regra:

```
browser  + server   → JWT presente → policies ativas → multi-tenant seguro
admin    → service_role bypass    → policies IGNORADAS → tenant_id é decisão do código
```

Cada INSERT/UPDATE/DELETE feito via admin client tem que incluir `tenant_id` manualmente — RLS não vai filtrar nem negar. Um `admin.from('messages').delete().eq('id', x)` SEM `.eq('tenant_id', y)` é um bug de multi-tenancy.

Padrão defensivo adotado em `lib/stats/service.ts` e `lib/webhooks/persist.ts`: **sempre** incluir `tenant_id` no WHERE, mesmo quando o ID primário já seria único. Belt-and-suspenders: se o ID vazar do tenant errado, a query retorna zero rows em vez de dados alheios.

## Disciplina do admin client (perigos)

1. **Service role key é root.** Bypassa RLS, políticas de storage, e até trigger auth. Tratar como senha root do Postgres.
2. **Nunca em React Client Components.** Se precisa de dados no client, faz fetch para Route Handler que usa o admin client internamente (ou usa o browser client que passa por RLS).
3. **Sempre filtrar por `tenant_id` no where**. Sem exceção.
4. **Preferir o server client quando a sessão cobre o caso.** Só ir de admin quando:
   - Webhook externo sem sessão (`/api/webhooks/uazapi`).
   - Worker Inngest executando out-of-band.
   - Cross-tenant legítimo (admin UI, superadmin, analytics).
   - Best-effort tracking onde RLS mal-configurado não pode derrubar o write primário (`lib/ai-tracking/service.ts:21-22`).

## Testes

- `tests/rls.spec.ts` — verifica policies (owner vê só próprio tenant, superadmin bypass).
- Serviços que consomem admin client (`tests/groups-service.spec.ts`, `tests/schedules-service.spec.ts`, etc.) usam mocks via `vi.mock("@/lib/supabase/admin")`.
- Não há spec dedicado a `getCurrentUserAndTenant` ou `requireSuperadmin` — coberto transitivamente via routes.
