# Pipeline de normalização (Fase 6)

> Referência de engenharia para o pipeline `filter → cluster → normalize` que
> transforma mensagens + transcripts crus em uma `NormalizedConversation`
> pronta pra alimentar o LLM da Fase 7.
>
> Plano de implementação: [`docs/plans/fase-6-plan.md`](../plans/fase-6-plan.md).
> Código atual: `lib/pipeline/filter.ts` (cluster + normalize em andamento).

---

## Overview

A Fase 5 deixa o banco com **mensagens** (`messages`) e **transcrições**
(`transcripts`) — texto bruto + áudios transcritos + descrições de imagens.
Para a Fase 7 pedir um resumo coerente pro LLM, precisamos primeiro:

1. **Filtrar** o ruído conversacional (`ok`, `kkk`, stickers, emoji-only, URL-only).
2. **Pontuar** o que sobra por relevância (peso `[0, 1]`).
3. **Agrupar** o texto restante em tópicos coerentes (gap temporal + overlap de participantes).
4. **Empacotar** tudo em uma `NormalizedConversation` (tenant + grupo + período
   + tópicos), que é a unidade que vai pro prompt.

Por design, **tudo é rule-based**. Embeddings e clustering semântico ficam
pós-MVP — a meta é ter um pipeline determinístico, testável e rápido primeiro.

---

## Architecture diagram

```
┌──────────────────┐        ┌────────────────────┐
│   messages       │        │    transcripts     │
│ (captured raw)   │        │ (Groq / Gemini)    │
└────────┬─────────┘        └──────────┬─────────┘
         │                             │
         └─────────────┬───────────────┘
                       │ LEFT JOIN on message_id
                       ▼
             ┌────────────────────┐
             │  buildNormalized   │  lib/pipeline/normalize.ts
             │    Conversation    │  (orchestrator)
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │  filterMessages    │  lib/pipeline/filter.ts
             │  (drop + weight)   │  → NormalizedMessage[]
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │  clusterByTopic    │  lib/pipeline/cluster.ts
             │  (temporal split)  │  → Topic[]
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────────┐
             │ NormalizedConversation │ ready for LLM (Fase 7)
             └────────────────────────┘
```

Todas as camadas são **puras** (sem IO) exceto `buildNormalizedConversation`,
que faz uma query com o **admin client** (bypass RLS — tenant_id é passado
explicitamente). A função orquestradora é a única que toca o banco.

---

## Filter rules

Arquivo: `lib/pipeline/filter.ts`. Export público: `filterMessages(input, opts?)`.

### Drop rules (descarte total)

Mensagens são **descartadas** (não apenas com peso zero) quando atendem
qualquer uma destas condições:

| # | Regra                                                                              | Exemplo            |
|---|------------------------------------------------------------------------------------|--------------------|
| 1 | `type === 'other'` com `"sticker"` no content                                      | figurinha          |
| 2 | Content trim < 3 chars **e** sem mídia anexada                                     | `".."`             |
| 3 | Stopword exata (após trim + lowercase)                                             | `ok`, `kkk`, `👍`  |
| 4 | Regex de URL-only (sem mídia)                                                      | `https://foo.bar`  |
| 5 | Regex de emoji-only (sem mídia)                                                    | `🔥🔥🔥`           |
| 6 | `weight < opts.minWeight` (default `0`, ou seja nada é podado por esta regra)      | —                  |

`mediaUrl !== ""` ou `type ∈ {audio, image, video}` conta como "tem mídia" e
**protege** a linha das regras 2/4/5 (porque uma foto sem legenda ainda
carrega informação após a descrição do Gemini Vision).

### Stopwords list (PT-BR)

Matched contra o content inteiro (trim + lowercase). Não é substring match:
`"ok entendi"` sobrevive; `"ok"` sozinho morre.

```
ok · kkk · kkkk · kk · k · rsrs · rs · haha · hahaha · haheha
uhum · aham · sim · não · nao · 👍 · vlw · vlww
```

---

## Weight computation

Base = **`0.3`**. Os boosts somam (não multiplicam) e o resultado é clamped a
`[0, 1]`.

