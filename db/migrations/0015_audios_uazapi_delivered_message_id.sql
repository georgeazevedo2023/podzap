-- 0015_audios_uazapi_delivered_message_id.sql
--
-- Permite distinguir áudio enviado pelo PRÓPRIO dono da instância (ex.:
-- gravação de voz no celular) do áudio que NÓS entregamos como podcast
-- via UAZAPI. Sem isso, o webhook ignora todo `fromMe=true && audio` pra
-- evitar loop de re-processar o próprio podcast — e isso bloqueia o owner
-- de ter os áudios dele transcritos.
--
-- Como funciona:
--   1. delivery/service.ts captura o `id` da resposta do UAZAPI quando
--      manda o áudio do podcast.
--   2. Esse id é gravado em `audios.uazapi_delivered_message_id`.
--   3. webhook/persist.ts: quando vier `fromMe=true && type=audio`, faz
--      um SELECT em `audios` por (tenant_id, uazapi_delivered_message_id)
--      = key.id. Se acha → ignora (é nossa entrega). Se não acha →
--      processa normalmente (é áudio que o owner gravou).

alter table public.audios
  add column if not exists uazapi_delivered_message_id text;

-- Index parcial: só linha realmente entregue tem o id; lookup do webhook
-- é frequente e crítico pra latência (<5s budget). Index só nos rows que
-- vão bater na query.
create index if not exists idx_audios_uazapi_delivered_message_id
  on public.audios (tenant_id, uazapi_delivered_message_id)
  where uazapi_delivered_message_id is not null;

comment on column public.audios.uazapi_delivered_message_id is
  'WhatsApp message id retornado pela UAZAPI no /send/media — usado pra '
  'webhook/persist.ts diferenciar áudio do podcast (skip) do áudio do '
  'próprio owner (process). Null pra rows que ainda não foram entregues '
  'ou foram criadas antes da migration 0015.';
