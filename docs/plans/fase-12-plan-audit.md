# Auto-audit do plano Fase 12

Revisão do `fase-12-plan.md` antes de disparar agentes.

## O que está bom
- A1 sequencial é correto — superadmin é infra, dark theme é decisão global, /health deletion é cleanup. Tudo tem que acontecer antes do redesign.
- Portar componentes ANTES da home (A2) é correto — A4 depende de PodCover/PlayerWave.
- Critério de aceite verificável em cada item.
- Empty states preservando visual (não fallback pra design genérico) — correto pra fidelity.

## Risco que o plano NÃO cobre adequadamente

### 1. **Dark theme afeta `/groups`, `/approval`, `/podcasts`, `/schedule`, `/onboarding`, `/history`**
O plano diz "forçar dark em `(app)/layout.tsx`" — correto em escopo, mas todas essas telas foram desenhadas com tokens semânticos (`--color-bg`, `--color-surface`, etc) que já flipam com `data-theme="dark"`. Se alguma hardcodou light (ex: `background: #FFFBF2`), vai quebrar.

**Mitigação:** A5 deve rodar Playwright em cada rota `(app)` e tirar screenshot pra confirmar. Se quebrou, abre issue em backlog (não bloqueia A1-A4).

### 2. **`PodCover` chama Unsplash external por default**
Plano documenta como risco mas não propõe solução pra zero-dados. Protótipo usa 6 variants de fotos — se zero episódios, `latestEpisodes` é vazio e a grid deve renderizar stubs (sem foto).

**Mitigação:** A2 documenta prop `photo?: string | null` onde `null` renderiza um fallback visual (sem chamar Unsplash). A4 passa `photo: null` nos stubs.

### 3. **Script `set-superadmin.mjs` depende de password provider**
Supabase por default usa apenas email (magic link). Password provider precisa estar habilitado.

**Mitigação:** A1 verifica via Management API `GET /v1/projects/:ref/config/auth` se `external_email_enabled: true` E o provider permite signup com password. Se não, roda PATCH pra habilitar.

### 4. **Stats service pode ser lento**
Cada query é simples mas são 5+. Em tenant com muitas mensagens, `count(distinct group_id)` pode custar.

**Mitigação:** A3 usa indexes existentes (`idx_messages_tenant_created_at`). Documenta tempo típico observado. Cache por 60s usando `unstable_cache` é pós-MVP.

### 5. **Signed URL pra hero player expira em 1h**
Se user deixa a home aberta, áudio para de tocar após 1h.

**Mitigação:** A3 returns `expiresAt` também. A4 client component re-fetcha quando próximo de expirar.

### 6. **A1 delete `/health` — pode ter links na UI**
Landing `/` tem botão "verificar conexão" → `/health`.

**Mitigação:** A1 atualiza `app/page.tsx` removendo o botão OU substituindo por "entrar".

## Risco sobre-estimado no plano

- "Tokens CSS ausentes" — já verifiquei, `globals.css` tem TODOS via `@theme inline`. Plano pode remover essa seção.

## Ordem validada

A1 sequencial primeiro (confirmado).

A2 + A3 + A5 podem rodar em **paralelo puro** (sem dependência).

A4 depende de A2 (`PodCover`, `PlayerWave`, `StatCard`) + A3 (`getHomeStats`). Duas opções:
- (a) disparar A4 em paralelo usando interfaces stub; integração final valida
- (b) esperar A2 e A3 completarem; A4 sequencial

Opção **(a)** é mais rápida. Escolhida.

## Adições ao plano

- A1: atualizar `app/page.tsx` removendo link `/health`
- A1: confirmar password provider Supabase
- A2: `PodCover` aceita `photo?: string | null` com fallback
- A3: retornar `expiresAt` nas signed URLs
- A5: Playwright screenshot de cada `(app)` route
- A5: documentar SettingsCard movida pra backlog

## Veredito

**Plano aprovado com as 6 adições acima.** Custo estimado: ~2h de agents. Vou disparar A1 agora.
