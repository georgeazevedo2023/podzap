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

MVP em desenvolvimento. Fases 0 (fundação) e 1 (auth + multi-tenancy) concluídas; **Fase 2 (conexão WhatsApp via UAZAPI) e Fase 3 (listagem e seleção de grupos) em andamento**. Ver [`ROADMAP.md`](./ROADMAP.md).
