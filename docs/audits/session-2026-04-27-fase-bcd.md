# Sessão 2026-04-27 (continuação 3) — Fases B+C: editar grupo + templates de prompt

Continuação direta da Fase A do mesmo dia (commit `2b17540` —
`session-2026-04-27-fase4.md` cobre Fase 4 mobile-first; Fase A do
follow-up entregou 1-click gerar via defaults por grupo).

## O que foi feito

### Fase C — Catálogo de templates de prompt

Criado `lib/summary/templates.ts` com **7 templates**:

- `default-duo` — DUO_SYSTEM_PROMPT existente refatorado pra usar
  placeholders `{{host1_name}}` / `{{host2_name}}` / `{{group_name}}`.
- `default-solo` — SOLO_SYSTEM_PROMPT idem.
- `divertido` — tom descontraído, gírias, "Até amanhã, galera!"
- `informativo` — estrutura formal de 5 partes, sem gírias, "Nos vemos
  no próximo episódio."
- `fofoca` — "Gente, vocês não vão acreditar...", suspense, dramático.
- `esportivo` — narrador de estádio + comentarista, "Apito final!"
- `rapido` — 2min, 3-5 destaques, "Resumo feito! Até amanhã."

Cada template é metadata + systemPrompt com vars. `renderTemplate(tpl, vars)`
substitui literal (case-sensitive). `resolveTemplate(id)` é defensivo —
strings desconhecidas viram `default-duo`.

### Fase B — Modal Editar grupo (3 tabs)

Componente `app/(app)/groups/EditGroupModal.tsx`:

- **Geral**: tom default, formato áudio (single|duo), janela default
  (24h|7d). Pills com tap target ≥44.
- **Hosts & Vozes**: nome host1 (default Ana), nome host2 (default Beto).
  Texto explicativo das vars TTS.
- **Avançado**: picker de template (radio cards com emoji + label +
  descrição + voiceMode). Disclosure com lista das vars disponíveis.

Patch parcial via `PATCH /api/groups/[id]` — só envia o que mudou em
relação à row inicial. Inclui no-op handling quando nada mudou (fecha
sem request).

### Wiring end-to-end

- Migration **0017** adiciona `prompt_template_id` (text + CHECK), `host1_name`,
  `host2_name` em `groups`. Defaults preservam comportamento pré-Fase C.
- `lib/groups/service.ts` ganhou `updateGroupSettings(tenantId, groupId, patch)` +
  `GroupView` expõe `promptTemplateId`/`host1Name`/`host2Name` com
  normalização defensiva (template inválido → `default-duo`; hosts vazios
  → Ana/Beto).
- `lib/summary/prompt.ts::buildSummaryPrompt` aceita opcional
  `templateId`/`host1Name`/`host2Name`. Quando `templateId` set: usa o
  template do catálogo, força `voiceMode` pelo template, substitui vars
  no systemPrompt. `promptVersion` virou `podzap-summary/v9-<template>-<voice>`
  pra trackear qual template gerou cada resumo (audit + A/B).
- `lib/summary/generator.ts::GenerateSummaryInput` propaga template+hosts
  pro builder.
- `inngest/events.ts::summaryRequested` adiciona campos opcionais.
- `inngest/functions/generate-summary.ts` rehydrata.
- `POST /api/summaries/generate` pega de `body` ou faz fallback no grupo.
- `PATCH /api/groups/[id]` (NEW) — endpoint pro modal salvar settings.
- `GroupCard` ganha botão "✎ editar" + footer mostrando template emoji +
  label + nomes dos hosts. Click areas isoladas via `data-card-config` pra
  não disparar o toggle do card.
- `GroupsList` orquestra abertura do modal e atualiza state local sem
  refresh do servidor (atualização otimista).

### Testes

| Arquivo | Antes | Depois | Cobre |
|---|---|---|---|
| `tests/groups-service.spec.ts` | 22 | 25 | +3: defaults expostos, template+hosts customizados, normalização. updateGroupSettings com patch parcial e tenant-scoping. |
| `tests/summary-prompt.spec.ts` | 44 | 50 | +6: templateId path (vars substituídas, voiceMode forçado, version v9-<id>), legacy path preservado, hosts customizados em default-duo. |

**Total: 369 unit tests verde** (`npx vitest run tests/`). Cobertura
do orquestrador `generator.ts` continua via `tests/summary-generator.spec.ts`
(não foi tocado — propaga novos campos transparentemente).

## Decisões de design

