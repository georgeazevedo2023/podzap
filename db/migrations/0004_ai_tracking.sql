-- =====================================================================
-- podZAP — 0004_ai_tracking
-- =====================================================================
-- Adds the tracking surface for LLM/STT/TTS calls (Fase 7). Every time a
-- worker invokes a provider (Groq for STT, Gemini for vision/LLM, OpenAI
-- for TTS, etc.) we persist a row here with input/output token counts,
-- cost-in-cents, and latency. This lets us:
--   * enforce per-tenant cost budgets
--   * charge back / attribute spend
--   * spot regressions (model swap → latency doubles)
--
-- Scope: additive only. Single new table + indexes + RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ai_calls — one row per provider call.
-- ---------------------------------------------------------------------
-- F7: tracking table. Writes are always performed by workers running
-- under service_role (which bypasses RLS), so there is no insert/update
-- policy below — tenant members can only SELECT their rows.
create table if not exists public.ai_calls (
  -- F7: surrogate id so callers can correlate a worker log line with a
  -- db row without exposing provider-specific request ids.
  id uuid primary key default gen_random_uuid(),

  -- F7: required tenancy fk; cascade on delete so wiping a tenant also
  -- wipes its usage history (GDPR / account closure).
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- F7: small closed set of providers we currently integrate with.
  -- Enforced via CHECK (not an enum type) so adding a provider later is
  -- a one-line migration instead of an enum ALTER dance.
  provider text not null check (provider in ('groq','gemini','openai')),

  -- F7: provider-specific model name (free text). e.g. 'whisper-large-v3',
  -- 'gemini-2.5-pro', 'tts-1'. Not constrained because model ids rotate.
  model text not null,

  -- F7: coarse classification of what this call was doing. Drives the
  -- per-operation aggregations on the billing dashboard.
  operation text not null check (
    operation in ('transcribe','describe','summarize','tts','other')
  ),

  -- F7: token counts default to 0 — some operations (TTS) don't report
  -- tokens and we still want NOT NULL columns for easy SUM().
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,

  -- F7: integer cents to avoid float drift on aggregation. Callers
  -- convert USD → cents (round half-up) before insert.
  cost_cents integer not null default 0,

  -- F7: wall-clock latency of the provider call, nullable because not
  -- every caller bothers to measure (e.g. background retries).
  duration_ms integer,

  -- F7: optional linkage to the message / summary the call was for.
  -- ON DELETE SET NULL so deleting a message doesn't torch the usage
  -- history — we still want the cost row even if the artefact is gone.
  message_id uuid references public.messages(id) on delete set null,
  summary_id uuid references public.summaries(id) on delete set null,

  -- F7: error string when the call failed. null == success. Kept free-
  -- form because provider error shapes vary wildly.
  error text,

  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) Indexes.
-- ---------------------------------------------------------------------

-- F7: primary aggregation shape — "usage for tenant X between dates".
-- (tenant_id, created_at desc) lets the billing query stream rows in
-- reverse-chrono without a sort.
create index if not exists idx_ai_calls_tenant_created
  on public.ai_calls(tenant_id, created_at desc);

-- F7: secondary aggregation for cross-tenant ops dashboards
-- ("how much did we spend on gemini-2.5-pro this week"). Not tenant-
-- scoped on purpose — this is the ops/admin view.
create index if not exists idx_ai_calls_provider_model
  on public.ai_calls(provider, model);


-- ---------------------------------------------------------------------
-- 3) RLS.
-- ---------------------------------------------------------------------

-- F7: RLS on. Workers insert via service_role which bypasses policies;
-- tenant members can only read their own rows.
alter table public.ai_calls enable row level security;

-- F7: select policy — reuses the current_tenant_ids() helper installed
-- in 0002_fixes so there's a single source of truth for tenant
-- membership across the schema. Drop-if-exists for idempotent reruns.
drop policy if exists ai_calls_select on public.ai_calls;
create policy ai_calls_select
  on public.ai_calls for select to authenticated
  using (tenant_id in (select public.current_tenant_ids()));

-- F7: NO insert/update/delete policies. Writes are intentionally
-- service_role-only — workers are the sole producers and tenants must
-- not be able to forge usage rows (which would affect billing).

-- =====================================================================
-- End of 0004_ai_tracking.
-- =====================================================================
