# Sessão 2026-04-27 (continuação 4) — Pacotes 1-5: rich UX + power user

Continuação direta da Fase B+C do mesmo dia
([`session-2026-04-27-fase-bcd.md`](./session-2026-04-27-fase-bcd.md)). 5
pacotes incrementais que entregaram a UX rica do `/groups` + opções
de power user (free-form prompt, voice picker, música por grupo).

## TL;DR

- **Jornada do podcast on-demand** caiu de 9 cliques (pré-tudo) →
  **~3 cliques** quando o grupo já está configurado: toggle (se
  necessário) → "✨ gerar" → aprovar → enviar (no `/podcasts`).
- **5 commits**, **5 deploys**, 0 rollbacks.
- **5 migrations novas** (0016→0020): defaults, prompt
  template+hosts, prompt_override, voice_ids, background_music.
- **3 catálogos canônicos** novos em `lib/`:
  `summary/templates.ts` (7), `audios/voices.ts` (8), `audios/music.ts` (6).
- **3 modais novos**: `EditGroupModal`, `DuplicateConfigModal`,
  `ScheduleInlineModal`.
- **380 unit tests verde** (`npx vitest run tests/`).

## Pacote 1 — Card rico + tap targets (`abe2b60`)

`/groups` cards monitorados ganharam:

- **Stats grid 3-up**: msgs hoje (lime se ≥10) / podcasts gerados
  (purple se >0) / último (yellow se houver). Servidos por
  `listGroups({withGroupStats: true})` numa query agregada extra
  por página.
- **Ações inline**: ✨ gerar (1-clique) · 📜 histórico (link pra
  `/history?groupId=X`) · ✎ editar · 📋 duplicar · ⏰ agendar.
  Todas com `.btn-tap` (≥44h).
- **Footer config visível**: emoji do template + label + host names +
  período + voiceMode at-a-glance.
- **Recolher state** persistido em `sessionStorage`
  (`groupcard_collapsed:<groupId>`). Recolhido vira 1-line.

Tap targets <44 corrigidos:
- HeroPlayer Rewind/Skip (`/home`): `btn-ghost btn-tap` + minWidth 44.
- HistoryPagination: minWidth 38→44, height 38→44.

## Pacote 2 — Free-form prompt + duplicar (`341fee5`)

**Power user prompt customizado:**

- Migration `0018_group_prompt_override.sql`: `groups.prompt_override`
  (text, 100..6000 chars). NULL = usa template do catálogo.
- `lib/summary/prompt.ts`: prioridade **override > template > legado**.
  Var substitution (`{{group_name}}`/`{{host1_name}}`/`{{host2_name}}`)
  funciona em todos os 3 caminhos. `promptVersion` fica
  `v9-override-<voice>` quando ativo.
- `EditGroupModal` aba Avançado ganha checkbox "⚡ usar prompt
  customizado" + textarea (font mono, 12px, 200h+ resize) + contador
  de chars vermelho fora do range + preview com vars substituídas em
  `<details>`.

**Duplicar config entre grupos:**

- `lib/groups/service.ts::duplicateGroupConfig(tenantId, sourceId,
  targetIds[])`: atômico — falha NOT_FOUND se algum target for de
  outro tenant (sem partial copy). Não toca em
  `is_monitored`/identidade. Copia template, hosts, defaults,
  prompt_override, voice_ids, music.
- `POST /api/groups/[id]/duplicate-config`: validation 1..50 targets.
- `DuplicateConfigModal`: lista grupos monitorados (exclui source) com
  checkboxes purple, "marcar todos", preview do que vai ser copiado +
  estado "feito" com count de updated.

## Pacote 3 — Schedule inline (`1ef20ec`)

`/groups` cards ganham botão **"⏰ agendar"** que abre
`ScheduleInlineModal` — mini-form pra agendar geração diária sem ir
em `/schedule`. Cobre 80% dos casos:

