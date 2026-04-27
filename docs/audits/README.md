# docs/audits/ — auditorias e sessões

Histórico do projeto contado em 3 formatos:

## Sessões cronológicas (cole aqui pra reconstruir "o que aconteceu nesse dia")

Mais recente primeiro:

- [`session-2026-04-27-pacotes-1-5.md`](session-2026-04-27-pacotes-1-5.md) — **Pacotes 1-5 entregues**: card rico em /groups (stats grid + recolher), free-form prompt + duplicar config, schedule inline, voice picker per host (8 vozes Gemini), música por grupo (6 tracks). 5 commits, 5 deploys, 380 unit tests verde. Jornada do podcast 9→3 cliques (-66%).
- [`session-2026-04-27-fase-bcd.md`](session-2026-04-27-fase-bcd.md) — **Fases B+C entregues**: catálogo de 7 templates de prompt (`lib/summary/templates.ts`), modal Editar grupo (Geral/Hosts&Vozes/Avançado), `PATCH /api/groups/[id]`, hosts customizáveis. 369 unit tests verde. Setup-uma-vez-por-grupo + "✨ gerar" 1-clique = jornada de podcast em ~3 cliques (toggle → gerar → aprovar).
- [`session-2026-04-27-fase4.md`](session-2026-04-27-fase4.md) — Mobile-first **Fase 4 entregue**: AdminEntityList component, /admin/{tenants,users,uazapi} + tabela membros agora viram cards stacked em <md, modais com CTAs full-width, window.confirm eliminado. 15/15 specs verde. Fecha o ciclo mobile-first.
- [`session-2026-04-27.md`](session-2026-04-27.md) — Mobile-first migration: Fases 1-3 deployed (shell + drawer + bottom nav + PWA / `/approval` / `/home` + `/podcasts`), bug oculto do `/home` `display: contents` corrigido, **Fase 4 pendente** (entregue na continuação ↑). 47 specs Playwright, 0 regressions, 3 deploys consecutivos.
- [`session-2026-04-26.md`](session-2026-04-26.md) — CLAUDE.md vira orquestrador real (-83% tokens, 640→105 lin) + 4 skills procedurais (`podzap-{test-webhook,deploy,migration,db}`) + 3 docs novos (architecture/structure/data-model) + memory `docs_orchestration` + vault Obsidian limpo
- [`session-2026-04-25.md`](session-2026-04-25.md) — auditoria geral 5-agentes + parser wsmart cobre audio/image/video + decryption `.enc` via UAZAPI + áudio do owner end-to-end + descoberta do bug HMAC missing em prod
- [`session-2026-04-24-evening-music-ui-n8n.md`](session-2026-04-24-evening-music-ui-n8n.md) — música de fundo no podcast + migração crons pro n8n + prompts v7/v8 + UI fixes (chunky button, copy)
- [`session-2026-04-24-cleanup-summary.md`](session-2026-04-24-cleanup-summary.md) — duo podcast Ana+Beto + remoção `approval_mode=auto` + delivery exige clique humano

## Audits por fase (one per phase, output do GSD verifier)

Status canônico: `PASS` / `PASS WITH CONCERNS` / `FAIL`. Reconstrói a postura entrega-pra-entrega.

| Fase | Doc | Tema |
|---|---|---|
| 0 | [fase-0-audit.md](fase-0-audit.md) | Scaffold Next.js + Supabase |
| 1 | [fase-1-audit.md](fase-1-audit.md) | Auth + multi-tenancy |
| 2 | [fase-2-audit.md](fase-2-audit.md) | Conexão WhatsApp via UAZAPI |
| 3 | [fase-3-audit.md](fase-3-audit.md) | Sync + toggle de grupos |
| 4 | [fase-4-audit.md](fase-4-audit.md) | Webhook + media download |
| 5 | [fase-5-audit.md](fase-5-audit.md) | Inngest workers de transcrição |
| 6 | [fase-6-audit.md](fase-6-audit.md) | Pipeline filter + cluster |
| 7 | [fase-7-audit.md](fase-7-audit.md) | Gemini 2.5 Pro summary + ai_calls |
| 8 | [fase-8-audit.md](fase-8-audit.md) | Aprovação humana ⭐ |
| 9 | [fase-9-audit.md](fase-9-audit.md) | TTS + audios bucket |
| 10 | [fase-10-audit.md](fase-10-audit.md) | WhatsApp delivery |
| 11 | [fase-11-audit.md](fase-11-audit.md) | Agendamento (cron) |
| 12 | [fase-12-audit.md](fase-12-audit.md) | Visual fix + superadmin + remove `/health` |
| 13 | [fase-13-audit.md](fase-13-audit.md) | Admin-managed tenancy |

## One-off audits (deep-dives ad-hoc)

- [`duo-podcast-progress-2026-04-24.md`](duo-podcast-progress-2026-04-24.md) — entrega do podcast formato duo (Ana+Beto)
- [`ui-parity-2026-04-24.md`](ui-parity-2026-04-24.md) — auditoria de paridade visual com mockup
- [`ui-parity-logo-2026-04-24.md`](ui-parity-logo-2026-04-24.md) — fix da logo / favicon

`screenshots/` — capturas usadas pelos audits acima.

## Quando criar quê

| Situação | Crio... |
|---|---|
| Encerrei uma fase do roadmap | `fase-N-audit.md` (output do GSD verifier ou manual) |
| Sessão grande com múltiplas entregas interconectadas | `session-YYYY-MM-DD.md` |
| Deep-dive em um problema específico fora do ciclo de fases | one-off com nome descritivo `<tema>-YYYY-MM-DD.md` |
