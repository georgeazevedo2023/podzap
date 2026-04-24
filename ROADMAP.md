# podZAP — Roadmap

Fases organizadas por dependência. Cada fase tem um **objetivo verificável** e critérios de aceite.

Legenda: ⬜ não iniciado · 🟡 em andamento · ✅ concluído · 🧊 pós-MVP

---

## 🎯 MVP — Fases 0 a 10

### Fase 0 — Fundação ✅
**Objetivo:** projeto Next.js rodando, conectado ao Supabase, com deploy funcional.

- [ ] Scaffold Next.js 15 + TS + Tailwind
- [ ] Integrar tokens de `podZAP/tokens.css` ao Tailwind config
- [ ] Criar projeto Supabase (dev)
- [ ] Configurar `.env.local` completo
- [ ] Supabase clients (browser / server / admin)
- [ ] Deploy inicial Hetzner (via stack Portainer)
- [ ] CI básica (typecheck + build)

**Aceite:** `npm run dev` abre tela Home, `supabase.from('tenants').select()` retorna vazio (tabela existe).

---

### Fase 1 — Auth + Multi-tenancy ✅
**Objetivo:** login funcional, usuário vinculado a tenant, RLS bloqueando acesso cruzado.

- [ ] Migrations: `tenants`, `users`, `tenant_members`
- [ ] Policies RLS por tenant
- [ ] Supabase Auth (email/magic link)
- [ ] Signup cria tenant automático
- [ ] Middleware Next.js protege rotas
- [ ] Context/hook `useTenant()`

**Aceite:** dois usuários diferentes não veem dados um do outro. RLS testada.

---

### Fase 2 — Conexão WhatsApp (UAZAPI) ✅
**Objetivo:** usuário conecta instância UAZAPI via QR code e vê status da conexão.

- [ ] Migration `whatsapp_instances`
- [ ] Endpoint criar instância UAZAPI
- [ ] Tela onboarding com QR code (mockup já existe: `screen_onboarding.jsx`)
- [ ] Polling de status (connecting/connected/disconnected)
- [ ] Persistir token da instância encriptado

**Aceite:** conectar um WhatsApp de teste e ver status "connected".

---

### Fase 3 — Listagem e seleção de grupos ✅
**Objetivo:** listar grupos da instância e marcar quais monitorar.

- [ ] Migration `groups`
- [ ] Sync grupos via UAZAPI
- [ ] Tela de grupos (mockup: `screen_groups.jsx`)
- [ ] Toggle "monitorar" por grupo
- [ ] Filtro/busca

**Aceite:** toggles persistem, somente grupos marcados entram no pipeline.

---

### Fase 4 — Captura de mensagens (webhook) ✅
**Objetivo:** receber mensagens em tempo real e salvar no banco.

- [ ] Migration `messages`
- [ ] Endpoint `/api/webhooks/uazapi`
- [ ] Validação de assinatura/secret
- [ ] Parsing de tipos: texto / áudio / imagem
- [ ] Download de mídia para Supabase Storage
- [ ] Deduplicação por `message_id`

**Aceite:** enviar texto/áudio/imagem no grupo → aparece no banco em <5s.

---

### Fase 5 — Transcrição multimodal ✅
**Objetivo:** toda mensagem de áudio/imagem vira texto no banco.

- [ ] Worker Inngest: `transcribe-audio` (Groq Whisper)
- [ ] Worker Inngest: `describe-image` (Gemini Vision)
- [ ] Migration `transcripts`
- [ ] Retry com backoff
- [ ] Tratamento de falha (marcar mensagem como `transcription_failed`)

**Aceite:** 100% das mensagens áudio/imagem têm `transcripts.text` em até 2min.

---

### Fase 6 — Filtro de relevância + agrupamento ✅
**Objetivo:** remover ruído e agrupar mensagens em tópicos coerentes.

- [ ] Filtro: remover "ok", "kkk", stickers, stopwords
- [ ] Priorização: áudios longos, palavras-chave, threads
- [ ] Clusterização por tópico (embeddings opcional, ou só temporal)
- [ ] Agrupamento por grupo + data