- Frequency: só `daily` (semanal/custom continuam em `/schedule`).
- TriggerType: só `fixed_time`.
- Approval mode: required (default) | optional.
- Tom/voiceMode/template/hosts: herdados do grupo.

Detecta schedule existente automaticamente — vira PATCH ao salvar.
DELETE inline pra remover. `/schedule` continua existindo pra cases
complexos com link explicativo no rodapé do modal.

`/groups/page.tsx` faz pre-fetch do `listSchedules()` e passa um
`Set<groupId>` com schedules ATIVOS via prop, evitando N fetches
client-side. Card mostra **"⏰ ativo"** em verde quando `hasSchedule`.

## Pacote 4 — Voice picker per host (`25eeab9`)

Cada apresentador escolhe sua voz do catálogo Gemini TTS.

- Migration `0019_group_voices.sql`: `voice1_id` (default `Kore`),
  `voice2_id` (default `Charon`). CHECK constraint enumera 8 vozes.
- `lib/audios/voices.ts` (NOVO):

| ID | Gênero | Descrição |
|---|---|---|
| Kore | feminina | warm, mid-pitched (default host1) |
| Leda | feminina | jovial, brilhante |
| Sadachbia | feminina | profissional, clara |
| Aoede | feminina | suave, melódica |
| Charon | masculino | firme, low-pitched (default host2) |
| Puck | masculino | jovem, brincalhão |
| Orus | masculino | ressonante, sério |
| Fenrir | masculino | profundo, dramático |

- `gemini-tts.ts::TtsInput.speakers?` aceita
  `[{speaker, voiceName}]` dinâmico. Quando ausente cai no
  DUO_SPEAKERS legado (Ana=Kore, Beto=Charon) → preserva resumos
  antigos.
- `audios/service.ts`: em mode='duo', fetch group config (host_names
  + voice_ids) via JOIN summaries→groups e passa pro TTS.
  Best-effort: se a query falhar, cai no legado e segue.
- `EditGroupModal::HostsTab` redesenhado: cada host vira card chunky
  (pink pra host1, purple pra host2) com nome + voice picker grid 2-col.
  Recomenda femininas pra host1 e masculinas pra host2 visualmente,
  mas qualquer combinação é aceita.

## Pacote 5 — Música de fundo (`c4d16c5`)

Cada grupo escolhe sua trilha do catálogo.

- Migration `0020_group_background_music.sql`: `background_music`
  (default `default`) com CHECK constraint enumerando 6 IDs.
- `lib/audios/music.ts` (NOVO):

| ID | Label | Status |
|---|---|---|
| none | Sem música | só voz, mais limpo |
| default | Padrão | **arquivo presente** (`assets/podcast-music.mp3`) |
| chillout | Chillout | ⚠️ arquivo pendente |
| upbeat | Upbeat | ⚠️ arquivo pendente |
| epic | Épico | ⚠️ arquivo pendente |
| lofi | Lo-fi | ⚠️ arquivo pendente |

- `audios/service.ts` mixer respeita `musicId='none'` (skip) e cai
  pro default se filePath não existir (track ainda não subida no
  repo) — com warning no console.
- `EditGroupModal::GeralTab` ganha `MusicPicker` — grid auto-fill
  cards yellow-accent com emoji + label + descrição.

## Decisões de design importantes

1. **Patch parcial em todos os PATCHes** — UI envia só campos
   modificados. Reduz ruído em `updated_at` e nos audit logs.
   No-op (patch vazio) responde sem fazer SQL.

2. **Prioridade override > template > legado** — prompt customizado
   tem precedência total sobre templateId. Caminho legado (sem
   templateId nem override) preserva DUO/SOLO_SYSTEM_PROMPT antigo
   pra back-compat.

3. **Hosts dinâmicos no user prompt** mesmo no caminho legado — o
   `buildUserPrompt` substitui Ana/Beto pelos nomes do grupo no
   `textExample`/`formatHints`. System prompt legado mantém Ana/Beto
   hardcoded — pra customização total via legacy, usar
   `templateId='default-duo'` (que tem placeholders).

