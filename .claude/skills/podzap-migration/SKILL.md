---
name: podzap-migration
description: Cria migration SQL nova (próximo número), aplica via Management API e regenera tipos. Triggers - "criar migration", "nova migration", "alterar tabela", "adicionar coluna", "migration pra".
---

# podzap-migration

Wrapper pro fluxo de migration deste projeto: **NÃO** usamos `supabase db push` — é via Supabase Management API com `scripts/db-query.mjs`.

## Quando usar

- Adicionar coluna nova
- Criar tabela nova
- Mudar policy / index / constraint
- Backfill de dados (uma row dedicada de migration p/ rastreabilidade)

## Procedimento

### 1. Determinar próximo número

```bash
ls db/migrations/ | tail -3
# Próximo número = última + 1, padding 4 dígitos
```

### 2. Criar arquivo

`db/migrations/NNNN_descricao_curta.sql`:

```sql
-- NNNN_descricao_curta.sql
--
-- Por quê: <razão de negócio / bug que isso resolve>.
-- Como: <o que esta migration faz tecnicamente>.

-- 1. Schema change idempotente (preferir if-not-exists)
alter table public.<table>
  add column if not exists <name> <type>;

-- 2. Index ou constraint
create index if not exists idx_<table>_<col>
  on public.<table> (<col>)
  where <opcional partial>;

-- 3. Comment (sempre — explica a coluna pra leitura futura)
comment on column public.<table>.<name> is
  'O que essa coluna armazena, quando é populada, quem consome.';
```

**Princípios:**
- **Idempotente** sempre que possível (`if not exists`, `if exists`)
- **Comments** em colunas novas (PostgREST expõe + ajuda navegação)
- **CHECK constraints** com nome explícito pra dropar fácil depois (`add constraint <table>_<col>_check check (...)`)
- **Backfill** em rows separados quando custo alto (não bloqueia DDL)

### 3. Aplicar

```bash
node --env-file=.env.local scripts/db-query.mjs db/migrations/NNNN_xxx.sql
```

Resposta esperada: `HTTP 201 [...]` (Management API). Se erro, ler mensagem e iterar.

### 4. Regenerar tipos TypeScript

```bash
node --env-file=.env.local scripts/gen-types.mjs
```

Esperado: `Wrote lib/supabase/types.ts (NNNNN bytes)`.

### 5. Atualizar código que consome (se schema mudou)

- Service layer em `lib/<domain>/service.ts` — adicionar a coluna nova nos selects/inserts
- Tests que mockam a tabela — adicionar a coluna no mock (`tests/<feature>.spec.ts`)
- Se for coluna em `messages`, `audios`, etc.: ver os mocks em `tests/webhooks-persist.spec.ts` e `tests/retry-workers.spec.ts`

### 6. Documentar

- Adicionar linha em [`docs/data-model.md`](../../../docs/data-model.md) §Migrations
- Se a coluna mudar comportamento crítico, atualizar `docs/integrations/<subsistema>.md` ou criar nota em `docs/audits/session-YYYY-MM-DD.md` se for sessão grande

### 7. Commit

```bash
git add db/migrations/NNNN_xxx.sql lib/supabase/types.ts <outros arquivos>
git commit -m "feat(db): NNNN — <descrição curta>

- Por quê: <razão>
- Como: <o que faz>
- Tabelas afetadas: <lista>"
```

## Riscos

- **NÃO drop column / drop table sem confirmação** — irreversível, perde dados
- **NÃO mexer em rows existentes sem WHERE explícito** — `update` sem filtro afeta todo o tenant
- **Enum changes** são especiais: Postgres não dropa enum value in-place. Pra "remover", deixe o valor no enum + adicione CHECK constraint que bloqueia novos writes (padrão usado em 0011 pra `approval_mode='auto'`)
- **Long-running DDL em prod** (criar index em tabela grande): use `create index concurrently` quando aplicável; checar `pg_stat_activity` antes
