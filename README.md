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

MVP em desenvolvimento. Fases 0–6 concluídas (fundação, auth+multi-tenancy, conexão WhatsApp via UAZAPI, listagem/seleção de grupos, captura de mensagens via webhook, transcrição multimodal via Groq Whisper + Gemini Vision orquestrada pelo Inngest, pipeline `filter → cluster → normalize`); **Fase 7 (geração do resumo via Gemini 2.5 Pro, com tom configurável, tracking de custo em `ai_calls` e saída em `summaries` com status `pending_review`) em andamento**. Ver [`ROADMAP.md`](./ROADMAP.md) e [`docs/integrations/summary-generation.md`](./docs/integrations/summary-generation.md).
