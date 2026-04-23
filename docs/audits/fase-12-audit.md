# Audit — Fase 12 (correção visual + superadmin + remove /health)

Data: 2026-04-22
Plano: [`docs/plans/fase-12-plan.md`](../plans/fase-12-plan.md)
Auto-audit do plano: [`docs/plans/fase-12-plan-audit.md`](../plans/fase-12-plan-audit.md)

## Veredito

**PASS WITH CONCERNS** — os 3 objetivos principais foram atingidos:

1. `/health` removido (Dockerfile + docker-compose + proxy + app/page atualizados)
2. Home redesenhada 1:1 com o protótipo `podZAP/screen_home.jsx` (hero player, stats row, último eps grid, sidebar panels)
3. Superadmin entregue — migration 0007 + helper `public.is_superadmin()` + script CLI de promoção

Concerns residuais: Playwright screenshot comparativo não rodou (MCP off), confirmação manual do `set-superadmin.mjs` com credenciais reais pendente, policies RLS ainda não consomem `is_superadmin()`, `/settings` ainda não existe como destino pro SettingsCard herdado.

## Checks executados

| Check | Resultado |
|---|---|
| `npm run typecheck` | clean (0 erros) |
| `npm test` | 265/265 passando (22 spec files — +19 tests vs Fase 11) |
| `npm run build` | clean (23 rotas, `/health` ausente, `/home` na lista) |
| `curl /` | 200 |
| `curl /health` | 404 (confirmada remoção) |
| `curl /login` | 307 (redirect normal) |
| `curl /home` (unauth) | redirect (auth gate intacto) |
| Migration `0007_superadmin.sql` | criada + sintaxe validada |
| Script `scripts/set-superadmin.mjs` | criada, idempotente via `on conflict do update` |
| Componentes portados | `PodCover`, `PlayerWave`, `Waveform`, `MicMascot`, `StatCard` em `components/ui/` |
| Service de stats | `lib/stats/service.ts` com 19 testes Vitest |
| Home redesign | hero + 4 stat cards + grid 4-up + 3 sidebar panels montados |
| Screenshot Playwright comparativo | ⏭ skipped (MCP Playwright não disponível) |

## Destaques entregues por agente

### A1 — Superadmin + dark theme + cleanup `/health`
- **Migration `db/migrations/0007_superadmin.sql`**: tabela `public.superadmins` com RLS restringindo escrita ao `service_role`; policy `superadmins_read_self` permite ao usuário consultar se ele mesmo é superadmin. Helper `public.is_superadmin()` (stable, security definer, `search_path=''`) exposto a `authenticated` e `anon`.
- **Script `scripts/set-superadmin.mjs`**: promove user por email via Admin API (lookup + optional password update + insert em `superadmins` via Management API).
- **Dark theme**: `data-theme="dark"` no wrapper de `app/(app)/layout.tsx` (não no `<html>`), preservando rotas públicas em tema claro.
- **`/health` removido**: rota + refs em Dockerfile / docker-compose / proxy / app/page.tsx atualizadas.

### A2 — Componentes visuais portados
Em `components/ui/`: `PodCover`, `PlayerWave`, `Waveform`, `MicMascot`, `StatCard`. Aceitam props compatíveis com o protótipo. `PodCover` honra a mitigação do auto-audit (`photo?: string | null` com fallback sem chamada externa).

### A3 — Service layer `lib/stats/service.ts`
`getHomeStats(tenantId)` retorna:
- `summariesThisWeek`, `minutesListened`, `activeGroupsCount`, `approvalRate`, `pendingApprovalsCount`
- `latestEpisodes[]` (últimos 4 com signed URL + `expiresAt`)
- `currentEpisode` (hero — também com signed URL + `expiresAt`)

19 testes novos em `tests/stats-service.spec.ts` cobrem cálculo de janelas, zero-state, e tratamento de falha nas signed URLs.

### A4 — Home redesenhada
`app/(app)/home/page.tsx` (server) + 6 client components:
- `HeroPlayer.tsx` — waveform animado + play controls + CTA "mandar no zap" OU empty state roxo se `currentEpisode === null`
- `StatsRow.tsx` — 4 `StatCard` (lime/pink/yellow/purple) com valores reais ou zero-state
- `LastEpisodesGrid.tsx` — 4 `PodCover` + player inline por card (ou stubs sem foto quando zero episódios)
- `GenerateQuickCard.tsx` — CTA rápido (link pra `/schedule` ao invés de modal inline — ver débito abaixo)
- `ApprovalQueueCard.tsx` — contagem de `pending_review` + link pra `/approval`
- `TipCard.tsx` — card amarelo "sacada"