```
weight(msg) = clamp01(
    0.30                                    // base
  + 0.30 * (type === 'audio' && duration > 20s)
  + 0.15 * (trim.length > 100)
  + 0.15 * (trim endsWith '?')
  + 0.30 * (contém keyword ∈ KEYWORDS)      // no máximo 1 vez
  + 0.10 * (type ∈ {image, video})          // visual media
)
```

`KEYWORDS` (substring, case-insensitive):

```
decisão · decisao · atenção · atencao · importante · reunião · reuniao
prazo · problema · erro · falha · bug · deadline · urgente
pedido · proposta · contrato
```

**Design note:** áudio curto (`<= 20s`) não ganha boost de duração, mas
também não é descartado — geralmente é uma resposta rápida que pode ou não
ser útil. O LLM decide no final.

---

## Cluster algorithm

Arquivo: `lib/pipeline/cluster.ts` (em implementação). Export público:
`clusterByTopic(messages, opts?) → Topic[]`.

Algoritmo determinístico, em um único pass:

1. **Ordena** `messages` por `at` ascendente.
2. Inicializa `currentTopic = null`.
3. Para cada mensagem `m`:
   1. **Se** não há `currentTopic` → abre um novo tópico com `m` dentro.
   2. **Senão**, calcula:
      - `gap = m.at - currentTopic.endAt` em minutos.
      - `jaccard = |participants(current) ∩ {m.sender}| / |participants(current) ∪ {m.sender}|`.
   3. **Se** `gap > opts.gapMinutes` **OU** `jaccard < 0.3` → fecha o tópico
      atual, abre um novo.
   4. **Senão** → anexa `m` ao tópico atual, atualiza `endAt` e
      `participants`.
4. Depois do pass principal, para cada tópico extrai **3 a 5 keywords
   dominantes**: top tokens alfanuméricos com `len > 4`, excluindo
   stopwords do filtro.
5. Retorna `Topic[]`, em ordem cronológica.

### Opções

| Opção          | Default | Efeito                                                           |
|----------------|---------|------------------------------------------------------------------|
| `gapMinutes`   | `30`    | Silêncio maior que isso quebra o tópico                          |
| `minJaccard`   | `0.3`   | Overlap de participantes abaixo disso também quebra              |
| `maxKeywords`  | `5`     | Teto de keywords extraídas por tópico                            |

---

## API

### `filterMessages`

```ts
import { filterMessages, type FilterInput } from "@/lib/pipeline/filter";

function filterMessages(
  input: FilterInput,
  opts?: { minWeight?: number },
): { kept: NormalizedMessage[]; discarded: number };
```

Pura, sem IO. `input` já vem JOIN'ado com `transcripts`
(`transcriptText: string | null`). Ordem de `kept` mirrors a ordem de input.

### `clusterByTopic`

```ts
import { clusterByTopic } from "@/lib/pipeline/cluster";
import type { NormalizedMessage } from "@/lib/pipeline/filter";

function clusterByTopic(
  messages: NormalizedMessage[],
  opts?: {
    gapMinutes?: number;
    minJaccard?: number;
    maxKeywords?: number;
  },
): Topic[];
```

Pura, sem IO. Idempotente: mesma entrada → mesma saída.

### `buildNormalizedConversation`

```ts
import { buildNormalizedConversation } from "@/lib/pipeline/normalize";

function buildNormalizedConversation(
  tenantId: string,
  groupId: string,
  periodStart: Date,
  periodEnd: Date,
  opts?: {
    minWeight?: number;
    gapMinutes?: number;
    minJaccard?: number;
  },
): Promise<NormalizedConversation>;
```

A **única** função com side-effects: usa o admin client pra carregar
`messages LEFT JOIN transcripts` no range pedido, filtrando por `tenant_id`
e `group_id`, e delega o resto pras funções puras.

### Tipos

```ts
type NormalizedMessage = {
  id: string;
  senderName: string;
  at: Date;
  type: "text" | "audio" | "image" | "video" | "other";
  content: string;   // transcriptText ?? messages.content ?? ""
  weight: number;    // [0, 1]
  hasMedia: boolean;
};

type Topic = {
  id: string;               // hash estável (sha1 dos message ids)
  startAt: Date;
  endAt: Date;
  messages: NormalizedMessage[];
  participants: string[];
  dominant_keywords: string[];
};

type NormalizedConversation = {
  tenantId: string;
  groupId: string;
  groupName: string;
  periodStart: Date;
  periodEnd: Date;
  topics: Topic[];
  discarded: number;  // quantas msgs o filter cortou
  total: number;      // n total de msgs no período (antes do filter)
};
```

