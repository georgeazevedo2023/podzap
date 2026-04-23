# Fase 12 — Correção visual + superadmin + remove /health

**Origem:** usuário pediu após MVP completo:
1. Remover `/health` (não precisa mais)
2. `/home` atual diverge do protótipo (claro vs dark, sem hero player, sem stats, sem últimos eps)
3. Promover `george.azevedo2023@gmail.com` a superadmin com senha `123456@`

## Análise

Comparação protótipo vs implementado:

| Aspecto | Protótipo (`podZAP/screen_home.jsx`) | Atual (`app/(app)/home/page.tsx`) |
|---|---|---|
| Tema | Dark forçado | Claro (default do sistema) |
| Hero | Card roxo `--purple-600` com waveform, play controls, "mandar no zap" | Card verde lime "conecta teu whatsapp" |
| Stats | 4 cards coloridos (resumos/minutos/grupos/aprovação) | Inexistente |
| Recents | Grid "últimos eps" com `PodCover` (thumbnails de pessoas) | Inexistente |
| Right sidebar | "gerar resumo agora" (pink), "aprovar N na fila", "sacada" | Tenant info + settings + sacada |

Protótipo assume estado populado. Atual é zero-state. Solução: **portar protótipo 1:1 + adicionar empty states que preservam o mesmo visual.**

## Escopo

### Preciso criar/modificar
- **Migration 0007** — tabela `superadmins`
- **Script** — setar password + marcar superadmin
- **Dark theme forçado** em `(app)/layout.tsx`
- **Componentes portados**: `PodCover`, `PlayerWave`, `MicMascot`, `StatCard` em `components/ui/`
- **Icons adicionais** em `components/icons/Icons.tsx` (Rewind, Skip, Sparkle, Send, Plus, Volume, Zap, Bell, Chat)
- **Service de stats**: `lib/stats/service.ts` com `getHomeStats(tenantId)` retornando dados reais
- **Home redesenhada**: server component + client (hero player)
- **Deletar** `app/health/`
- **Aliases CSS**: adicionar `--accent-2` etc se faltarem

### Dependências
- superadmins table requer `auth.users` (já existe)
- dark theme é global — todos componentes devem respeitar
- Stats service lê de `summaries`, `audios`, `groups`, `messages`, `tenant_members`

## Agentes

### A1 (SEQUENCIAL) — Superadmin + dark theme + remove /health
- Migration `0007_superadmin.sql`:
  ```sql
  create table public.superadmins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    granted_at timestamptz not null default now(),
    granted_by uuid references auth.users(id) on delete set null,
    note text
  );
  alter table public.superadmins enable row level security;
  -- Only service_role writes; superadmins themselves can select their own row
  create policy superadmins_read_self on public.superadmins
    for select to authenticated
    using (user_id = auth.uid());

  -- Helper usável em RLS futura: is_superadmin()
  create or replace function public.is_superadmin()
    returns boolean
    language sql stable security definer set search_path = ''
    as $$ select exists(select 1 from public.superadmins where user_id = auth.uid()) $$;
  grant execute on function public.is_superadmin() to authenticated;
  ```
- Script `scripts/set-superadmin.mjs` que:
  1. Recebe email via arg
  2. Look up user via Supabase Admin API `GET /auth/v1/admin/users?email=...`
  3. Update password via `PUT /auth/v1/admin/users/:id` com `{ password }` (se arg `--password`)
  4. Insert em `public.superadmins` via Management API
- Rodar: `node --env-file=.env.local scripts/set-superadmin.mjs george.azevedo2023@gmail.com --password "123456@"`
- Verificar: query `select u.email from public.superadmins s join auth.users u on s.user_id = u.id`
- Forçar dark em `app/(app)/layout.tsx`: adicionar `data-theme="dark"` no `<html>` OU no wrapper div (<html> já foi renderizado pelo root layout — então no div wrapper, E setar body background via inline style no layout).
- Deletar `app/health/` recursivo
- Remover "Health" de qualquer ROUTES map ou nav se estiver
- Atualizar `CLAUDE.md` + `README.md` sem menção a `/health` ativa
- Regenerar types + verificar tsc + tests

### A2 — Portar componentes visuais compartilhados
Ler: `podZAP/components.jsx`. Produzir em `components/ui/`:
- `PodCover.tsx` — prop `{ title, subtitle, variant, size, date }` com 6 variantes (cores + photos Unsplash). Manter o comportamento responsivo de tamanho (small/medium/large). Foto via `<img loading="lazy">`.
- `PlayerWave.tsx` — prop `{ progress, bars, seed }` deterministic pseudo-random + envelope sinoidal. Client component.
- `Waveform.tsx` — prop `{ bars, playing, color, height, seed }` com animação CSS `wave`. Client component.
- `MicMascot.tsx` — SVG inline com props `{ size, mood, bounce }` (happy/sleepy/party/thinking).
- `StatCard.tsx` — prop `{ label, value, accent, icon }` com 4 accents (lime/pink/yellow/purple).

Em `components/icons/Icons.tsx`, adicionar icons faltantes: `Rewind`, `Skip`, `Sparkle`, `Send`, `Plus`, `Volume`, `Zap`, `Bell`, `Chat`, `Settings`, `Wand`, `Edit`, `Refresh`, `X`, `Mic`.

