# Admin-managed tenancy (Fase 13)

A partir da Fase 13, o podZAP é **B2B admin-managed**: o superadmin cadastra tenants, convida usuários com senha, e atribui instâncias UAZAPI existentes. Não há mais signup público nem login por magic link.

---

## TL;DR — novo ciclo de onboarding

```
┌──────────────┐   cria tenant   ┌──────────────┐   cria user      ┌──────────────┐
│  Superadmin  │────────────────▶│    Tenant    │─────────────────▶│  Usuário(s)  │
│ (/admin/*)   │                 │ (is_active)  │  (email+senha)   │ (tenant_mem) │
└──────┬───────┘                 └──────┬───────┘                  └──────┬───────┘
       │                                │                                 │
       │ atribui instância UAZAPI       │ 1 instância (UNIQUE)            │ login senha
       ▼                                ▼                                 ▼
┌────────────────────┐         ┌────────────────────┐          ┌───────────────────┐
│ whatsapp_instances │◀────────│     tenants        │          │   /login → /home  │
│  (encrypted token) │         │ name · plan · flag │          │  (session cookie) │
└────────────────────┘         └────────────────────┘          └───────────────────┘
```

---

## 1. Modelo

| Entidade | Antes (MVP 1.0) | Agora (Fase 13) |
|---|---|---|
| Signup | Qualquer email criava tenant via trigger `handle_new_user` | Trigger removido. Superadmin cria tenant + user manualmente. |
| Login | Magic link via email | Email + senha (`signInWithPassword`) |
| Instância UAZAPI | Tenant clicava "gerar QR" em `/onboarding` | Superadmin atribui instância existente (UAZAPI) ao tenant |
| Relação tenant↔instância | `whatsapp_instances.tenant_id` podia ter 0..N rows | **UNIQUE(tenant_id)** — exatamente 1 instância por tenant |
| Suspensão | Hard delete (cascade) ou nada | `tenants.is_active = false` (soft) **ou** hard delete |
| Cross-tenant admin | Ausente | `/admin/*` gated por `public.is_superadmin()` |

Referências de schema:

- `db/migrations/0007_superadmin.sql` — cria `public.superadmins` + helper `is_superadmin()`.
- `db/migrations/0008_admin_managed.sql` — droppa trigger `on_auth_user_created`, adiciona `UNIQUE` em `whatsapp_instances(tenant_id)`, adiciona `tenants.is_active boolean default true`, expande policies SELECT com `OR public.is_superadmin()`.

---

## 2. Fluxo completo (passo-a-passo do superadmin)

### 2.1. Promoção inicial do superadmin

Faz-se **uma vez**, via CLI (o script é idempotente):

```bash
node --env-file=.env.local scripts/set-superadmin.mjs fulano@empresa.com \
  --password 'senha-inicial' --note 'staff podzap'
```

O script cria/atualiza o row em `auth.users` + insere em `public.superadmins`. A partir daqui o email pode logar em `/login` e o proxy `proxy.ts` libera o acesso a `/admin/*`.

### 2.2. Criar tenant

UI: `/admin/tenants` → botão "novo tenant" (modal com `name` + `plan`).

API:
```http
POST /api/admin/tenants
Content-Type: application/json
{ "name": "Acme Corp", "plan": "pro" }
```

Resposta retorna o `TenantAdminView` com `memberCount=0` e `hasInstance=false`.

### 2.3. Criar user vinculado a tenant

UI: `/admin/users` → "novo usuário" (modal com `email` + `password` + `tenantId` + `role`).

API:
```http
POST /api/admin/users
{
  "email": "joao@acme.com",
  "password": "provisional-2026",
  "tenantId": "<uuid>",
  "role": "owner",
  "isSuperadmin": false
}
```

Por baixo: chama `supabase.auth.admin.createUser({ email_confirm: true })` + insere em `tenant_members`. Em caso de falha no insert, o auth user é deletado (rollback explícito em `lib/admin/users.ts`).

### 2.4. Atribuir instância UAZAPI

Fluxo A — a instância **já existe** na UAZAPI (criada manualmente no painel UAZAPI ou via script):

