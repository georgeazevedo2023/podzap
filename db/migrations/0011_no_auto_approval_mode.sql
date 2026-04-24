-- =====================================================================
-- Remove suporte a approval_mode='auto' em schedules.
-- =====================================================================
-- Regra do produto: áudio só é entregue ao grupo do WhatsApp depois do
-- clique humano em "aprovar" em /approval/[id]. Schedules com
-- approval_mode='auto' violavam isso — o cron runner emitia
-- summary.requested com autoApprove=true e o worker generate-summary
-- flipava o status direto pra 'approved', acionando TTS + delivery sem
-- revisão humana.
--
-- Estratégia:
--   1. Remapear qualquer row existente com approval_mode='auto' para
--      'required' (default mais conservador).
--   2. Adicionar CHECK constraint que rejeita 'auto' em novos
--      INSERT/UPDATE mesmo se o código regressar. Não dropamos o valor
--      do enum `schedule_approval_mode` porque Postgres exigiria
--      recriar o tipo — o CHECK é suficiente e reversível.
-- =====================================================================

update public.schedules
   set approval_mode = 'required'
 where approval_mode = 'auto';

alter table public.schedules
  drop constraint if exists schedules_approval_mode_no_auto;

alter table public.schedules
  add constraint schedules_approval_mode_no_auto
  check (approval_mode <> 'auto');
