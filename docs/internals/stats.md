# Home stats aggregator

Arquivo-fonte: [`lib/stats/service.ts`](../../lib/stats/service.ts).
Teste: [`tests/stats-service.spec.ts`](../../tests/stats-service.spec.ts).
Consumidor único: [`app/(app)/home/page.tsx`](../../app/(app)/home/page.tsx) (server component).

## Propósito

Uma única função `getHomeStats(tenantId)` monta TODO o payload da home dashboard em um round-trip — hero (episódio atual), stat cards (4 números), grid "últimos eps" (4 cards com cover + signed URL), e sinais de onboarding (3 booleanos/counts).

Antes disso, a home fazia 6+ queries sequenciais no render. Com `Promise.all` o wall time vira `max(query)` em vez de `sum(query)`.

## Shape de retorno (`lib/stats/service.ts:63-84`)

```ts
type HomeStats = {
  // Stat cards
  summariesThisWeek: number;
  minutesListened: number;
  activeGroupsCount: number;
  approvalRate: number;               // 0-1, UI * 100
  pendingApprovalsCount: number;

  // Grid
  latestEpisodes: HomeStatsEpisode[]; // up to 4

  // Hero
  currentEpisode: HomeStatsCurrent | null;

  // Onboarding signals (added in Fase 12 audit #5)
  whatsappConnected: boolean;
  monitoredGroupsCount: number;
  capturedMessagesCount: number;
};
```

## As 9 queries paralelas

Todas disparam em um único `Promise.all` (`lib/stats/service.ts:375-459`):

| # | O que conta | Tabela | Filtro | Agregação |
|---|---|---|---|---|
| 1 | `summariesThisWeek` | `summaries` | `status='approved' AND created_at >= now-7d` | `COUNT(*)` via `head: true` |
| 2 | `minutesListened` | `audios` | `delivered_to_whatsapp=true AND delivered_at >= now-7d` | soma client-side `duration_seconds / 60` |
| 3 | `activeGroupsCount` | `messages` | `captured_at >= now-7d` | `new Set(group_id).size` client-side |
| 4 | `approvalRate` | `summaries` | `created_at >= now-30d` | `approved / total` client-side |
| 5 | `pendingApprovalsCount` | `summaries` | `status='pending_review'` | `COUNT(*)` via `head: true` |
| 6 | `latestEpisodes` (rows) | `audios` + inner join `summaries` + `groups` | `status='approved'`, order `created_at desc`, limit 4 | rows brutos |
| 7 | `whatsappConnected` | `whatsapp_instances` | `status='connected'`, limit 1 | `rows.length > 0` |
| 8 | `monitoredGroupsCount` | `groups` | `is_monitored=true` | `COUNT(*)` via `head: true` |
| 9 | `capturedMessagesCount` | `messages` | nenhum (all-time) | `COUNT(*)` via `head: true` |

**Todas** incluem `.eq('tenant_id', tenantId)` — disciplina multi-tenant obrigatória porque o service usa o admin client (bypass RLS).

### Por que client-side pra #2, #3, #4

Não há RPC/view Postgres. A alternativa seria RPC functions + migrations. Volume por tenant é baixo (centenas de rows em 7-30 dias) — client-side é aceitável. **Débito**: se crescer, mover pra RPC `get_home_stats(tenant_id)` retornando JSON.

## Segunda fase: current episode extras

Depois do `Promise.all`, se existe pelo menos 1 episódio, roda mais uma rodada paralela (`loadCurrentEpisodeExtras`, `lib/stats/service.ts:282-340`) pra enriquecer só o primeiro:

- `messagesCount` / `audiosCount` / `imagesCount` — últimas 24h do grupo do episódio.
- `episodeNumber` — contagem de approved summaries desse grupo até o `created_at` do atual (inclui o próprio).

Essa query é sequencial ao `Promise.all` principal porque precisa do `groupId` + `createdAt` do primeiro episódio.

## Signed URLs (`lib/stats/service.ts:259-275`)

Para cada episódio no `latestEpisodes`, `signEpisodeUrl` chama `getSignedUrl(path, { bucket: 'audios', expiresInSeconds: 3600 })`.

**Failure isolada**: URL falha → retorna `{ url: null, expiresAt: null }` só pra aquele card. A home renderiza cover + título sem o play, em vez de quebrar a página inteira.

**`audioExpiresAt`** (ISO string) é devolvido pro client usar — enable re-fetch antes do fim da sessão de escuta de um áudio longo.

## Cover variant (`hashToVariant`)

`lib/stats/service.ts:96-104` — djb2 → `[0, 5]` determinístico. Mesmo `groupId` sempre gera o mesmo cover, em qualquer device / session, sem precisar de coluna no DB.

```ts
export function hashToVariant(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 6;
}
```

djb2 escolhido sobre `crypto.createHash`: ~10x mais rápido, sem import Node-only, distribuição sobre 6 buckets é indistinguível de crypto hash pra esse tamanho.

## Title extraction (`extractTitle`, `lib/stats/service.ts:116-128`)

Primeira linha não-vazia de `summary.text`. Se achar terminador de sentença (`.`, `!`, `?`) antes do char 60, corta ali; caso contrário trunca em 60 com ellipsis. Fallback `"ep. N"` se texto vazio.

## Onboarding signals

Campos novos (Fase 12):

- `whatsappConnected` — tenant tem instance conectada? Query #7.
- `monitoredGroupsCount` — quantos grupos `is_monitored=true`. Query #8.
- `capturedMessagesCount` — já chegou qualquer message? Query #9.

A home usa os três pra decidir o CTA do empty state em vez de sempre mandar pra `/onboarding`:

```
!whatsappConnected      → "Conectar WhatsApp"
monitoredGroupsCount=0  → "Selecionar grupos"
capturedMessagesCount=0 → "Aguardando primeiras mensagens…"
else (sem episódio ainda) → "Gerar resumo agora" (modal inline)
```

Todas três são cheap head-count queries → ride no mesmo `Promise.all` sem penalty.

## Failure policy

- **DB errors sobem** — a page render cai no error boundary. Intencional: stat errado é pior que página quebrada.
- **Signed URL errors engolidos** — por episódio, não derruba o batch.

## Gotchas

1. **Roda sob admin client** (`createAdminClient()` na linha 358). Bypass RLS — `tenant_id` no WHERE é obrigatório e já está em cada query.
2. **`capturedMessagesCount` é all-time.** Query sem filtro temporal. OK hoje porque volume baixo e tem index `(tenant_id, captured_at)` — se crescer pro milhão de rows por tenant, virar "has any" via `.limit(1)`.
3. **Um tenant sem episódios** → `currentEpisode: null`. UI precisa tratar explicitamente.
4. **Joins na query 6.** O PostgREST embed (`summaries!inner(…)` + `groups:group_id(…)`) retorna shapes que podem ser array ou objeto dependendo da cardinalidade inferida. `loadLatestEpisodeRows` normaliza (`lib/stats/service.ts:232-251`).
5. **Não cacheia.** Cada request à home = 9 queries. Em volume, considerar `revalidate: 60` na page ou cachear em `unstable_cache`.
