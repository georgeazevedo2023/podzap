# Sessão 2026-04-24 — resumo consolidado pré-/clear

Esta doc consolida todas as mudanças shipadas nesta sessão pra servir
de retomada depois do `/clear`. Ordem cronológica dos issues reportados
pelo user, o fix correspondente e o estado final em prod.

---

## 1. Duo podcast Ana+Beto (encerramento do ciclo anterior)

**Gatilho:** user queria o podcast em formato duo (1 masc + 1 fem)
conversando natural, achou o v2 solo "muito sério".

**Entregue (pré-sessão):** migration 0010 (`summaries.voice_mode`),
prompt v3 SOLO+DUO, TTS `multiSpeakerVoiceConfig` (Kore+Charon), UI
modal com `voiceMode` default duo.

**Neste ciclo:** rodei e2e contra prod (`e2e/generate-flow.spec.ts`),
colhi signed URL do WAV `ce1a6062...` (188s, duo confirmado via DB:
`voice_mode='duo'`, `prompt_version='podzap-summary/v3-duo-fun'`).
Doc: `docs/audits/duo-podcast-progress-2026-04-24.md`.

---

## 2. Remoção de `approval_mode='auto'`

**Gatilho:** user disse "só envie para o grupo após aprovação manual
do admin via UI". Schedules com `approval_mode='auto'` eram o único
caminho que violava isso.

**Fix (commit `2dedcba`):**
- **Migration 0011**: update existing `auto` rows pra `required` + CHECK
  constraint `approval_mode <> 'auto'`. Enum DB mantém o valor
  (Postgres não dropa enum value in-place), mas writes falham.
- zod schemas em `/api/schedules/*` aceitam só `optional|required`
- UI `ScheduleForm` removeu a opção "automático"
- `ScheduleCard` removeu o pill "auto"
- `inngest/events.ts` dropou `autoApprove?` do `summary.requested`
- `generate-summary` worker removeu a branch auto-approve, retorno
  virou `{ summaryId }` simples
- `run-schedules` nunca emite `autoApprove`
- `lib/summaries/service.ts#autoApproveSummary` deletada (dead code)

---

## 3. Prompt evolui v3 → v4 → v5 → v6

**v4 (commit `87c5100`)** — hora real + cues de animação inline
- User apontou: "boa noite" sendo dito às 9h da manhã
- Áudio TTS saía flat/desanimado
- Fix: `buildSummaryPrompt` aceita `now?: Date` (default `new Date()`)
- Saudação calculada por hora SP: 5-11h bom dia, 12-17h boa tarde, 18-4h boa noite
- System prompt instrui cues `(animada)`, `(rindo)`, `(empolgado)`, `(surpreso)`
- `gemini-tts.ts buildPromptText` duo mode pré-pendeu instrução pra ler
  as marcações como estilo (não ler em voz alta)

**v5 (commit `6197fc2`)** — framing "aqui" em vez de "por lá"
- User apontou: "tivemos por lá" é esquisito porque o áudio toca
  DENTRO do grupo (ouvintes são a galera citada)
- Fix: bloco "CONTEXTO DE PÚBLICO" no SOLO e DUO banindo "por lá",
  "naquele grupo", "essa galera" — preferir "aqui", "a gente", "vocês"
- Few-shot example do DUO reescrito com "Dia agitado por aqui"

**v6 (commit `7706a87`)** — caption emoji-rich separada do roteiro
- User pediu legenda no estilo:
  ```
  🎙 A HORA MAIS AGUARDADA DO DIA CHEGOU! 🎙
  ✨Nosso PODCAST Diário✨
  > 🔥 Tudo que rolou de mais importante...
  ```
- Antes o delivery mandava o roteiro de 800 palavras como caption —
  poluía o grupo
- Fix:
  - **Migration 0013**: `summaries.caption text` nullable
  - `gemini-llm.ts`: `SummaryResult.caption`, responseSchema exige
    caption, parser best-effort (null se malformado)
  - `generator` + `SummaryRecord` + `SummaryView` expõem caption
  - `delivery/service.ts`: usa `summary.caption ?? summary.text` (fallback
    pra rows pré-v6)
  - `/approval/[id]` SummaryEditor mostra preview da legenda acima do
    roteiro (white-space: pre-wrap)

