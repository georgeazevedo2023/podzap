# docs/audits/ — auditorias e sessões

Histórico do projeto contado em 3 formatos:

## Sessões cronológicas (cole aqui pra reconstruir "o que aconteceu nesse dia")

Mais recente primeiro:

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