1. `/admin/uazapi` lista todas as instâncias UAZAPI (`GET /api/admin/uazapi/instances`), fazendo JOIN com `whatsapp_instances` local para marcar quais já estão attached.
2. Clicar "atribuir a tenant" numa linha unattached → modal com dropdown dos tenants sem instância.
3. `POST /api/admin/uazapi/attach { uazapiInstanceId, tenantId }`.
4. O service (`lib/admin/uazapi.ts::attachInstance`) valida 5 coisas:
   - tenant existe e `is_active=true`
   - tenant ainda não tem `whatsapp_instances` row
   - instância existe na UAZAPI
   - instância não está attached em outro tenant
   - token da instância é recuperável (vem do `GET /instance/all` admin UAZAPI)
5. Criptografa o token (AES-256-GCM com `ENCRYPTION_KEY`) e faz INSERT em `whatsapp_instances`.

Fluxo B — criar **e** atribuir de uma vez (atalho):

```http
POST /api/admin/uazapi/create-and-attach
{ "tenantId": "<uuid>", "name": "acme-prod" }
```

Equivale a `UazapiClient.createInstance(name)` + `attachInstance(newId, tenantId)` numa transação lógica.

### 2.5. Usuário loga

O user recebe email+senha do superadmin (fora da plataforma — sem envio automático no MVP) e loga em `/login`. Na primeira vez ele é redirecionado para `/home` (ou `/onboarding` se a instância ainda estiver `connecting`). O QR é renderizado pelo `QrCodePanel` já existente — a diferença é que **quem gerou a instância foi o superadmin**.

Se o user chega em `/onboarding` sem instância atribuída, vê o empty state "nenhuma instância atribuída, contate o admin".

---

## 3. Tabela de rotas `/admin`

| Rota | Método | Descrição |
|---|---|---|
| `/admin` | GET | Dashboard com contagens (tenants, users, instances attached/unattached) |
| `/admin/tenants` | GET | Lista tenants + ações (editar / suspender / deletar) |
| `/admin/tenants/[id]` | GET | Detalhe do tenant (members, instância, plan) |
| `/admin/users` | GET | Lista users + ações (reset password / remover do tenant) |
| `/admin/uazapi` | GET | Lista instâncias UAZAPI + ação "atribuir"/"desatribuir" |

| API | Método | Descrição |
|---|---|---|
| `/api/admin/tenants` | GET / POST | Lista / cria tenants |
| `/api/admin/tenants/[id]` | GET / PATCH / DELETE | Lê / edita / deleta tenant |
| `/api/admin/tenants/[id]/suspend` | POST | Flip `is_active` (true↔false) |
| `/api/admin/users` | GET / POST | Lista / cria users |
| `/api/admin/users/[id]` | PATCH / DELETE | Edita membership / deleta user |
| `/api/admin/users/[id]/password` | POST | Reset de senha (admin-forced) |
| `/api/admin/uazapi/instances` | GET | Lista instâncias UAZAPI (com `attachedTenantId`) |
| `/api/admin/uazapi/attach` | POST | Atribui instância a tenant |
| `/api/admin/uazapi/attach/[tenantId]` | DELETE | Desatribui instância do tenant |
| `/api/admin/uazapi/create-and-attach` | POST | Cria e atribui numa chamada |

Todas as rotas `/api/admin/*` são gated por `requireSuperadmin()` (`lib/tenant.ts`) → retornam `401` sem sessão, `403` se sessão não é superadmin. Rate limit 30/min/user (in-memory).

---

## 4. Operações comuns

### 4.1. Resetar senha de um user

**Por UI**: `/admin/users/[id]` → botão "resetar senha" → modal pede nova senha → `POST /api/admin/users/[id]/password { password }`.

**Por CLI** (fallback):
```bash
node --env-file=.env.local scripts/set-superadmin.mjs user@x.com --password 'nova-senha'
# (reutiliza o script, que também atualiza senha de não-superadmins)
```

Não há fluxo de self-reset (`/forgot-password`) no MVP — é débito consciente para a Fase 14.

### 4.2. Suspender vs. deletar tenant

| Ação | O que faz | Reversível? |
|---|---|---|
| **Suspender** (`is_active=false`) | Desativa o tenant. Users existentes ainda conseguem logar, mas UIs de tenant podem esconder conteúdo. Sem perda de dados. | ✅ `activateTenant` restaura |
| **Deletar** (hard) | `DELETE FROM tenants WHERE id=?` → cascade em `tenant_members`, `whatsapp_instances`, `groups`, `messages`, `transcripts`, `summaries`, `audios`, `schedules`, `ai_calls` | ❌ irreversível, sem backup automático |

