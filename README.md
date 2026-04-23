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

Next.js 15 · TypeScript · Tailwind · Supabase · Inngest · UAZAPI · Groq · Gemini

---

## 📦 Status

MVP em desenvolvimento. Fases 0–9 concluídas (fundação, auth+multi-tenancy, conexão WhatsApp via UAZAPI, listagem/seleção de grupos, captura de mensagens via webhook, transcrição multimodal via Groq Whisper + Gemini Vision orquestrada pelo Inngest, pipeline `filter → cluster → normalize`, geração do resumo via Gemini 2.5 Pro com tom configurável, tracking de custo em `ai_calls`, aprovação humana com revisão/edição/aprovar/rejeitar/regenerar e sidebar badge de pendentes, TTS via Gemini 2.5 Flash TTS gerando WAV no bucket privado `audios` com signed URL e worker `generate-tts` on `summary.approved`); **Fase 10 (entrega — worker `deliver-to-whatsapp` on `audio.created` envia o WAV via UAZAPI `/send/media` pro grupo original, com retries Inngest 3x + rota `POST /api/audios/[id]/redeliver` rate-limited 6/h/tenant) em andamento**. Ver [`ROADMAP.md`](./ROADMAP.md) e [`docs/integrations/delivery.md`](./docs/integrations/delivery.md).
