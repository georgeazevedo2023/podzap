# docs/ — índice

Documentação do projeto. **Source of truth visual:** `podZAP/*.jsx` (mockups). **Source of truth de comportamento:** `CLAUDE.md` na raiz + as docs aqui.

## Top-level

- [`MVP-COMPLETION.md`](MVP-COMPLETION.md) — relatório consolidado do MVP 1.0 (timeline, métricas, débitos)

> CLAUDE.md (raiz) menciona `docs/PRD.md` mas o arquivo não está no repo — provavelmente vive fora do versionamento (privado). Source of truth do PRD na prática é o próprio `CLAUDE.md` + `MVP-COMPLETION.md`.

## Subpastas

| Pasta | O que tem | Quando ler |
|---|---|---|
| [`integrations/`](integrations/README.md) | Subsistemas externos: UAZAPI, Gemini, Groq, Inngest, etc. | Tocando em `lib/uazapi/`, `lib/ai/`, workers Inngest |
| [`internals/`](internals/README.md) | Módulos próprios em `lib/`: rate-limit, crypto, encryption, media, stats | Tocando em `lib/` (não-AI) |
| [`api/`](api/README.md) | Catálogo das 34 rotas HTTP + matriz auth/rate-limit | Adicionando rota nova ou debugando 4xx/5xx |
| [`ui-components/`](ui-components/README.md) | Catálogo de componentes UI + tokens CSS | Construindo tela nova; checar antes de criar componente |
| [`audits/`](audits/README.md) | Auditorias por fase + sessões cronológicas | Reconstruindo "por que isso ficou assim?" |
| [`plans/`](plans/README.md) | PLAN.md de cada fase (entrada do GSD) | Histórico de planejamento; raramente lido pós-execução |
| [`deploy/`](deploy/README.md) | Setup Hetzner + Portainer | Subindo nova instância ou debugando deploy |
| `scaffolds/` | Snippets de scaffolding (Tailwind config, components base) | Setup inicial |

## Convenções

- **Ler antes de assumir:** se você está pra fazer algo "óbvio" mas não há doc explicando, é provável que tenha história não-óbvia. Procura no `audits/` por `session-*.md` recentes.
- **Atualizar in-line:** docs em `integrations/` e `internals/` ficam vivas com o código — atualize no mesmo PR que muda comportamento. NÃO escreva append-only "log de mudanças".
- **Sessões em `audits/sessions/`:** quando uma sessão entrega múltiplas mudanças interconectadas, criar `session-YYYY-MM-DD.md`. Detalha o porquê + débitos.