**Tokens**: verificar `app/globals.css`. Se o protótipo referencia `var(--purple-600)` mas só existe `var(--color-purple-600)`, adicionar aliases no `@theme inline` ou no `:root` (ex: `--purple-600: var(--color-purple-600)`). Preservar todos os refs do protótipo funcionando.

### A3 — Service layer `lib/stats/service.ts`
```ts
export type HomeStats = {
  summariesThisWeek: number;
  minutesListened: number;
  activeGroupsCount: number;
  approvalRate: number; // 0-1
  pendingApprovalsCount: number;
  latestEpisodes: Array<{
    summaryId: string;
    groupName: string;
    createdAt: string;
    durationSeconds: number | null;
    coverVariant: number;
    audioSignedUrl: string | null;
  }>;
  currentEpisode: {
    summaryId: string;
    groupName: string;
    title: string;
    messagesCount: number;
    audiosCount: number;
    imagesCount: number;
    durationSeconds: number | null;
    audioSignedUrl: string | null;
    tone: string;
  } | null;
};

export async function getHomeStats(tenantId: string): Promise<HomeStats>;
```
Queries:
- summariesThisWeek: `count(*) from summaries where tenant_id=$1 and created_at > now() - interval '7 days' and status='approved'`
- minutesListened: `sum(duration_seconds)/60 from audios where tenant_id=$1 and delivered_to_whatsapp=true and delivered_at > now() - interval '7 days'` (proxy; podemos melhorar com events de play depois)
- activeGroupsCount: `count(distinct group_id) from messages where tenant_id=$1 and captured_at > now() - interval '7 days'`
- approvalRate: `count(*) filter (where status='approved') / count(*) from summaries where tenant_id=$1 and created_at > now() - interval '30 days'`
- pendingApprovalsCount: já usado na sidebar, reuse
- latestEpisodes: últimos 4 `audios` aprovados (join summaries + groups), com signed URL 1h
- currentEpisode: último áudio (ou summary approved) como "em destaque" pro hero

Testes com mock Supabase admin.

### A4 — Nova `/home` server + client
- `app/(app)/home/page.tsx` (server): fetch stats + render layout idêntico ao protótipo
- `app/(app)/home/HeroPlayer.tsx` (client): waveform animado + play controls + tempo + "mandar no zap"
- `app/(app)/home/LastEpisodesGrid.tsx` (client): 4x PodCover + player inline por card
- `app/(app)/home/SidebarPanels.tsx` (server ou client): "gerar resumo agora", "aprovar N na fila", "sacada"

Layout: `display: grid; grid-template-columns: 1fr 320px` conforme protótipo. Padding `24px 36px 40px`.

Empty states (quando stats.currentEpisode == null):
- Hero: mantém card roxo MAS com texto "ainda sem episódios" + sticker `PRIMEIRO PASSO` + CTA `conectar whatsapp →` (mantém vibe roxa do protótipo)
- Stats: mostra `0`, `0m`, `0`, `—%`
- Grid de últimos: 4 slots com PodCover stub "aguardando primeiro ep" (variant cinza neutro)
- Right sidebar "aprovar": placeholder "nenhum pendente"

Sidebar badge "Home" ativa.

### A5 — Integração + docs + audit
- Verificar todos os imports resolvem
- Remover `app/(app)/home/page.tsx` antigo, SettingsCard (pode mover pra `/settings` futura ou deletar — decisão: mover pra backlog)
- Atualizar `CLAUDE.md` §9 Status + § de Design fidelity (referenciar protótipo)
- Screenshot Playwright de `/home` lado-a-lado com protótipo pra confirmar fidelity
- `docs/audits/fase-12-audit.md`
- Commit + push

## Critério de aceite (Nyquist)

- [ ] `/health` retorna 404 (deletado)
- [ ] `select is_superadmin from ...` retorna true pra george.azevedo2023@gmail.com
- [ ] Login com senha `123456@` funciona via `signInWithPassword`
- [ ] `/home` em dark theme sem trocar o sistema
- [ ] Hero player visível com audio signed URL (se houver áudio) OU empty state roxo
- [ ] 4 stat cards visíveis (cores lime/pink/yellow/purple)
- [ ] Grid "últimos eps" com PodCover renderizado
- [ ] Right sidebar: 3 panels
- [ ] Sidebar badge "Home" ativa
- [ ] typecheck + test + build clean
- [ ] Screenshot Playwright confere com protótipo (subjetivo)

## Riscos

- **Tokens CSS ausentes** — protótipo usa `var(--purple-600)` direto. Se o Tailwind v4 só expõe `--color-purple-600`, portar precisa swap. Aliases resolvem.
- **Imagens Unsplash externas** — `PodCover` usa URLs externas. Em produção com CSP, bloquear. Pra MVP ok.
- **Password provider Supabase** — precisa estar habilitado em prod. Em dev pode estar. `scripts/set-superadmin.mjs` falhará se não; documentar.
- **Imports quebrados** — remover SettingsCard atual quebra `/home`. A5 sincroniza.
- **Dark theme global** pode afetar `/login` `/auth/callback` que são públicas — decisão: dark só em `(app)` route group. `/login` mantém atual.

## Ordem

1. **A1 sequencial** (migration, script rodado, dark theme aplicado, /health deletada)
2. **A2, A3, A4, A5 em paralelo** (A4 depende de A2 e A3, mas já escreve contra interfaces conhecidas)