1. **Templates separados de tone** — os 5 user templates funcionam como
   substitutos completos do `buildSystemPrompt(tone, voiceMode)`. O `tone`
   continua existindo no schema/API mas só impacta caminho legado (sem
   templateId). Deixei rolar em paralelo pra preservar compatibilidade
   com schedules e summaries antigas.

2. **VoiceMode sobrescrito pelo template** — quando `templateId='rapido'`,
   o template é DUO. Ignorar `voiceMode='single'` evita output inconsistente
   (system pede prefixos `host1:`/`host2:` mas user prompt diz "prosa
   corrida"). O template é a fonte de verdade quando set.

3. **Patch parcial no PATCH** — UI envia só campos modificados. Reduz
   ruído em `updated_at` e nos audit logs. No-op (patch vazio) responde
   sem fazer SQL.

4. **Hosts em todos os templates, mesmo o legado refatorado** — o
   `default-duo` no catálogo virou o systemPrompt antigo COM placeholders.
   Resultado: usuários que mudam só `host1_name`/`host2_name` (sem mudar
   templateId) e que estão no template default ainda veem nomes
   substituídos no output. (O caminho REALMENTE legado, sem templateId,
   continua hardcoded Ana/Beto pra preservar comportamento exato pré-v9.)

5. **`promptVersion` versão bumpou pra v9** — o user prompt agora aceita
   hosts dinâmicos no `textExample` e `formatHints`. Mesmo no caminho
   legado (sem templateId), o user prompt mudou — então a version reflete
   isso. v8 deixou de existir.

## Trade-offs / dívidas

- **Voz TTS hard-coded por convenção** — host1 = feminina (Sadachbia/Leda),
  host2 = masculina (Kore/Puck). A migration documenta isso, mas a UI
  ainda não tem voice picker. Isso é Fase C2 (futuro).
- **Música de fundo por grupo** — descrita no plano original mas
  deferida. Hoje é global em `lib/audios/service.ts`.
- **Card rico (Fase D)** — stats grid (msgs hoje / podcasts gerados /
  último), botões inline Msgs/Duplicar/Recolher — não foram implementados.
  Card atual mostra contagem 24h + template + hosts (suficiente pra MVP
  do follow-up).
- **Modal mobile** — usa `Modal` existente (`components/ui/Modal.tsx`)
  que já é responsivo. Tabs ainda não foram testadas com Playwright em
  mobile — TODO de validação visual.

## Como testar em prod

```bash
set -a; . ./.env.local; set +a
PLAYWRIGHT_BASE_URL=https://podzap.wsmart.com.br \
  npx playwright test e2e/admin-mobile.spec.ts e2e/mobile-audit.spec.ts \
  --workers=2 -g "admin"
```

Manualmente:
1. Abrir `/groups`, clicar "✎ editar" num grupo monitorado.
2. Tab Hosts: trocar Ana por outro nome.
3. Tab Avançado: escolher template "fofoca".
4. Salvar → footer do card atualiza pra "Fofoca e novidades · NovoNome+Beto".
5. Clicar "✨ gerar resumo" — POST direto, redireciona pra /approval.
6. Validar que o resumo gerado tem o estilo do template (dramático, "Gente,
   vocês não vão acreditar...") e usa o nome customizado nas falas.

## Métricas finais

- **+1 componente** (`EditGroupModal`)
- **+1 lib** (`lib/summary/templates.ts`)
- **+1 endpoint** (`PATCH /api/groups/[id]`)
- **9 arquivos modificados** (service, prompt, generator, events, worker,
  api generate, GroupCard, GroupsList, ScheduleList compat)
- **+9 specs Vitest** (3 service + 6 prompt) — 369/369 verde
- **+1 migration** (0017)
- **0 regressões** detectadas — typecheck + build limpos
- **Jornada do usuário**:
  - **Antes**: setup hosts/template não existia. Tom era escolhido toda
    vez no GenerateNowModal.
  - **Agora**: setup uma vez por grupo (modal Editar). "✨ gerar"
    = 1 clique que respeita o setup salvo.

## Próximos passos sugeridos

- **Fase D**: card rico em /groups (stats grid + botões inline + recolher)
  — cosmético/UX, sem novas features.
- **Voice picker per host** (Fase C2): catálogo de vozes Gemini TTS
  expostas como cards visuais com play preview.
- **Música de fundo por grupo** (Fase E): bibliotecar 5-10 tracks +
  picker no tab Avançado.
- **Templates customizados** (Fase F): textarea livre com preview (vars
  substituídas inline) — power-user feature, requer rate-limit no save
  pra evitar prompt injection.
