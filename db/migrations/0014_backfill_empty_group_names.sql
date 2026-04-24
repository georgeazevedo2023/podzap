-- =====================================================================
-- Backfill: grupos com nome vazio ou NULL ganham o JID como nome.
-- =====================================================================
-- UAZAPI retorna `Name: ""` pra grupos sem subject setado no WhatsApp
-- (communities sem título, grupos só de anúncio etc). O sync antigo
-- gravava a string vazia direto, e aí busca por nome (ILIKE) não casa
-- nada — o user não consegue achar nem o JID.
--
-- Daqui pra frente o sync em `lib/groups/service.ts` trata empty como
-- missing e usa o JID (commit companion). Esta migração limpa os 150+
-- rows que já ficaram assim.
-- =====================================================================

update public.groups
   set name = uazapi_group_jid
 where (name is null or btrim(name) = '');
