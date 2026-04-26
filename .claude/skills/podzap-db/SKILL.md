---
name: podzap-db
description: Roda SQL ad-hoc contra o Supabase via Management API com env carregada. Triggers - "consulta DB", "select", "quantos", "listar tenants/grupos/messages", "rodar SQL".
---

# podzap-db

Wrapper pra `scripts/db-query.mjs` — roda SQL via Supabase Management API com `.env.local` carregada (sem precisar lembrar dos flags).

## Comando padrão

```bash
node --env-file=.env.local scripts/db-query.mjs --sql "<SQL>" 2>&1 | tail -3
```

Resposta: `HTTP <code>` + JSON array. `tail -3` corta verbosidade.

## Padrões úteis

### Quantos / quanto

```sql
-- Total tabela
select count(*) from messages;

-- Tamanho do banco
select pg_size_pretty(pg_database_size(current_database())) as size;

-- Por-tabela com row count
select c.relname as tbl, pg_size_pretty(pg_total_relation_size(c.oid)) as size,
       s.n_live_tup as rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc;
```

### Investigar mensagem específica

```sql
-- Pelo whatsapp messageid
select id, type, media_url, media_download_status, captured_at,
       jsonb_pretty(raw_payload) as payload
from messages where uazapi_message_id = '<MID>';

-- Com transcript via JOIN
select m.id, m.type, t.text as transcript, t.language
from messages m left join transcripts t on t.message_id = m.id
where m.uazapi_message_id = '<MID>';
```

### Status do tenant / instância

```sql
-- Instância whatsapp
select id, status, phone, uazapi_instance_name, last_seen_at, connected_at
from whatsapp_instances;

-- Grupos monitorados
select g.name, g.uazapi_group_jid, g.member_count
from groups g where g.is_monitored = true order by g.name;
```

### Pipeline forensics

```sql
-- Distribuição de tipos
select type, count(*) from messages group by type order by 2 desc;

-- 'other' por rawType (forense)
select raw_payload->'content'->>'rawType' as raw_type, count(*)
from messages where type='other' group by 1 order by 2 desc;

-- Summaries por status
select status, count(*) from summaries group by status;

-- Audios não entregues
select s.id, s.text, a.created_at
from summaries s join audios a on a.summary_id = s.id
where a.delivered_to_whatsapp = false;
```

## Cuidados

- **Resultado vai pra stdout** — não usa pra exfiltrar dados sensíveis (texto de mensagens privadas) pra logs públicos. Cuidado com LGPD se incluir conteúdo de `messages.content` ou `transcripts.text` em outputs compartilhados.
- **Limit padrão**: sempre adicionar `limit 10` em selects exploratórios. Tabela `messages` cresce rápido.
- **DELETE / UPDATE**: confirmar com user antes. SQL via Management API roda como service role — bypassa RLS. Um `delete from messages` sem WHERE deleta tudo.
- **Aplicar SQL multi-statement**: passar arquivo em vez de `--sql`:
  ```bash
  node --env-file=.env.local scripts/db-query.mjs path/to/query.sql
  ```

## Quando NÃO usar

- Pra aplicar **migration**: usa skill `podzap-migration` (template + gen-types + commit padronizados)
- Pra escrever em produção um valor sensível (token, secret): use o admin client via código, com auditoria
