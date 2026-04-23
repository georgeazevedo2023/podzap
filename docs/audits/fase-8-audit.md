# Auditoria — Fase 8 (Aprovação humana)

Auditor: Claude (Opus 4.7 1M). Data: 2026-04-22.

## Veredito

**PASS.** Feature principal do produto implementada. 22 testes novos (200 total). State machine limpa, UI com 2-col grid + editor mono + toolbar, regenerate preserva audit trail (cria nova row, não muta original).

## Checks

| Check | Resultado |
|---|---|
| typecheck | ✅ |
| tests | ✅ 200/200 (+22 em summaries-service.spec) |
| build | ✅ |

## Destaques

- **State machine limpa**: `pending_review → approved | rejected`. Edits só em `pending_review`.
- **Regenerate não muta original** — cria nova row `pending_review`. Audit trail preservado (por que foi rejeitado, quem fez, etc).
- **Sidebar badge com count real** via `{ head: true, count: 'exact' }` — zero payload.
- **`beforeunload` apenas quando dirty** — sem falsos positivos.
- **Save requisita não-dirty antes de aprovar** — previne aprovar texto não salvo.
- **Reason trimada** — não aceita só whitespace.
- **Max 50k chars** no text — previne payload gigante.
- **Cross-tenant NOT_FOUND** nunca leaka existence.
- **Error mapping**: 404 NOT_FOUND, 409 INVALID_STATE, 400 VALIDATION_ERROR — semânticos.
- **Tone colors consistentes** UI (formal=purple, fun=lime, corporate=yellow).

## Débitos

1. **Notifications** — badge é polling server-side. Push/email ficaram backlog.
2. **Modos autopilot** (`auto|optional|required`) — só `required` implementado de fato. `schedules.approval_mode` da Fase 11 vai resolver.
3. **Reject reason** — free text. Sem categorias predefinidas.
4. **Regenerate cria proliferação** de pending rows — cleanup de duplicados é pós-MVP.
5. **Sem diff visual** entre versão gerada e editada. Pós-MVP.
6. **Supersede**: regenerate não marca original "superseded", fica órfão em pending_review. Documentado; fix pós-MVP.

## Recomendações Fase 9

1. **Worker `generate-tts`** — trigger `summary.approved`. Usa `lib/ai/gemini-tts.ts` (já existe).
2. **Storage bucket `audios`** (separado de `media` que é pra incoming).
3. **Tabela `audios`** já existe no schema (0001) — só insert.
4. **Voice config**: masc/fem + speed. Começar com defaults.
