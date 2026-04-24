# Rate limit

Arquivo-fonte: [`lib/ratelimit.ts`](../../lib/ratelimit.ts).
Wrapper com auth + 429 envelope: [`app/api/whatsapp/_shared.ts`](../../app/api/whatsapp/_shared.ts) (`applyRateLimit`).

## O que é

Rate limiter **in-memory** por processo Node, usado como primeira linha de defesa contra loops de polling (`/api/whatsapp/status`, `/api/whatsapp/qrcode`) e abuso de endpoints caros (`/api/summaries/generate`, `/api/audios/[id]/redeliver`).

## Algoritmo

**Fixed window** (não sliding). Estrutura mínima — um `Map<string, { count, resetAt }>` global ao módulo (`lib/ratelimit.ts:18`):

```ts
if (!existing || existing.resetAt <= now) {
  buckets.set(key, { count: 1, resetAt: now + windowMs });
  return { ok: true, remaining: maxPerWindow - 1, resetAt };
}
if (existing.count >= maxPerWindow) {
  return { ok: false, retryAfterMs: existing.resetAt - now, ... };
}
existing.count += 1;
```

Escolha consciente sobre sliding window (`lib/ratelimit.ts:4-14`): protege contra "polling gone wild" sem complexidade de ring buffer. Permite burst de até `2*max` na troca de janela — aceitável para o caso de uso.

## Granularidade

A chave é opaca (o chamador decide). Convenção atual, montada em `applyRateLimit` (`app/api/whatsapp/_shared.ts:86-90`):

```
tenant:<tenantId>:<routeName>
```

Por tenant, **por rota**. Não há rate limit por IP ou por user — a unidade de cobrança é o tenant. Usuários do mesmo tenant compartilham o budget.

## Limites em uso

Levantado via grep (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`):

| Rota | Chave | Limite | Janela | Justificativa |
|---|---|---|---|---|
| `GET /api/whatsapp/status` | `status` | 30 | 60 s | Polling de QR code + sidebar indicator |
| `GET /api/whatsapp/qrcode` | `qrcode` | 30 | 60 s | Polling durante conexão WhatsApp |
| `POST /api/groups/sync` | `groups-sync` | 6 | 60 s | Chamada UAZAPI cara (`/group/list`) |
| `POST /api/summaries/generate` | `summaries-generate` | 10 | 1 h | Gera custo Gemini 2.5 Pro |
| `POST /api/audios/[id]/redeliver` | `redeliver` | 6 | 1 h | Manual retry — evita double-delivery |

O envelope 429 inclui `Retry-After` em segundos (RFC 7231) + `retryAfterMs` em `error.details` (`_shared.ts:93-101`).

## Contrato

```ts
checkRateLimit(key, maxPerWindow, windowMs): RateLimitResult
// { ok: true, remaining, resetAt } | { ok: false, retryAfterMs, remaining: 0, resetAt }
```

`RateLimitResult.resetAt` é epoch ms — útil pra gerar `X-RateLimit-Reset` quando adicionar cross-container rate limit.

## Gotchas

1. **Não escala cross-container.** Estado vive em memória do Node. Dois pods Next.js no Portainer stack = dois buckets independentes → efetivo `2*max`. TODO documentado in-line (`lib/ratelimit.ts:10-13`): trocar por **Upstash Redis** antes do horizontal scale. A shape do export (`checkRateLimit`) permanece — só a implementação muda.

2. **Morre no redeploy.** Cada restart reseta contadores. No Hetzner + Portainer com rolling deploy isso significa que um atacante pode "sortear" reset forçando reload.

3. **Não tem GC.** O `Map` só é reescrito (linha 49) quando a mesma chave bate de novo após `resetAt`. Chaves one-shot (tenants deletados) ficam em memória indefinidamente. Baixo volume no MVP — irrelevante. Em prod vai sumir junto com o move pra Upstash.

4. **Fixed window ≠ sliding.** Um cliente pode gastar 30 requests no segundo 59 e outros 30 no segundo 61 (janela nova). Aceitável para o caso — quem quer DoS vai passar por rate limit de infra (Cloudflare/NGINX) antes de chegar aqui.

5. **`_resetRateLimits()`** é test-only (`lib/ratelimit.ts:71-73`) — chamar em `beforeEach` pra isolar specs.

## Testes

Não há `tests/ratelimit.spec.ts` dedicado. A cobertura é indireta via:

- `tests/admin-tenants.spec.ts`, `tests/admin-users.spec.ts` — exercitam rotas que usam `applyRateLimit` (mas mockam o módulo).

**Débito**: escrever spec próprio antes de trocar por Upstash — garante que a interface nova preserve a semântica (`remaining`, `retryAfterMs`, reset em `resetAt`).

## Quando usar

- **Use** pra proteger endpoints públicos ou autenticados chamados em loop (polling, retry humano, geração de artefato caro).
- **Não use** como substituto de queue backpressure — quem precisa disso é o Inngest.
- **Não use** como autorização — o gate é `requireAuth()` (`_shared.ts:58-73`). Rate limit só modula o volume.
