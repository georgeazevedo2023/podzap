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
- [ ] Deploy inicial Vercel
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

### Fase 8 — Aprovação humana 🟡 ⭐ (feature principal)
**Objetivo:** usuário edita/aprova/rejeita antes do áudio.

- [ ] Tela aprovação (mockup: `screen_approval.jsx`)
- [ ] Editor de texto rich
- [ ] Botão "regenerar" com novo tom (formal / divertido / corporativo)
- [ ] Status machine: `pending_review → approved / rejected`
- [ ] Notificação quando resumo fica pendente
- [ ] Modos: automático / aprovação opcional / aprovação obrigatória

**Aceite:** fluxo completo de revisão + regeneração funciona.

---

### Fase 9 — TTS (geração de áudio) ⬜
**Objetivo:** resumo aprovado vira arquivo de áudio no Storage.

- [ ] Integração Gemini Speech API
- [ ] Configuração de voz (masculina/feminina) + velocidade
- [ ] Worker `generate-audio`
- [ ] Migration `audios`
- [ ] Upload para Supabase Storage
- [ ] URL assinada para download

**Aceite:** aprovar resumo → áudio MP3 acessível em <3min.

---

### Fase 10 — Entrega ⬜
**Objetivo:** áudio + texto chegam no WhatsApp do usuário/grupo.

- [ ] Envio via UAZAPI (áudio + legenda)
- [ ] Player no dashboard (mockup: `screen_history_schedule.jsx`)
- [ ] Histórico de resumos com download
- [ ] Tela Home com últimos resumos (mockup: `screen_home.jsx`)

**Aceite:** resumo aprovado chega no WhatsApp com áudio + texto.

---

### Fase 11 — Agendamento ⬜
**Objetivo:** resumos gerados automaticamente conforme configuração.

- [ ] Migration `schedules`
- [ ] Tipos: horário fixo / inatividade / janela dinâmica
- [ ] Cron (Inngest scheduled functions)
- [ ] UI configuração por grupo
- [ ] Frequências: diário / semanal

**Aceite:** agendar "todo dia 18h" e receber resumo sem intervenção.

---

## 🧊 Pós-MVP

- **Fase 12:** Personalização avançada (múltiplas vozes, estilos custom)
- **Fase 13:** Dashboard analytics (métricas de uso, retenção)
- **Fase 14:** Clips / highlights (cortes curtos do áudio)
- **Fase 15:** Vídeo resumo
- **Fase 16:** Memória de grupo (contexto entre resumos)
- **Fase 17:** IA conversacional sobre resumos passados
- **Fase 18:** Integração NotebookLM (opcional)

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
