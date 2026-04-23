# Superadmin — cross-tenant admin capability

Introduzido na **Fase 12** (2026-04-22). Referência: `db/migrations/0007_superadmin.sql`, `scripts/set-superadmin.mjs`.

## O que é (e o que NÃO é)

**Superadmin** é uma capability **cross-tenant** — um bit global, não um papel dentro de um tenant. Um usuário marcado como superadmin é "operador da plataforma podZAP", distinto do `owner` de cada tenant (que segue existindo em `tenant_members.role`).

- **Superadmin** ≈ staff da podZAP, pode operar qualquer tenant (via policies RLS que consultem `is_superadmin()`, ou via scripts rodando com `service_role`).
- **Owner** ≈ dono de um tenant específico, gerencia aquele tenant via `tenant_members.role='owner'`.

Um superadmin **não substitui** nem vira owner automaticamente. Se o superadmin precisa aparecer como membro de algum tenant, ele precisa ser convidado / adicionado em `tenant_members` como qualquer outro.

## Modelo de dados

```sql
create table public.superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null,
  note text
);
```

RLS ativo. Policy única: `superadmins_read_self` — um authenticated user consegue apenas ver a própria row (se existir). Escrita é **service_role only** — não há policy pra `insert/update/delete` em `to authenticated`, então o cliente browser nunca consegue promover/demover.

Helper SQL:

```sql
create or replace function public.is_superadmin()
  returns boolean
  language sql stable security definer set search_path = ''
  as $$ select exists(select 1 from public.superadmins where user_id = (select auth.uid())) $$;
```

`security definer` + `search_path=''` segue o mesmo padrão de `public.current_tenant_ids()` em `0002_fixes.sql` — evita que um esquema hostil no search_path da sessão hijacke a função.

## Como promover alguém

Script pronto: `scripts/set-superadmin.mjs`. Precisa de 4 envs:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (pra Admin API — lookup user + update password)
- `SUPABASE_ACCESS_TOKEN` (pra Management API — insert na tabela)
- `SUPABASE_PROJECT_REF`

Todas já presentes em `.env.local` (mesmas usadas por `scripts/db-query.mjs`).

### Cenário típico — promover + setar senha inicial

```bash
node --env-file=.env.local scripts/set-superadmin.mjs fulano@example.com --password "SenhaForte123!"
```

O script faz 3 passos:

1. **Lookup** — `GET /auth/v1/admin/users?email=…`. O user precisa **já existir** (ter feito login pelo menos uma vez via `/login`, ou ter sido criado via admin API previamente).
2. **Password update** (opcional, se `--password` presente) — `PUT /auth/v1/admin/users/:id` com `{ password, email_confirm: true }`. O `email_confirm` garante que magic links preexistentes sejam invalidados e o user possa logar direto com senha via `signInWithPassword`.
3. **Superadmin insert** — SQL via Management API: `insert into superadmins(user_id, note) values (…) on conflict (user_id) do update set note = excluded.note`. Idempotente — rodar o script duas vezes não erra.

Saída esperada:

```
Found user fulano@example.com (uuid-...)
Password updated (email_confirm: true)
OK  fulano@example.com is superadmin.
```

### Só promover (sem mexer em senha)

```bash
node --env-file=.env.local scripts/set-superadmin.mjs fulano@example.com --note "beta operator"
```

### Verificar manualmente

```sql
select u.email, s.granted_at, s.note
from public.superadmins s
join auth.users u on u.id = s.user_id
order by s.granted_at desc;
```

Ou pela UI client-side depois (ainda TODO):

```ts
const { data } = await supabase.from('superadmins').select('user_id').maybeSingle();
const isSuperadmin = data !== null;
```

Isso funciona porque a policy `superadmins_read_self` permite o self-select.

## Como usar em RLS (futuro)

A helper `public.is_superadmin()` existe mas **ainda não está referenciada em policy nenhuma**. A intenção é expandir policies selecionadas pra permitir cross-tenant visibility:

### Exemplo (hipotético — ainda não aplicado)

```sql
-- Hoje em 0002_fixes.sql:
create policy tenants_select on public.tenants
  for select to authenticated
  using (id in (select tenant_id from public.tenant_members where user_id = (select auth.uid())));

-- Versão expandida pra superadmin:
create policy tenants_select on public.tenants
  for select to authenticated
  using (
    id in (select tenant_id from public.tenant_members where user_id = (select auth.uid()))
    or public.is_superadmin()
  );
```

### Candidatas óbvias a expandir

- `tenants` — admin panel lista todos os tenants
- `whatsapp_instances` — debug de conexão cross-tenant
- `summaries` — ver qualquer resumo pra diagnosticar pipeline
- `audios` — idem
- `ai_calls` — dashboard de custo agregado (todos os tenants)
- `messages` — inspeção de captura com cuidado LGPD (ver nota abaixo)

### Cuidado LGPD / privacidade

Expandir RLS para superadmin em `messages` / `transcripts` dá acesso a conteúdo privado de WhatsApp de qualquer tenant. Antes de fazer isso:

1. Definir política formal de "acesso de operador" nos Termos do tenant.
2. Logar todos os acessos superadmin em uma tabela de auditoria (`audit_log` — não existe ainda).
3. Considerar se o superadmin **deveria** ter esse acesso direto, ou apenas ver metadados (contagens, erros, custos) sem o conteúdo.

Recomendação MVP: **começar apenas por `tenants`, `whatsapp_instances`, `ai_calls`, `schedules`** (metadados) e manter `messages`/`transcripts`/`summaries` restritos por tenant até ter o audit log.

## Trilha pro admin panel

Quando existir `/admin` (pós-MVP):

1. Layout separado em `app/(admin)/layout.tsx` com check `isSuperadmin()` server-side — redireciona pra `/home` se falso.
2. Páginas iniciais: `/admin/tenants` (lista), `/admin/tenants/[id]` (overview), `/admin/usage` (agg de `ai_calls`).
3. Nenhum client-side trust — todo write passa por route handler que chama `createAdminClient()` **depois** de revalidar `isSuperadmin` no server.

## FAQ

**Pode ter múltiplos superadmins?** Sim — a tabela é `user_id` como PK, qualquer número de rows.

**Como remover?** `delete from public.superadmins where user_id = '...';` (via script ou Management API). Não há script pronto — adicionar se virar rotina.

**O que acontece se o user for deletado em `auth.users`?** `on delete cascade` na FK limpa a row em `superadmins` automaticamente.

**Dá pra promover o próprio usuário que roda o script?** Sim — o script não verifica caller, só o target email. O `service_role` key dá privilégio total.

**Como testar RLS policies que usam `is_superadmin()`?** Fazer login como o superadmin no browser, rodar a query real. Alternativamente, num teste E2E, usar `supabase.auth.setSession(...)` com um JWT do usuário em questão.