**Recomendação:** use **suspender** como default. Hard delete só em casos de limpeza de tenants de teste. A UI deve exibir confirm destrutivo (`window.confirm` no MVP — UX degradada mas funcional).

### 4.3. Desatribuir instância

`DELETE /api/admin/uazapi/attach/[tenantId]` remove o row em `whatsapp_instances`. **Cascade**: deleta `groups`, `messages`, `transcripts`, `summaries` daquele tenant (tudo que pendura em `whatsapp_instances.id` ou `tenant_id` via FK). A instância **não é deletada** na UAZAPI — pode ser reatribuída a outro tenant sem custo.

---

## 5. Constraint 1:1 tenant↔instância — por quê?

Antes da Fase 13 não havia `UNIQUE` em `whatsapp_instances(tenant_id)`, então um tenant poderia acidentalmente acumular múltiplos rows (por ex. se o script de onboarding rodasse duas vezes). Ninguém explorava isso porque a UI `/onboarding` só usa `LIMIT 1`.

A Fase 13 formaliza isso como constraint:

```sql
CREATE UNIQUE INDEX uniq_whatsapp_instances_tenant
  ON public.whatsapp_instances(tenant_id);
```

Vantagens:
- `attachInstance` pode usar UPSERT sem ambiguidade.
- Queries que hoje fazem `.limit(1)` podem usar `.single()` sem guard.
- Billing por tenant fica trivial (1 instância = 1 WhatsApp = 1 número).

Multi-instância por tenant continua sendo pós-MVP (Fase 15+).

---

## 6. Débitos conhecidos (Fase 13)

| Débito | Impacto | Plano |
|---|---|---|
| `/onboarding` ainda renderiza `QrCodePanel` legacy (que usa polling via `/api/whatsapp/status`) | Funciona como read-only hoje; sem "gerar QR" o user só vê status | OK. Remover action `startConnectAction` + rota `POST /api/whatsapp/connect` na Fase 14. |
| Sem email automático ao criar user | Superadmin tem que comunicar a senha fora da plataforma | Integrar Resend/SendGrid em Fase 14 |
| Sem audit log de ações do superadmin | Todo insert/delete em `tenants` / `tenant_members` passa pela service role — nenhum rastro de "quem fez o quê" | Tabela `admin_audit_log` + middleware nas rotas `/api/admin/*` em Fase 14 |
| Modal de confirm destrutivo usa `window.confirm` | UX ruim (browser chrome), mas funcional | Modal chunky custom em Fase 14 |
| `/forgot-password` não existe | User que esquece senha depende do superadmin | Adicionar `supabase.auth.resetPasswordForEmail` em Fase 14 |
| Sem `tenants.suspended_at` nem motivo | Não dá pra saber quando/por quê foi suspenso | Campo `suspended_at timestamptz` + `suspend_reason text` em Fase 14 |

---

## 7. Admin ecosystem — roadmap pós-Fase 13

- **Fase 14**: password self-reset via email, audit log, UI modal chunky, notification email no createUser.
- **Fase 15**: múltiplos admins por tenant (`tenant_members.role='admin'` ganha poderes de criar/remover membros **do próprio tenant**, sem precisar do superadmin).
- **Fase 16**: dashboard analytics — custo por tenant, uso UAZAPI, topo de grupos mais resumidos.
- **Fase 17**: billing integrado (Stripe webhook → `tenants.plan` + `tenants.billing_status`).

---

## 8. FAQ

**Q: Por que não deixar signup público + assinatura?**
A: Modelo B2B; cada tenant é um cliente com contrato assinado. Self-service geraria atrito comercial.

**Q: E se o superadmin esquecer a senha?**
A: Outro superadmin reseta via `/admin/users`. Se não houver outro, use `scripts/set-superadmin.mjs` direto no servidor (requer service role key).

**Q: Posso ter vários tenants no mesmo user?**
A: Sim — `tenant_members` é M2M. Mas a UI atual simplifica para 1:1 no seletor. Multi-tenant UI fica pós-MVP.

**Q: Um superadmin também é membro de algum tenant?**
A: Independente. `public.superadmins` é uma tabela separada. Um user pode ser **só superadmin** (sem tenant) ou **tenant member + superadmin** (consegue ambas as UIs). O seletor de tenant respeita `tenant_members` mesmo para superadmins.
