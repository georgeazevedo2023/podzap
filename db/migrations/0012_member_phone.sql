-- =====================================================================
-- Adiciona telefone E.164 por membro do tenant.
-- =====================================================================
-- Usado pela UI de "mandar áudio pra destino" (HeroPlayer + /podcasts).
-- Cada usuário pode escolher enviar o podcast pra:
--   - grupo de origem (default, já funciona)
--   - pro próprio WhatsApp (usa `phone_e164` desta tabela)
--   - pra um contato avulso (JID digitado na hora)
--
-- Usamos `tenant_members` em vez de `auth.users.phone` porque o mesmo
-- humano pode ter papéis em múltiplos tenants e hipoteticamente querer
-- números distintos — manter isolado por membership é mais flexível.
--
-- Formato E.164: `+55 11 99999-9999` → `+5511999999999`. Check constraint
-- garante formato válido. Nullable (opt-in, não obrigatório).
-- =====================================================================

alter table public.tenant_members
  add column if not exists phone_e164 text;

-- Drop antes de recriar pra idempotência.
alter table public.tenant_members
  drop constraint if exists tenant_members_phone_e164_format;

alter table public.tenant_members
  add constraint tenant_members_phone_e164_format
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