---

## Dev usage: `/pipeline-preview`

Rota dev-only (`NODE_ENV !== 'production'`). Ferramenta de inspeção manual
antes da Fase 7 existir.

**Fluxo**:

1. Acessa `/pipeline-preview` em dev.
2. Form: `select` de grupo (populado via `groups` do tenant logado) + date
   range picker.
3. Submit → chama `buildNormalizedConversation` server-side.
4. Render:
   - **Stats**: `total`, `discarded`, `n_topics`.
   - **JSON pretty** da `NormalizedConversation` inteira.
   - **Tabela** por tópico: `startAt | endAt | participants | keywords | n_msgs`.

**Guard**: a route module faz `if (process.env.NODE_ENV === 'production') notFound()` no top level — 404 em prod, zero surface de ataque.

Chamada programática equivalente (ex.: script):

```ts
import { buildNormalizedConversation } from "@/lib/pipeline/normalize";

const conv = await buildNormalizedConversation(
  tenantId,
  groupId,
  new Date("2026-04-21T00:00:00-03:00"),
  new Date("2026-04-22T00:00:00-03:00"),
);
console.log(JSON.stringify(conv, null, 2));
```

---

## Performance notes

### Volume esperado

- **Tenant típico**: ~10 grupos monitorados, média de 500 msgs/dia por grupo
  ativo → ~5.000 msgs/dia por tenant.
- **Janela de resumo**: 1 dia. O filtro esperado corta ~70% → ~150 msgs
  sobrevivem por grupo → 3–8 tópicos (plan §"Critério de aceite").

### Queries e índices

`buildNormalizedConversation` emite uma única query:

```sql
SELECT m.*, t.text AS transcript_text, t.type AS transcript_type
FROM messages m
LEFT JOIN transcripts t ON t.message_id = m.id
WHERE m.tenant_id = $1
  AND m.group_id = $2
  AND m.captured_at >= $3
  AND m.captured_at <  $4
ORDER BY m.captured_at ASC;
```

Índice usado: **`messages (group_id, captured_at DESC)`** (já criado na
Fase 4). Custo esperado: <50ms pra janelas de 1 dia em grupos ativos.

### Custo computacional

- `filterMessages`: O(n), regex simples, ~1μs por mensagem.
- `clusterByTopic`: O(n) — single pass + extração de keywords que é
  O(n·k) com `k` pequeno.
- `buildNormalizedConversation` (total): dominado pela query de banco.

---

## Tuning

### `gapMinutes` (default `30`)

Controla quando um silêncio vira fronteira de tópico.

| Valor        | Quando usar                                                       |
|--------------|-------------------------------------------------------------------|
| `10–15`      | Grupos muito ativos (vendas, suporte), conversas rápidas          |
| `30` (default) | Grupos padrão, discussões de trabalho                           |
| `60–120`     | Grupos assíncronos, família, poucos participantes, baixa cadência |

Sintoma se muito baixo: fragmentação (20+ tópicos num dia). Sintoma se
muito alto: um único tópico gigante junta contextos não relacionados.

### `minWeight` (default `0`)

Threshold duro pra pruning adicional após o weighting. `0` mantém tudo que
não foi dropado pelas regras; subir **poda mais ruído** mas **perde
contexto**.

| Valor    | Efeito esperado                                                 |
|----------|-----------------------------------------------------------------|
| `0`      | Default. Confia nas drop rules; LLM vê tudo que não é ruído.    |
| `0.35`   | Corta baseline "content normal sem keyword nem pergunta".       |
| `0.5`    | Só content longo, pergunta, áudio longo, ou keyword crítica.    |
| `> 0.6`  | Muito agressivo — risco de passar a **perder** decisões.        |

**Regra empírica do plano**: em dúvida, prefira **weight = 0** em vez de
drop. A Fase 7 (LLM) tem contexto suficiente pra ignorar baixo sinal.
