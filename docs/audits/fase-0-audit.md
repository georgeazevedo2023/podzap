# Auditoria — Fase 0

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22. Escopo: scaffolding commitado em `main`.

## Smoke test (Playwright)

Dev server em `localhost:3001` (3000 ocupado). Prints em `docs/audits/screenshots/`.

| Rota | Status | Notas |
|---|---|---|
| `/` | ✅ renderiza | sticker, título chunky, botões, divisor tracejado, badge "FASE 0 · SCAFFOLDING ✅". 1 erro console: `favicon.ico 404` (cosmético) |
| `/health` | ✅ renderiza | 6/6 env vars verdes; Supabase vermelho com `PGRST205: Could not find the table 'public.tenants'` — **confirma migration não aplicada ainda** (comportamento esperado) |

**Bug cosmético adicional do `/health`:** o handler em `app/health/page.tsx:11` só mapeia `error.code === '42P01'`, mas Supabase via PostgREST retorna `PGRST205` para tabela ausente. Em vez da mensagem amigável "Tabelas ainda não criadas", o usuário vê o código bruto. Corrigir junto da Fase 1.



## Veredito geral

**PASS WITH CONCERNS.** O scaffolding é competente, bem comentado, com preocupações corretas (RLS em todas as tabelas, zod nos payloads UAZAPI, separação admin/server/browser do Supabase). Mas tem **uma brecha de RLS real** no `tenants_insert` e alguns débitos que podem morder na Fase 1. Nada impede de começar a Fase 1 — mas 2 itens devem entrar como primeira coisa dela.

---

## 🔴 Bloqueadores (devem ser resolvidos antes da Fase 1)

1. **`db/migrations/0001_init.sql:285-286` — `tenants_insert` permite escalonamento horizontal.**
   A policy só exige `auth.uid() is not null`. Isso significa que **qualquer usuário autenticado pode criar tenants à vontade**, sem bound nenhum. Não é leak de dados entre tenants, mas é:
   - Vetor de DoS/abuso (usuário cria 10k tenants).
   - Incoerente com o plano do próprio PRD (tenant criado no signup, via trigger `handle_new_user` — ver TODO linhas 405-435).
   Recomendo: enquanto o trigger `handle_new_user` não existe (Fase 1), **não expor o insert via anon/authenticated**. Deixar insert fechado (sem policy) e fazer pelo service_role no signup. Quando o trigger existir, o caminho client nunca precisará desse insert.

2. **`db/migrations/0001_init.sql:148` — `messages.uazapi_message_id` é `unique` GLOBAL (não por tenant).**
   Como o `uazapi_message_id` vem do WhatsApp, colisão entre tenants é teoricamente improvável, mas:
   - Se dois tenants usam a mesma instância UAZAPI (testes, migração), uma msg do tenant A **impede** o insert do tenant B.
   - Uma policy de RLS não bloqueia a colisão — ela quebra antes, na constraint, com erro visível apenas para o worker.
   Correção trivial: `unique (tenant_id, uazapi_message_id)` e trocar o índice implícito por `create index ... on (uazapi_message_id)` se ainda quiser lookup rápido. Isso também alinha com a convenção já usada em `whatsapp_instances` (linha 114) e `groups` (linha 136).

---

## 🟡 Riscos e débitos (devem virar tarefas)

### RLS / schema

3. **`tenant_members_select` (linha 305-309) faz self-join recursivo** via `tenant_id in (select tenant_id from tenant_members where user_id = auth.uid())`. Postgres resolve, mas **é o clássico caminho de loop/recursão de política**. Funciona aqui porque a subquery do `USING` é tratada como *security definer* pelo planner na 2ª passagem — mas é frágil. Recomendo: trocar por `security definer function current_user_tenant_ids()` (retorna `setof uuid`) e referenciar nela. Reduz risco de regressão em futuras versões do Postgres e melhora perf (tira do plano por-linha).

4. **`set_updated_at()` (linhas 61-69) não tem `security definer` nem `set search_path`**. Para o caso de `before update` trigger isso não causa privilege escalation, mas o `search_path` aberto pode ser explorado se um usuário malicioso criar `public.now()`. Boa higiene Supabase: `security definer` + `set search_path = ''` + qualificar `now()` como `pg_catalog.now()`.

