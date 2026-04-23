# Fase 1 — Auth + Multi-tenancy

**Objetivo:** login funcional, usuário vinculado a tenant via convite/bootstrap controlado, RLS bloqueando acesso cruzado (validado E2E).

**Pré-condição:** migration `0001_init.sql` aplicada no Supabase (responsabilidade do usuário — via SQL Editor ou `supabase db push`).

**Débitos herdados da Fase 0** (entram como tarefas desta fase):

- 🔴 **Bloqueador Fase 0 #1**: `tenants_insert` RLS é frouxa — qualquer usuário cria tenants ilimitadamente. Fix: remover insert direto, usar trigger `handle_new_user` que cria 1 tenant por signup, e uma RPC `accept_invite` para segundo+ tenants.
- 🔴 **Bloqueador Fase 0 #2**: `messages.uazapi_message_id UNIQUE` global → trocar para `UNIQUE (tenant_id, uazapi_message_id)`. Não bloqueia Fase 1 mas entra na mesma migration `0002_fixes.sql`.
- 🟡 `lib/supabase/types.ts` placeholder — rodar `supabase gen types typescript` gerar tipos reais.
- 🟡 `set_updated_at()` sem `security definer` + `search_path` fixo.
- 🟡 RLS recursiva em `tenant_members_select` — trocar por função `security definer`.
- 🟡 `/health` tratar `PGRST205` (além de `42P01`).
- 🟡 Favicon.ico 404 no console.

---

## Arquitetura de auth

### Fluxo escolhido: **magic link (email) + auto-tenant no primeiro signup**

Por quê:
- Sem senha = menos superfície.
- Supabase nativo suporta OTP/magic link fora da caixa.
- Primeiro login de um email → trigger cria tenant + `tenant_members(role=owner)`.
- Convites futuros via tabela `invites` (fora de escopo da Fase 1, fica em backlog).

### Rotas a criar

| Rota | Tipo | Propósito |
|---|---|---|
| `/login` | Server component | Formulário de email + envio do magic link |
| `/auth/callback` | Route handler | Troca o `code` da URL por sessão (PKCE) |
| `/auth/confirm` | Route handler (opcional) | Confirma OTP via link de email |
| `/logout` | Route handler | Destrói sessão |
| `/(app)/*` | Layout protegido | Redireciona pra `/login` se não autenticado |
| `/(app)/home` | Tela | Landing autenticada (usará `screen_home.jsx` como referência) |

### Proxy / RLS

- `proxy.ts` já faz `supabase.auth.getUser()` — OK.
- Adicionar redirect: se `user == null` e rota começa com `/(app)` ou `/home`, redireciona pra `/login`.
- RLS isolada via `tenant_id in (select tenant_id from tenant_members where user_id = auth.uid())`.

---

## Tarefas (para os 5 agentes)

### Agente 1 — Migration `0002_fixes.sql` + types.ts

- Criar `db/migrations/0002_fixes.sql` com:
  - Remover policy `tenants_insert` (qualquer INSERT direto bloqueado).
  - Função `handle_new_user()` + trigger em `auth.users`: cria `tenants(name=email)` + `tenant_members(role=owner)`.
  - Trocar `messages.uazapi_message_id UNIQUE` → `UNIQUE (tenant_id, uazapi_message_id)`.
  - Recriar `set_updated_at()` com `security definer` + `set search_path = ''`.
  - Trocar `tenant_members_select` por função `security definer current_tenant_ids()`.
  - Tratar `PGRST205` em `app/health/page.tsx`.
- Após aplicar: rodar `npx supabase gen types typescript --project-id vqrqygyfsrjpzkaxjleo > lib/supabase/types.ts`. Se CLI não tiver acesso, pegar via dashboard SQL e salvar manualmente.

### Agente 2 — Páginas de auth (`/login`, `/auth/callback`, `/logout`)

- `/login` — server component, form action que chama `signInWithOtp`.
  - Design: card chunky, input estiloso, botão purple "enviar link mágico". Aproveitar `.btn`, `.card`, `.sticker`.
