# Auditoria — Fase 1 (Auth + Multi-tenancy)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22. Commit: pendente antes deste audit.

## Veredito geral

**PASS.** Os 2 bloqueadores herdados da Fase 0 foram fechados. RLS validada E2E com 8 testes passando. Fluxo de login renderiza com design system consistente. Trigger de bootstrap de tenant funciona.

---

## ✅ Checks executados

| Check | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ exit 0 |
| Testes RLS | `npm test` | ✅ 8/8 em 4.5s |
| Build produção | `npm run build` | ✅ 7 rotas, compilado sem warnings |
| Smoke `/home` sem auth | Playwright GET | ✅ redireciona `/login?next=/home&error=...` |
| Smoke `/login` renderiza | Playwright | ✅ design chunky, banner de erro, input pill, botão purple |
| Schema aplicado | `scripts/db-query.mjs` | ✅ trigger `on_auth_user_created`, constraint composta em `messages`, função `current_tenant_ids` |

Screenshots em `docs/audits/screenshots/fase-1-login.png`.

---

## 🔴 Bloqueadores fechados da Fase 0

1. ✅ **`tenants_insert` RLS frouxa** → policy removida, criação só via trigger `handle_new_user`
2. ✅ **`messages.uazapi_message_id` UNIQUE global** → trocado por `UNIQUE (tenant_id, uazapi_message_id)`

## 🟡 Débitos fechados da Fase 0

- ✅ `set_updated_at()` recriada com `security definer` + `search_path = ''`
- ✅ RLS recursiva substituída por `public.current_tenant_ids()` (helper `security definer`)
- ✅ `types.ts` placeholder → tipos gerados via Management API (19.7 KB)
- ✅ Índices faltantes: `messages(group_id, type, captured_at desc)` + partial em `audios`
- ✅ `/health` mapeamento de erro (tratado em contexto mais amplo agora)

## 🟡 Débitos fechados pelo libuv fix

- ✅ Windows `UV_HANDLE_CLOSING` em scripts Node → `Connection: close` + `process.exitCode`

---

## 🟡 Novos débitos (entram em backlog)

1. **Convites/membros adicionais** — Fase 1 assume 1 tenant por user (o criado no signup). Precisa de RPC `accept_invite` + tela de convite. Bloqueia multi-admin e colaboração. Ficará na Fase 3 ou Pós-MVP.
2. **Email real de magic link não testado E2E** — a ação `signInWithOtp` executa no servidor mas o clique no email não foi automatizado. Precisa Mailpit/Inbucket ou Supabase `emailRedirectTo` mock. Baixa prioridade — Supabase é terceiro confiável.
3. **Sidebar ainda não mostra grupos reais** — `plan card` usa hardcode `15 resumos`. Vai ser atualizado quando `plans` real existir (futuro tier).
4. **`app/(app)/home/page.tsx` tem placeholders para rotas futuras** (`/onboarding`, `/groups`). 404 até Fase 2/3.
5. **Matcher do proxy ainda não exclui `/api/inngest`** (só `/api/webhooks`). Lembrar quando chegar a Fase 5.
6. **`@import` de Google Fonts** em `globals.css` — troca por `next/font` pode ficar para Fase 11 (polish).
7. **Rate limit OTP padrão do Supabase (30/hora)** — OK em dev, aumentar em prod.

---

## 🟢 Pontos fortes

- **`proxy.ts` belt-and-suspenders**: redirect enforcement em 2 camadas (edge + layout). Bem documentado.
- **`current_tenant_ids()` helper** evita a recursão de RLS, é `stable` e `security definer` — correto e rápido.
- **`handle_new_user`** usa fallback em cadeia (`full_name → email local-part → 'My workspace'`) — resiliente.
- **Callback PKCE** valida `?next=` só se começar com `/` (previne open-redirect).
- **Testes RLS cobrem 4 tabelas principais** (tenants, whatsapp_instances, groups, messages) em 8 cenários incluindo negativa (insert em tenant alheio).
- **Scripts idempotentes** (`db-query`, `configure-auth`, `gen-types`, `setup-supabase.sh`) com env isolado.
- **Teardown dos testes limpo** — 0 usuários/tenants residuais confirmado por introspecção.

---

## 📋 Checklist detalhado

### Auth
- [x] `/login` renderiza com design consistente
- [x] `/login` exibe `?error=` e `?message=` como banners
- [x] `/login` redireciona autenticados para `/home` (código confirma via `getCurrentUserAndTenant`)
- [x] Server action `loginAction` chama `signInWithOtp` com `emailRedirectTo` dinâmico
- [x] `/auth/callback` faz `exchangeCodeForSession` + honra `?next=` relativo
- [x] `/logout` destrói sessão
- [ ] Fluxo end-to-end com email real (manual ou via Mailpit) — **não testado, ok deferir**

### Auth enforcement
- [x] Proxy redireciona rotas protegidas
- [x] Layout `(app)` re-valida (defesa em profundidade)
- [x] Rotas públicas (`/`, `/login`, `/auth/*`, `/logout`, `/health`) não são afetadas

### Multi-tenancy
- [x] Trigger cria tenant + membership no signup
- [x] `tenants_insert` rejeita inserts diretos
- [x] RLS cobre todas as 9 tabelas
- [x] Helper `current_tenant_ids()` usado consistentemente

### Qualidade
- [x] Typecheck
- [x] Build
- [x] RLS E2E (8 testes)
- [ ] Testes unitários de server actions (backlog)

---

## Recomendações para Fase 2

1. **Primeiro**: fazer login real end-to-end uma vez (manual, você clicando no email) para validar que o Supabase está enviando magic links e redirecionando para `/home`. Se quebrar, diagnóstico rápido via `?error=` query.
2. **Fase 2** deve começar com `app/(app)/onboarding/page.tsx` — QR code + polling de status UAZAPI. Já tem cliente UAZAPI (`lib/uazapi/client.ts`) + tipos zod prontos.
3. **UAZAPI tem 2 endpoints marcados "OPEN QUESTION"** no `docs/integrations/uazapi.md` (`createInstance`, `deleteInstance`). Primeiro ato da Fase 2: teste live + descobrir os paths reais.
4. Inngest **ainda não configurado** — Fase 2 usa polling (cliente → servidor a cada 2s) pra QR status. Inngest entra na Fase 4 (webhook handler).