5. **Faltam índices para query patterns da Fase 6-8:**
   - `summaries(tenant_id, group_id, period_start desc)` — não existe; a busca "últimos resumos de um grupo" cai em `idx_summaries_group_status_created_desc` mas não filtra por período.
   - `messages(group_id, captured_at)` + `messages.type` isolados não cobrem "mensagens do grupo X no dia Y que são áudio" (Fase 5 worker). Composto `(group_id, type, captured_at desc)` seria o correto.
   - `schedules.trigger_type` não tem índice; cron scan vai full-table quando houver muitos tenants.

6. **`audios.summary_id` é `unique` (linha 210) mas `delivered_to_whatsapp = true` não tem índice parcial.** Fase 10 vai querer "áudios prontos e não entregues" constantemente — adicione `create index ... on audios(created_at) where delivered_to_whatsapp = false`.

7. **Enum `summary_tone` tem apenas `formal | fun | corporate`**, mas `gemini-llm.ts:37-47` é a **única fonte** desse mapeamento. Se alguém adicionar um tom novo no código sem migration, o banco rejeita silenciosamente. Aceitável por ora, mas vale uma nota no PR da Fase 7.

8. **`schedules.group_id` é `unique` (linha 230)** — `one schedule per group`. O PRD §16/ROADMAP Fase 11 fala em "frequências (diário/semanal)" e "tipos (fixed_time/inactivity/dynamic_window)". Se o usuário quiser combinar dois triggers (ex.: diário 18h **+** por inatividade), o modelo atual impede. Confirmar com o dono do produto antes de consolidar.

9. **`tenants.plan text default 'free'`** — deveria ser enum. `'free' | 'pro' | 'enterprise'` ou similar. Aceitável como débito, mas vira bug quando alguém digitar `'Free'`.

### Supabase clients

10. **`lib/supabase/types.ts` é placeholder permissivo (`Record<string, unknown>`).** Isto **silencia o TypeScript** — a query `supabase.from('tennants').select()` (com typo) type-checa. Deve ser o **primeiro** item da Fase 1: rodar `npx supabase gen types typescript` após aplicar a migração.

11. **`lib/supabase/middleware.ts:17` não passa `options` ao `request.cookies.set`.** Pattern oficial Supabase passa o terceiro arg. Em dev geralmente funciona; em prod (sameSite, secure, path) pode falhar silenciosamente. Comparar com https://supabase.com/docs/guides/auth/server-side/nextjs e alinhar.

12. **Nenhuma guard runtime em `admin.ts`** contra execução no bundle do browser. Sugestão: adicionar no topo `if (typeof window !== 'undefined') throw new Error('admin client cannot run in the browser')`. Hoje, a única proteção é não ter `'use server'` e não ser importado por componentes client — convenção frágil para um projeto que 5 agents paralelos vão modificar. Verificação **grep** não encontrou imports de `admin` fora de `app/health/page.tsx` (server), então está ok **por enquanto**.

13. **`health/page.tsx:7` usa o `admin` client para validar a conexão.** É pragmático, mas torna o `/health` efetivamente privilegiado — qualquer um acessa a rota e o endpoint *bypassa RLS* para consultar `tenants`. Não vaza dados (só `limit(1)` + error code), mas o padrão é feio. Idealmente o `/health` deveria usar um client anônimo que apenas pinga `auth.getSession()` ou `.from('tenants').select('count', { head: true })` via anon key — o erro 42P01 ou PGRST100 responde a pergunta "migration aplicada?".

### AI wrappers

14. **`lib/ai/gemini-llm.ts:127` — contents passa o prompt inteiro como `user`**, sem `systemInstruction`. O prompt-system (papel, voz) e o conteúdo (mensagens) ficam misturados. Funciona, mas em modelos Gemini 2.5 o `systemInstruction` separado dá melhor aderência. Débito de qualidade, não de segurança.