---

## 4. Delivery desacoplado de approve (URGENTE)

**Gatilho:** user clicou aprovar no `/approval/[id]` pensando que era
preview, o sistema entregou no grupo (`/deliver-to-whatsapp` worker
escutava `audio.created`). Screenshot mostrando áudio já no grupo.
User: "mais uma vez vc postou no grupo sem minha autorizacao manual".

**Fix (commit `14af204`):**
- Desregistrei `deliverToWhatsappFunction` em `app/api/inngest/route.ts`.
  Evento `audio.created` continua sendo emitido, ninguém escuta.
- Único caminho: `POST /api/audios/[id]/redeliver` chamado pelo botão
  manual em `/podcasts`. Síncrono (UAZAPI + DB update antes de responder).
- Badge `DeliveryBadge`: "🔒 aguardando autorização" (lime) em vez do
  enganoso "enviando…" amarelo pulsante.
- `RedeliverButton` vira primário `.btn-zap` "📤 enviar ao grupo" quando
  `!delivered`, com confirmação em 2 cliques (5s window). Quando
  `delivered=true` vira secundário `.btn-ghost` "↻ reenviar".
- Copy do approve: "✓ aprovar (gera áudio)" + tooltip "nada vai pro
  grupo até você clicar 'enviar ao grupo' em /podcasts"

**Memory:** `delivery_requires_manual_approval.md` endurecida — "aprovar ≠
autorizar envio". Dois cliques separados.

---

## 5. Dropdown "mandar no zap" — 4 destinos + portal

**Gatilho 1:** user notou botão "mandar no zap" no HeroPlayer era
decorativo (só hover, sem onClick).
**Gatilho 2:** pediu poder escolher destino: grupo / eu / contato / só escutar.
**Gatilho 3:** primeiro fix ficou invisível porque HeroPlayer tem
`overflow: hidden` que clippava o dropdown.

**Fix (commits `d292b00` + `a3b2fbb`):**
- Novo `components/ui/SendToMenu.tsx` — dropdown + 2 modais (cadastro
  de telefone, input contato). Usado em:
  - HeroPlayer (`/home`)
  - `/podcasts` DeliveryControls
  - `/approval/[id]` DeliveryStatus
- **Portal** via `createPortal` pra `document.body`. Dropdown, toast e
  modais posicionados via `getBoundingClientRect` do botão âncora
  (`position: fixed`). `z-index: 10000/10001`. Escapa qualquer clip.
- 4 itens: 🔊 Só escutar | 👥 Grupo de origem (destrutivo, vermelho) |
  📱 Enviar pra mim | 👤 Outro contato (digita número)

**Backend (commit `d292b00`):**
- **Migration 0012**: `tenant_members.phone_e164 text` nullable + CHECK
  regex E.164
- `lib/profile/phone.ts`: normalizePhoneBR (aceita `11 99999-9999`,
  `+5511...`, `5511...`, `(11) ...`), phoneToWhatsappJid, getMemberPhone,
  setMemberPhone
- `lib/delivery/target.ts`: `resolveTargetJid({target, contactPhone, groupId})`
  mapeia UI → JID UAZAPI
- `lib/delivery/service.ts`: `runDelivery.targetJidOverride`. Semântica
  importante: **`delivered_to_whatsapp=true` só quando destino foi o GRUPO**
  — envios pra "mim" ou contato avulso não alteram o row (badge é
  específico de grupo).
- `/api/audios/[id]/redeliver` aceita body `{ target, jid? }`, default
  `group` (backward compat)
- Nova API `GET/PATCH /api/me/phone` pro perfil

**Confirmado por Playwright:** `e2e/audit-home-dropdown-logo.spec.ts`
ariaExpanded false→true, menuVisible, 4 items corretos, zero console
errors.

---

## 6. Favicon próprio

**Gatilho:** console 404 do `/favicon.ico` + user pediu pra usar o
logo.

**Fix (commit `a3b2fbb`):**
- `app/icon.tsx` (32×32) e `app/apple-icon.tsx` (180×180) renderizam
  via `next/og` SVG com a arte do logo (quadrado roxo rotacionado -4°
  + microfone 🎙). Next 15 auto-wire nas meta tags.

