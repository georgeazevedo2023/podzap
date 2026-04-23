# 🎙 podZAP

> Transforme caos de mensagens em um podcast inteligente — com controle humano antes da publicação.

SaaS multi-tenant que converte conversas de grupos do WhatsApp em resumos em áudio estilo podcast, com aprovação humana opcional antes do envio.

---

## 📚 Docs

- [`CLAUDE.md`](./CLAUDE.md) — contexto do projeto (stack, arquitetura, convenções)
- [`ROADMAP.md`](./ROADMAP.md) — fases e status de implementação
- [`docs/PRD.md`](./docs/PRD.md) — PRD completo
- [`podZAP/`](./podZAP/) — mockups de design (source of truth visual)

---

## 🚀 Quickstart

```bash
# 1. Clonar e instalar
git clone <repo>
cd podzap
npm install

# 2. Configurar env
cp .env.example .env.local
# preencha os valores (ver seção "Como preencher o .env" no CLAUDE.md)

# 3. Rodar
npm run dev
```

---

## 🛠 Stack

Next.js 16 · TypeScript · Tailwind v4 · Supabase · Inngest · UAZAPI · Groq · Gemini

**Deploy:** Hetzner + Portainer (Docker stack). Ver [`docs/deploy/hetzner-portainer.md`](./docs/deploy/hetzner-portainer.md).

---

## 📦 Status — MVP 1.0 completo 🎉

**Fases 0–11 concluídas em 2026-04-22.** Pipeline end-to-end funcionando do webhook ao WhatsApp, com agendamento automático:

- **Fundação + auth/RLS**: multi-tenancy via RLS em 10 tabelas, Supabase Auth com magic link, trigger `handle_new_user`.
- **WhatsApp (UAZAPI)**: QR code + polling de status, criptografia AES-256-GCM dos tokens de instância, sync de grupos com toggle monitor preservado.
- **Captura + transcrição**: webhook idempotente com SSRF guards + MIME sniff, Storage bucket `media`, workers Inngest `transcribe-audio` (Groq Whisper) + `describe-image` (Gemini Vision).
- **Pipeline + resumo**: `filter → cluster → normalize` rule-based, resumo via Gemini 2.5 Pro com tons `formal | fun | corporate`, tracking de custo em `ai_calls`.
- **Aprovação humana** (feature principal): revisar/editar/aprovar/rejeitar/regenerar com state machine `pending_review → approved | rejected`.
- **TTS + entrega**: Gemini 2.5 Flash TTS → WAV no bucket `audios`, worker `deliver-to-whatsapp` envia PTT no grupo original via UAZAPI com caption opcional, retries + redeliver manual.
- **Agendamento**: worker `run-schedules` cron `*/5m` dispara resumos automáticos conforme `schedules`, com modos `auto | optional | required`.

**Métricas**: 246 testes passando (21 spec files), 23 rotas de API, 10 workers Inngest, 6 migrations, ~29.447 LOC.

**Relatório completo**: [`docs/MVP-COMPLETION.md`](./docs/MVP-COMPLETION.md) — timeline, arquitetura, features shipadas, débitos priorizados, checklist de deploy, métricas do PRD §16.

**Pendente validação humana** (não automatizável): escanear 1 QR real, gerar 1 resumo com custo real observado, receber 1 áudio real no WhatsApp.

Ver também [`ROADMAP.md`](./ROADMAP.md), [`CLAUDE.md`](./CLAUDE.md) e os 11 audits em [`docs/audits/`](./docs/audits/).