**Aceite:** dado um dia de 500 msgs, filtro mantém <30% e agrupa em 3–8 tópicos.

---

### Fase 7 — Geração do resumo ✅
**Objetivo:** LLM produz resumo narrativo estilo podcast.

- [ ] Prompt engineering (tom leve, cita participantes, narrativa fluida)
- [ ] Chamada Gemini 2.5 Pro (fallback GPT-4.1)
- [ ] Migration `summaries`
- [ ] Armazenar versão + prompt + modelo usado
- [ ] Custo tracking por tenant

**Aceite:** resumo de 3–5 min de leitura, cita 2+ participantes, sem hallucination óbvia.

---

### Fase 8 — Aprovação humana ✅ ⭐ (feature principal)
**Objetivo:** usuário edita/aprova/rejeita antes do áudio.

- [ ] Tela aprovação (mockup: `screen_approval.jsx`)
- [ ] Editor de texto rich
- [ ] Botão "regenerar" com novo tom (formal / divertido / corporativo)
- [ ] Status machine: `pending_review → approved / rejected`
- [ ] Notificação quando resumo fica pendente
- [ ] Modos: automático / aprovação opcional / aprovação obrigatória

**Aceite:** fluxo completo de revisão + regeneração funciona.

---

### Fase 9 — TTS (geração de áudio) ✅
**Objetivo:** resumo aprovado vira arquivo de áudio no Storage.

- [ ] Integração Gemini Speech API
- [ ] Configuração de voz (masculina/feminina) + velocidade
- [ ] Worker `generate-audio`
- [ ] Migration `audios`
- [ ] Upload para Supabase Storage
- [ ] URL assinada para download

**Aceite:** aprovar resumo → áudio WAV acessível via signed URL em <3min. (MP3 pós-MVP.)

---

### Fase 10 — Entrega ✅
**Objetivo:** áudio + texto chegam no WhatsApp do usuário/grupo.

- [x] Envio via UAZAPI (áudio + legenda)
- [x] Player no dashboard (`/podcasts`)
- [x] Histórico de resumos com download
- [x] Tela Home com últimos resumos (`/home`)

**Aceite:** resumo aprovado chega no WhatsApp com áudio + texto.

---

### Fase 11 — Agendamento ✅
**Objetivo:** resumos gerados automaticamente conforme configuração.

- [x] Schedules já existe desde migration 0001; service `lib/schedules/service.ts` com CRUD + `dueSchedulesNow`
- [x] Worker cron `*/5m` (`inngest/functions/run-schedules.ts`) emite `summary.requested`
- [x] Modos `approval_mode ∈ {auto, optional, required}`
- [x] API CRUD (`/api/schedules`, `/api/schedules/[id]`)
- [ ] 🟡 UI `/schedule` (backend completo; UI ficou como débito, ver `docs/MVP-COMPLETION.md` §8)
- [x] Frequências: diário / semanal

**Aceite:** agendar "todo dia 18h" (via API) → cron dispara → resumo gerado sem intervenção.

---

## 🎉 MVP 1.0 COMPLETO

Relatório consolidado: [`docs/MVP-COMPLETION.md`](./docs/MVP-COMPLETION.md).

---

## 🧹 Housekeeping pós-MVP

### Fase 12 — Correção visual + superadmin + remove `/health` 🟡 (PASS WITH CONCERNS)

Entregue em 2026-04-22. Ver [`docs/audits/fase-12-audit.md`](./docs/audits/fase-12-audit.md).