15. **`gemini-llm.ts:117-119` rejeita `messages.length === 0`** mas não limita tamanho superior. Gemini 2.5 Pro tem context window grande, mas a conta em $ cresce. Fase 7 deve adicionar truncamento/chunking.

16. **`gemini-tts.ts:91` — fallback `'gemini-2.5-flash-preview-tts'`**. Modelos *preview* são descontinuados sem aviso. Vale um comentário `// TODO: migrar quando sair do preview` e monitorar.

17. **`gemini-vision.ts:45-53` — `fetch(image.url)` sem timeout, sem tamanho máximo, sem allowlist de hosts.** Se um webhook UAZAPI vier com uma URL maliciosa (SSRF: `http://169.254.169.254/...`), o worker busca. Baixa prioridade (só ataca depois de ter acesso ao webhook), mas antes de Fase 4 adicionar:
    - Timeout via `AbortSignal.timeout(10_000)`.
    - Limite de tamanho (read stream até N MB).
    - Allowlist: apenas hosts `mmg.whatsapp.net`, `media.uazapi.com`, etc.
    Mesma observação vale para `groq.ts:49-57`.

18. **`groq.ts:87-91` — `response as unknown as { text; language; duration }`**. Cast sem validação. Se a Groq mudar o shape do `verbose_json`, ninguém nota até produção. Zod schema leve aqui seria a diferença de 10 linhas e vale muito.

19. **Client caches (`cachedClient`) em todos os 3 wrappers Gemini/Groq** são module-level. Em Next.js Vercel lambda, mesma instância serve múltiplas requests — ok. Mas em ambiente multi-tenant com chaves diferentes por tenant (roadmap pós-MVP), isto precisará ser rewrite. Aceitável hoje, anotar.

### UAZAPI

20. **`lib/uazapi/client.ts:152-161` — `createInstance` usa path `/instance/init`** com uma TODO (`OPEN QUESTION`) não resolvida. A integração real vai quebrar na Fase 2 até alguém validar contra a doc. Isso não é débito, é item **da Fase 2** — mas o fato de estar na primeira linha da função e não há teste garante que vai estourar.

21. **`client.ts:309-311` — headers de admin enviam `admintoken` E `token`** com o mesmo valor. O comentário diz "skill notes both headers are expected" — ok, mas em produção enviar o token em dois lugares aumenta surface em logs. Revalidar.

22. **`lib/uazapi/types.ts:1` — `// TODO: install zod — npm i zod`** é mentira: `zod ^4.0.0` já está em `package.json:21`. Remover o TODO.

23. **`IncomingWebhookEventSchema` (linha 353-372) não cobre `presence.update`, `chats.upsert`, `groups.update`** que a UAZAPI emite. Degrada para `{ event: 'unknown', raw }` — ok para o scaffold, mas o webhook handler da Fase 4 precisa logar volume dessa categoria para detectar falta de tratamento.

24. **Não há helper para validar a assinatura do webhook** (o `UAZAPI_WEBHOOK_SECRET` está no `.env.example:52` mas nada o usa ainda). Entrada obrigatória para Fase 4 — registrar no ROADMAP.

### App / render

25. **`proxy.ts:4` — Next.js 16 renomeou `middleware.ts` → `proxy.ts`**. Confirmei no source do `node_modules/next`: o arquivo precisa exportar `default` ou `proxy`. Está correto. ✓ (Registrei só porque não é óbvio e o reviewer pode apontar como erro.)

26. **`app/page.tsx` e `app/health/page.tsx`** usam inline `style={{...}}` pesado em vez das utilidades Tailwind v4 que já estão mapeadas em `globals.css` (via `@theme inline`). Não quebra nada, mas desperdiça o investimento no design system. Nota de refactor, não bug.

27. **`app/health/page.tsx:11` — código `42P01`** (tabela inexistente) é bem tratado. Outros códigos interessantes (`42501` permission denied, `PGRST*`) caem no fallback genérico. Aceitável.

28. **`app/layout.tsx`** não importa fonte via `next/font` — o `globals.css:4` usa `@import url(fonts.googleapis.com)` bloqueante. Isso adiciona ~200ms de FCP e impede self-hosting. Débito de performance.