4. **`promptVersion` v9** versionado pelos 3 caminhos:
   - `v9-override-{voice}` (power user)
   - `v9-{template-id}-{voice}` (template do catálogo)
   - `v9-{voice}-{tone}` (legado)
   Permite tracking + A/B no analytics.

5. **`is_monitored` continua mexido só via `toggleMonitor`** — não
   via `updateGroupSettings` nem via `duplicateGroupConfig`. Mantém
   o fluxo do toggle no card auditável separadamente.

6. **Voice picker é decoupled do template voiceMode** — template
   pode forçar `duo`, mas voice ids continuam editáveis. O TTS
   chama `[{speaker: host_name, voiceName: voice_id}]` derivado
   do grupo, não do template.

## Trade-offs / pendências

- **Tracks de música extras** (chillout/upbeat/epic/lofi): IDs
  gravam no DB mas mixer cai no default — precisa upload de
  `assets/podcast-music-<id>.mp3` em PR separada. Decisão consciente
  pra não atrasar entrega; arquivos são CC0 e do tipo "hunting work"
  fora do escopo desta sessão.
- **Prompt injection via free-form** — campo é PRIVATE pro tenant
  (não vaza), rate limit do `/api/summaries/generate` (10/h/tenant)
  + length cap 6000 chars limitam blast radius. Aceito como risco
  conhecido.
- **/onboarding flake do mobile-audit** — o `sair` chip 40×29 é
  herdado do shell global e não é content-level; classificado como
  cosmético baixa prioridade.
- **Schedule inline cobre só daily fixed-time** — semanal/custom
  continuam em `/schedule`. Modal aponta pra lá quando user precisa.

## Como verificar em prod

Manualmente, em https://podzap.wsmart.com.br:

1. Login → `/groups`.
2. No card de um grupo monitorado, ver:
   - Stats grid 3-up (msgs hoje / podcasts / último)
   - Botões inline (gerar / histórico / editar / duplicar / agendar)
   - Footer com template + hosts + período
3. Click "✎ editar":
   - Tab Geral: tom + formato + janela + **música**
   - Tab Hosts & Vozes: nome host1 + voice picker, nome host2 + voice picker
   - Tab Avançado: template picker + checkbox prompt customizado
4. Click "⏰ agendar" — modal mini-form com horário + approval mode.
5. Click "📋 duplicar" — checkboxes pra outros grupos monitorados.
6. Click "✨ gerar" — POST direto, redireciona pra `/approval`.

Programaticamente:

```bash
set -a; . ./.env.local; set +a
PLAYWRIGHT_BASE_URL=https://podzap.wsmart.com.br \
  npx playwright test e2e/mobile-audit.spec.ts e2e/admin-mobile.spec.ts \
  --workers=2
```

Esperado: 11/11 mobile-audit + 4/4 admin-mobile = 15/15 verdes.

## Métricas finais

| Métrica | Valor |
|---|---|
| Commits nesta rodada | 5 |
| Deploys nesta rodada | 5 |
| Rollbacks | 0 |
| Migrations novas | 5 (0016-0020) |
| Catálogos novos | 3 (templates/voices/music) |
| Modais novos | 3 (Edit/Duplicate/Schedule) |
| Endpoints novos | 2 (PATCH /api/groups/[id], POST /api/groups/[id]/duplicate-config) |
| Unit tests verdes | 380/380 |
| Cliques pra gerar podcast | 9 → ~3 (-66%) |

## Backlog (não atacar sem demanda)

- Upload das tracks chillout/upbeat/epic/lofi pra `assets/`
- Audio preview (play button) no voice picker — requer samples na
  Storage
- Nyquist validation retroativa pra Pacotes 1-5 (`/gsd:validate-phase`)
- Re-rodar review cross-AI (`/gsd:review`) pra capturar regressões
- Templates customizados salvos por tenant (não só por grupo) —
  power user feature