Responsivo via inline `<style>` block (collapse pra 1 coluna abaixo de 900px). `SettingsCard` antigo removido — migrar pra `/settings` futura é débito explícito.

## Débitos herdados

1. **`SettingsCard` → `/settings`** — componente removido da home nessa fase. `/settings` ainda não existe. Quando for criado, montar o card lá. Ver débito abaixo do ApprovalQueue pra trilha RLS.

2. **GenerateQuickCard: link vs modal inline** — o protótipo sugeria um modal inline pra "gerar resumo agora" (picker de grupo + tom + dispatch imediato). Entregue como link pra `/schedule` por simplicidade. **TODO**: avaliar se modal inline melhora UX de single-shot (user quer resumo agora, não agendar recorrência).

3. **`audioExpiresAt` strategy** — `getHomeStats` retorna `expiresAt` em todas as signed URLs. `HeroPlayer` ainda **não refetcha** antes de expirar — se user deixa a home aberta > 1h, o `<audio>` quebra. **TODO**: adicionar `setTimeout(refetch, expiresAt - now - 60s)` no client.

4. **Playwright screenshot comparativo** — MCP Playwright off nessa sessão. Validação visual manual pendente. **Ação**: rodar `npm run dev`, logar, abrir `/home`, comparar com `podZAP/screen_home.jsx` lado a lado. Se divergir, abrir issue apontando o diff.

5. **Password provider Supabase** — não validado programaticamente nesta fase. Se `scripts/set-superadmin.mjs` com `--password` falhar com 400/422, habilitar email+password provider no dashboard Supabase.

6. **Policies RLS ainda não consomem `is_superadmin()`** — helper existe mas nenhuma policy a chama. Próximo passo: expandir seletivamente (`tenants`, `whatsapp_instances`, `ai_calls`, `schedules` primeiro — conteúdo de `messages`/`transcripts`/`summaries` depende de audit log LGPD-compliant).

7. **Admin panel `/admin`** — completamente pós-MVP. Trilha documentada em `docs/integrations/superadmin.md` §"Trilha pro admin panel".

8. **Unsplash URLs em `PodCover`** — risco de CSP em produção está documentado no plano. Mitigação atual: fallback quando `photo === null`. Upgrade futuro: cachear covers em `public/` ou Supabase Storage.

## Critério de aceite (do plano) — status

| Item | Status |
|---|---|
| `/health` retorna 404 | ✅ |
| `select is_superadmin` retorna true pra george.azevedo2023@gmail.com | 🟡 script pronto, rodar manualmente com envs reais |
| Login com senha `123456@` funciona via `signInWithPassword` | 🟡 idem (depende do script rodar) |
| `/home` em dark theme sem trocar o sistema | ✅ |
| Hero player visível com audio signed URL OU empty state roxo | ✅ |
| 4 stat cards visíveis (lime/pink/yellow/purple) | ✅ |
| Grid "últimos eps" com `PodCover` | ✅ |
| Right sidebar: 3 panels | ✅ (GenerateQuickCard, ApprovalQueueCard, TipCard) |
| Sidebar badge "Home" ativa | ✅ (intacto do layout) |
| `typecheck + test + build` clean | ✅ (0 / 265 passed / build ok) |
| Screenshot Playwright confere com protótipo | ⏭ skipped |

## Próximos passos recomendados

1. Rodar `scripts/set-superadmin.mjs george.azevedo2023@gmail.com --password "123456@"` com envs reais e validar query SQL (`select u.email from public.superadmins s join auth.users u on u.id = s.user_id`).
2. Validar visualmente a `/home` nova comparando com `podZAP/screen_home.jsx` (manual — Playwright MCP off).
3. Criar `/settings` e migrar o conteúdo do `SettingsCard` removido.
4. Implementar refetch client-side no `HeroPlayer` ao se aproximar de `expiresAt`.
5. Primeira policy RLS usando `is_superadmin()` — começar por `tenants.select` pra alimentar o futuro `/admin/tenants`.