29. **Matcher do `proxy.ts:17`** exclui `api/webhooks`, `_next/*`, favicon, imagens. **NÃO** exclui `/api/inngest` nem rotas de health — quando Inngest chegar, a sessão Supabase vai ser "refreshed" em cada chamada de função, o que é desperdício. Ajustar na Fase 5.

### Componentes

30. **`components/icons/Icons.tsx:23` — `Icons: Record<string, IconComponent>`** perde a informação de chaves concretas. `Icons.Home`, `Icons.Fake`, `Icons.Typo` todos type-checam. Trocar para `const Icons = { Home: ..., ... } as const satisfies Record<string, IconComponent>` dá autocomplete e detecta typo.

31. **`components/shell/Sidebar.tsx:53-55` — `usage` tem defaults fake (`7 de 15`).** Esses números vão parar numa screen real sem ninguém notar. Hoje é só o scaffold, mas o componente deveria **exigir** `usage` ou retornar `null`. Débito.

32. **`NavButton.tsx:46-51` — hover via `onMouseEnter/Leave` mutando `style`**. Anti-pattern; perde quando há foco via teclado, não reproduz em SSR. Trocar por CSS `:hover` (a classe `.btn` já faz isso, basta uma classe `.nav-btn`).

---

## 🟢 Pontos fortes

- **RLS habilitado em TODAS as 9 tabelas** (linhas 264-272). Maioria dos projetos esquece 1-2.
- **Estratégia explícita para `transcripts` (sem `tenant_id`)** via join por `messages` (linhas 367-378) — correto e bem comentado.
- **Política `tenant_members_insert`** (linhas 311-320) pensou no caso "dono criando tenant" e "admin adicionando alguém" — cobertura boa.
- **`UazapiClient` é stateless** e injeta `instanceToken` por chamada — permite multi-tenant com chaves distintas sem client-per-tenant.
- **zod schemas com `preprocess` para normalizar PascalCase/camelCase da UAZAPI** (`types.ts:69-104`) é exatamente a defesa certa contra uma API notoriamente inconsistente.
- **`sniffMimeType` em `gemini-vision.ts:64-77`** — magic bytes, não confiar em `Content-Type`. Cuidado sério.
- **`pcmToWav` em `gemini-tts.ts:52-73`** — header RIFF/WAV correto (little-endian, 44 bytes, campos nas offsets certos). Validei manualmente.
- **Comentário `TODO handle_new_user` no final do SQL (linhas 404-436)** já vem com rascunho da trigger. Facilita a Fase 1.
- **`.env.local` é gitignored** (`.gitignore:3`) e `git ls-files` só mostra `.env.example`. ✓
- **Nenhuma chave/secret hard-coded** encontrada em arquivos `.ts/.tsx/.sql`. Tudo via `process.env` + `requireEnv`.
- **`tsconfig strict: true`** (linha 7). ✓
- **Separação `proxy.ts` (adapter) → `lib/supabase/middleware.ts` (lógica)** é testável.

---

## 📋 Checklist detalhado