---

## 7. Hero + botão criar em `/podcasts`

**Gatilho:** user queria /podcasts moderno/divertido como /home + botão
pra criar novo podcast direto dali.

**Fix (commit `a3b2fbb`):**
- Novo `app/(app)/podcasts/PodcastsHero.tsx` — card roxo gradient +
  blobs decorativos, chips de stats (episódios / minutos / grupos),
  botão primary lime **"✨ criar novo podcast"** abre `GenerateNowModal`
  (reusado de `/home`), mascot column com mic + sticker "🔥 HOJE"

---

## 8. Fontes self-hosted via next/font

**Gatilho:** user reportou logo diferente do protótipo standalone.
Auditoria Playwright revelou `computedFontFamily='Archivo Black,...'`
mas `document.fonts=[]` — o `@import url(fonts.googleapis.com)` em
`globals.css` não carregava em prod (talvez CSP/CDN), caindo em
system-ui → logo genérica.

**Fix (commit `4004a80`):**
- `app/layout.tsx`: importa `next/font/google` pra Archivo_Black,
  Bricolage_Grotesque, Space_Grotesk, JetBrains_Mono — self-hosted no
  build, expõe CSS vars (`--font-brand-archivo`, etc).
- `globals.css`: aliases semânticos (`--font-brand`, `--font-display`,
  `--font-body`, `--font-mono`) consomem via `var(...)`. @import do
  Google Fonts removido.

---

## 9. Groups: search por JID + nomes vazios + subtitle + preserve edits

**Gatilho:** user buscou "mestre" e o grupo `120363418680072145@g.us`
não apareceu. Subtitle mostrava "4 monitorados de 0" (absurdo).

**Diagnóstico em 3 camadas:**
1. UAZAPI retorna `Name: ""` pra 22+ grupos >900 membros (grupos com
   emoji no subject, communities, anúncios oficiais)
2. Sync gravava empty string direto — `g.name ?? g.jid` só cobre
   null/undefined
3. Busca só olhava `name`, não `uazapi_group_jid`
4. Subtitle usava `groupsPage.total` (filtrado) em vez do total global

**Fix (commits `f21417f` + `c4d0c1a`):**
- **Migration 0014**: backfill `UPDATE groups SET name = uazapi_group_jid
  WHERE name IS NULL OR btrim(name) = ''`. 152 rows atualizadas em prod.
- `syncGroups`: `trimmedName.length > 0 ? trimmedName : g.jid` (trata
  empty como missing)
- `listGroups`: `.or(name.ilike.%q%,uazapi_group_jid.ilike.%q%)` pra
  busca
- `/groups` page: query sem filtro pro total real, subtitle contextual
  ("4 bate com 'mestre' · 4 monitorados no total" / "4 monitorados de 704")
- **Preserve admin edits** (`c4d0c1a`): sync agora não sobrescreve nome
  meaningful quando UAZAPI devolve vazio. Lógica:
  - UAZAPI tem nome → sempre usa (fonte autoritativa)
  - UAZAPI vazio + existing meaningful (≠JID) → preserva
  - UAZAPI vazio + existing vazio/JID → JID fallback
- Preload inclui `name` pro check

**Ação manual:** UPDATE direto no DB setando name="Mestres do Lovable - Oficial 💜",
is_monitored=true, member_count=1023 pro grupo `a1dc1fad-...`.

---

## 10. Contagem 24h + botão "gerar resumo" em /groups

**Gatilho:** user pediu saber quantas mensagens cada grupo tem hoje
e poder gerar resumo direto do card.

**Fix (commit `05385b0`):**
- `GroupView.recentMessageCount?: number | null`
- `listGroups({ withRecentMessageCount: true })` faz UMA query agregada
  em `messages` pelos ids da página (O(1) extra roundtrip, não N).
  Count in-memory.
- `GroupCard`: linha dashed nova com "💬 N msgs (24h)" (lime quando
  ≥10, dim quando 0). Botão "✨ gerar resumo" só quando
  `is_monitored && 24h >= 3`, abre `GenerateNowModal` com
  `initialGroupId` pré-selecionado.