- [x] Remover rota `/health` (healthcheck Docker agora em `/`)
- [x] Tema **dark** aplicado em todas as rotas do route group `(app)` via `data-theme="dark"` no wrapper
- [x] Migration `0007_superadmin.sql` + helper `public.is_superadmin()` + script `scripts/set-superadmin.mjs`
- [x] Componentes visuais portados: `PodCover`, `PlayerWave`, `Waveform`, `MicMascot`, `StatCard` em `components/ui/`
- [x] Service layer `lib/stats/service.ts` (`getHomeStats`) com 19 testes novos
- [x] `/home` redesenhada 1:1 com `podZAP/screen_home.jsx` (hero player, stats row, grid últimos eps, 3 painéis sidebar)
- [ ] 🧊 Criar `/settings` e migrar conteúdo do antigo `SettingsCard` (removido da home nesta fase)
- [ ] 🧊 `HeroPlayer` refetch de signed URL antes de expirar (hoje `<audio>` quebra após 1h)
- [x] GenerateQuickCard: modal inline com grupo + tom + janela (24h/7d), POST `/api/summaries/generate`, redireciona pra `/approval` — componentes base criados: `components/ui/{Modal,Select,RadioPill}.tsx`
- [x] Expandir policies RLS relevantes com `or public.is_superadmin()` (entregue na Fase 13 para `tenants`, `tenant_members`, `whatsapp_instances`)
- [x] Admin panel `/admin` — entregue na Fase 13 (dashboard + APIs + layout)

---

### Fase 13 — Admin-managed tenancy ✅ (PASS WITH CONCERNS)

Entregue em 2026-04-23. Ver [`docs/audits/fase-13-audit.md`](./docs/audits/fase-13-audit.md) + guia [`docs/integrations/admin-management.md`](./docs/integrations/admin-management.md).

- [x] Migration `0008_admin_managed.sql` — drop trigger `on_auth_user_created`, `UNIQUE(tenant_id)` em `whatsapp_instances`, coluna `tenants.is_active`, policies SELECT com bypass superadmin
- [x] Login reescrito para email+senha (`signInWithPassword`) — dark theme
- [x] `proxy.ts` gateia `/admin/*` com check de `superadmins`
- [x] `lib/tenant.ts::requireSuperadmin()` helper
- [x] `lib/admin/tenants.ts` + `lib/admin/users.ts` + `lib/admin/uazapi.ts` com CRUD + rollback em createUser
- [x] APIs `/api/admin/{tenants,users,uazapi}/*` completas
- [x] Route group `app/(admin)/` dark theme + `AdminSidebar` + dashboard `/admin`
- [x] Páginas `/admin/tenants` (+ `[id]`, `/new`), `/admin/users`, `/admin/uazapi` com tabelas e modais chunky
- [x] `/onboarding` ajustado: empty state "contate o admin" quando sem instância
- [ ] 🧊 Email de notificação ao criar user
- [ ] 🧊 Audit log de ações do superadmin
- [ ] 🧊 `/forgot-password` self-service
- [ ] 🧊 Modal chunky substituindo `window.confirm`
- [ ] 🧊 Deletar rota deprecated `POST /api/whatsapp/connect` + server action `startConnectAction`

---

## 🧊 Pós-MVP (backlog PRD)

- **Fase 14:** UI admin completa + email transacional + audit log + password self-reset (ver Fase 13 débitos)
- **Fase 15:** Personalização avançada (múltiplas vozes, estilos custom)
- **Fase 16:** Dashboard analytics (métricas de uso, retenção)
- **Fase 17:** Clips / highlights (cortes curtos do áudio)
- **Fase 18:** Vídeo resumo
- **Fase 19:** Memória de grupo (contexto entre resumos)
- **Fase 20:** IA conversacional sobre resumos passados
- **Fase 21:** Integração NotebookLM (opcional)

---

## 📊 Métricas de sucesso (PRD §16)

- Resumos gerados / semana
- Taxa de aprovação (aprovados / gerados)
- Tempo médio de escuta
- Retenção 30 dias

---

## ⚠️ Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Limite de API WhatsApp (UAZAPI) | Rate limit interno + fila de retry |
| Transcrição ruim em áudios baixa qualidade | Fallback: avisar usuário + manter áudio original |
| Ambiguidade de contexto | Aprovação humana resolve |
| Custo de IA (Gemini/Groq) | Tracking por tenant + tier de plano limitando volume |
| LGPD / privacidade das mensagens | Criptografia + retenção configurável + consent explícito |