- `/auth/callback/route.ts` — exchange PKCE code → session → redirect `/home`.
- `/logout/route.ts` — `supabase.auth.signOut()` → redirect `/login`.
- Lida com query `?error=` do Supabase e mostra mensagem amigável.

### Agente 3 — Layout autenticado `/(app)/` + Sidebar conectada

- Criar route group `app/(app)/layout.tsx` com:
  - `getUser()` server-side; se null, `redirect('/login')`.
  - `<Sidebar>` (já existe em `components/shell/`) + `<main>`.
- `/(app)/home/page.tsx` — landing autenticada simples (bem-vindo, nome do tenant, CTA conectar zap).
- Atualizar `proxy.ts`: após `getUser`, se não autenticado e rota for `/(app)` → redirect `/login`.
- Hook `useTenant()` client + util `getCurrentTenant()` server.

### Agente 4 — Testes E2E de RLS (Vitest + Supabase client)

- Instalar `vitest` + `@testing-library/react` (opcional).
- Suite `tests/rls.spec.ts`:
  - Cria 2 users (A e B) via service-role (bypassa RLS pra setup).
  - Assert: user A criou tenant T1 automaticamente via trigger; user B → T2.
  - Com client-side como user A, inserir `groups` em T1 → funciona.
  - Tentar select/insert em T2 como user A → falha/retorna 0 linhas.
  - Cenário inverso também.
  - Matar os users no teardown.
- Script `npm run test:rls` no `package.json`.

### Agente 5 — Supabase CLI setup + documentação

- `npx supabase init` se ainda não houver.
- `npx supabase link --project-ref vqrqygyfsrjpzkaxjleo` (usando `SUPABASE_ACCESS_TOKEN`).
- Documentar em `db/README.md` o fluxo completo:
  - Como aplicar `0001_init.sql` (se ainda não aplicado)
  - Como aplicar `0002_fixes.sql`
  - Como regenerar types
  - Troubleshooting (erros comuns)
- Criar `docs/integrations/supabase-auth.md` explicando o fluxo de magic link + redirect URLs (⚠️ `http://localhost:3001` e `http://localhost:3000` devem estar em "Redirect URLs" no painel Supabase).
- Criar script `scripts/setup-supabase.sh` idempotente (para onboarding de dev novo).

---

## Critério de aceite (Nyquist)

- [ ] Build passa (`npm run build`)
- [ ] Typecheck passa (`npm run typecheck`)
- [ ] Smoke Playwright:
  - [ ] `/` abre (landing pública)
  - [ ] `/login` abre
  - [ ] Submit email → recebe feedback "link enviado" (não vamos validar email real no teste; mockar ou clicar no link manualmente uma vez)
  - [ ] Após login, `/home` abre e mostra email do user
  - [ ] `/logout` funciona
- [ ] Teste RLS E2E passa: 2 users em tenants diferentes não se enxergam.
- [ ] Audit RLS no Supabase Dashboard → "RLS on" em todas as 9 tabelas.
- [ ] Commit + push.
- [ ] `AUDIT-fase-1.md` + screenshots.

## Riscos

- **Redirect URLs no Supabase**: se não configurar `http://localhost:3001` como redirect válido, magic link falha. Vou pedir pro usuário confirmar antes de executar.
- **Email real para magic link em dev**: Supabase envia email de verdade. Em dev, usar Inbucket/Mailpit local opcional; por agora, usamos email real do usuário.
- **Trigger em `auth.users`**: requires `security definer`. Erro comum de permissão — vou testar cuidadosamente.

---

## Ordem de execução

1. **Pré**: usuário aplica `0001_init.sql` no Supabase (ou autoriza agente 5 a fazer).
2. **Agente 1 primeiro** (isolado) — precisa aplicar `0002_fixes.sql` antes dos outros rodarem.
3. **Agentes 2, 3, 4, 5 em paralelo** após agente 1 terminar.
4. **Orquestrador**: integra, fix type errors se houver, roda build + testes + Playwright.
5. **Audit + doc.**