- `GroupsList`: state `generateGroupId`, modal rendered inline

---

## Migrations aplicadas em prod nesta sessão

| # | Arquivo | Efeito |
|---|---|---|
| 0011 | `no_auto_approval_mode.sql` | CHECK bloqueia `approval_mode='auto'` |
| 0012 | `member_phone.sql` | `tenant_members.phone_e164` nullable + regex E.164 |
| 0013 | `summary_caption.sql` | `summaries.caption text` nullable |
| 0014 | `backfill_empty_group_names.sql` | 152 rows com name vazio → JID |

---

## Prompt version atual em prod

**`podzap-summary/v6-<single|duo>-<formal|fun|corporate>`**

Características:
- Hora atual SP injetada, saudação correta pelo horário
- Cues de animação `(animada)`, `(rindo)` etc inline
- Framing "aqui" (não "por lá") — insider
- Caption emoji-rich separada do roteiro (4-7 linhas, template do user)
- Sem auto-referência ao podZAP/plataforma
- Solo = prose corrida, Duo = linhas `Ana:` / `Beto:` pra multi-speaker TTS

---

## Regras comportamentais (em memory permanente)

- **Delivery exige clique humano específico** (`delivery_requires_manual_approval.md`):
  aprovar ≠ autorizar envio. 2 cliques: approve gera áudio,
  "📤 enviar ao grupo" em /podcasts publica.
- **Schedules `auto` bloqueados** (DB CHECK). Criar schedule default
  deve ser `required`.
- **Playwright specs em prod** devem NUNCA disparar delivery
  automaticamente — aprovar e parar em /podcasts.

---

## Estado pós-última ação

- Resumo do **Mestres do Lovable** disparado via
  `e2e/trigger-lovable-summary.spec.ts` — status 202 dispatched,
  período 24h (27 msgs), tone fun, voiceMode duo. Deve ter chegado
  em `/approval` como pending_review.
- Todos os commits pushed em main, CI verde em todos, Portainer
  redeploy 204 no último (`05385b0`).

## Fluxo end-to-end atual em prod

```
/home OU /groups (botão no card) OU /podcasts (hero)
       ↓ modal "gerar resumo agora"
POST /api/summaries/generate (202)
       ↓ Inngest summary.requested
generate-summary worker → Gemini 2.5 Pro (v6)
       ↓ INSERT summaries status=pending_review
/approval/[id]  ← admin revisa texto + legenda
       ↓ clica "✓ aprovar (gera áudio)"
POST /api/summaries/[id]/approve → emit summary.approved
       ↓
generate-tts worker → Gemini TTS → INSERT audios + upload WAV
       ↓ (NÃO dispara delivery — worker desregistrado)
/podcasts  ← admin escuta preview, decide
       ↓ clica "📤 enviar" → dropdown
       ├─ 🔊 Só escutar        (no-op)
       ├─ 👥 Enviar ao grupo    (confirma 2 cliques)
       ├─ 📱 Enviar pra mim     (phone cadastrado)
       └─ 👤 Outro contato       (digita número)
POST /api/audios/[id]/redeliver  { target, jid? }
       ↓ síncrono: resolveTargetJid → UAZAPI /send/media → DB update
Toast verde "Enviado ao grupo / pra você / ao contato"
```

## Commits desta sessão (ordem)

```
05385b0 feat(groups): contagem 24h + gerar resumo direto do card
c4d0c1a fix(groups/sync): preserva nome editado manualmente
f21417f fix(groups): busca casa JID + backfill + subtitle
7706a87 feat(caption): prompt v6 gera legenda emoji-rich
a3b2fbb fix(ui): dropdown via Portal + favicon + hero em /podcasts
d292b00 feat(delivery): dropdown de destinos
4004a80 fix(fonts): self-host via next/font
14af204 fix(delivery): desacoplar aprovação de envio (URGENTE)
6197fc2 feat(prompt): v5 — framing 'aqui'
87c5100 feat(prompt): v4 — hora atual + cues de animação
2dedcba feat(schedules): remove approval_mode='auto'
c0665aa docs: encerra ciclo duo podcast
```