### Schema SQL (`db/migrations/0001_init.sql`)
- [x] RLS habilitado em todas as tabelas
- [x] FKs com `on delete cascade` corretos (nenhum ciclo detectado — cascada desce de `tenants` para tudo, o que é desejado)
- [x] `updated_at` trigger nas tabelas mutáveis
- [x] Enums completos para os estados conhecidos
- [ ] `tenants_insert` gated (bloqueador #1)
- [ ] `messages.uazapi_message_id` unique por tenant (bloqueador #2)
- [ ] `set_updated_at` com `security definer` + `search_path` fixo (#4)
- [ ] Índices adicionais para Fase 5-8 (#5, #6)
- [ ] Revisar `schedules.group_id` unique (#8)
- [ ] `tenants.plan` virar enum (#9)

### Supabase clients (`lib/supabase/*`)
- [x] `createClient` browser/server/admin separados
- [x] `server.ts` usa `await cookies()` (Next 16)
- [x] `admin.ts` com `autoRefreshToken: false, persistSession: false`
- [ ] `types.ts` gerado real (débito #10)
- [ ] `middleware.ts` setar `options` nos cookies (#11)
- [ ] Guard runtime contra import do `admin` no client (#12)

### AI wrappers (`lib/ai/*`)
- [x] `AiError` + `requireEnv` simples e eficaz
- [x] Sem uso de `any` nos arquivos TS (verificado com grep — só aparece em comentário)
- [x] Prompt podzap-summary/v1 versionado
- [x] `responseSchema` zod-like no Gemini LLM
- [x] Header WAV correto
- [ ] SSRF guards em fetches de URL (#17)
- [ ] Validação runtime das respostas Groq (#18)
- [ ] systemInstruction separado no LLM (#14)

### UAZAPI (`lib/uazapi/*`)
- [x] zod schemas cobrem instance, groups, send, webhooks
- [x] Discriminated union de `MessageContent` com fallback `other`
- [x] `UazapiError` consistente em todos os throws
- [x] Normalização de shape (PascalCase/camel) via `preprocess`
- [ ] Endpoints `createInstance`/`deleteInstance` validados contra UAZAPI real (#20)
- [ ] Helper de validação do `UAZAPI_WEBHOOK_SECRET` (#24)
- [ ] Remover TODO falso sobre instalar zod (#22)

### Componentes React
- [x] `'use client'` apenas em `Sidebar` e `NavButton` (os que têm handlers)
- [x] Sem `any` nas props
- [x] TopBar/Button/Card/Sticker/Icons são puros, SSR-safe
- [ ] `Icons` tipar com `as const satisfies` (#30)
- [ ] NavButton hover via CSS, não inline JS (#32)

### App structure
- [x] `/health` informa estado do banco + envs — genuinamente útil
- [x] `proxy.ts` com matcher bem comentado
- [x] `layout.tsx` com `<html lang="pt-BR">`
- [ ] Usar `next/font` em vez de `@import Google Fonts` (#28)
- [ ] Ajustar matcher do proxy quando Inngest chegar (#29)

### Config
- [x] Next 16.2.4 + React 19.2.4 + Supabase ssr 0.7 + genai 1.48 — versões coerentes entre si
- [x] `tsconfig strict: true`, `moduleResolution: bundler`, `@/*` alias
- [x] ESLint com `next/core-web-vitals` + `next/typescript`
- [x] PostCSS com `@tailwindcss/postcss`
- [ ] Adicionar `vitest` (CLAUDE.md §6 declara uso obrigatório, não está no `package.json`)

### Segurança
- [x] `.env.local` gitignored, nada commitado em histórico
- [x] Sem secrets hard-coded
- [x] RLS habilitado (declarado E, por tudo indicar, aplicado)
- [ ] RLS efetivamente testada (2 users, 2 tenants, assertions) — só na Fase 1
- [ ] Insert de tenants restrito (#1)

---

## Recomendações para Fase 1

1. **Primeira tarefa da Fase 1: criar `0002_fixes.sql`** corrigindo:
   - `tenants_insert` restrito (ou trigger `handle_new_user` já entregando esse caso).
   - `messages.uazapi_message_id` unique por tenant.
   - `set_updated_at` com `security definer` + `search_path`.
2. **Segunda tarefa: rodar `supabase gen types typescript` e substituir `lib/supabase/types.ts`** — sem isso, o resto da Fase 1 está voando cego em tipos.
3. **Teste efetivo de RLS** como gate de aceite (o ROADMAP já menciona mas com 2 linhas): 2 users em 2 tenants, verificar que `select` e `update` de um não afetam o outro. Usar `supabase-js` com JWT de cada user, não service_role.
4. **Adicionar `vitest` + smoke tests** nos wrappers `ai/*` (pelo menos validação dos schemas/parsing, não chamadas reais) — a Fase 5 vai apreciar.
5. **Documentar no `docs/integrations/uazapi.md`** quais endpoints ainda são OPEN QUESTION antes de começar a Fase 2.
6. **Considerar mover `db/migrations/` para `supabase/migrations/`** agora (antes de ter 5 migrations) para parar o "cp hack" descrito no `db/README.md:51-62`.

---

Fim do relatório.
