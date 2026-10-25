-- 0003_program_ai_config.sql
-- M3: per-program AI intake configuration + a JSONB bucket for captured quote inputs.

-- Free-form captured quote inputs on the loan (design §4.2 custom_fields).
alter table public.loans add column if not exists custom_fields jsonb not null default '{}'::jsonb;

-- Per-program AI config: what to gather for a quote, how to ask, and style examples.
create table if not exists public.program_ai_config (
  program_id uuid primary key references public.loan_programs (id) on delete cascade,
  quote_fields jsonb not null default '[]'::jsonb,  -- [{ "key","label","required" }]
  intake_style text,                                -- conversation voice / guardrails
  intake_examples text,                             -- example transcript(s)
  updated_at timestamptz not null default now()
);

alter table public.program_ai_config enable row level security;

-- Admin manages it; the lending team may read it. Borrowers never query it directly —
-- the intake agent reads it server-side via the service role.
create policy program_ai_config_select on public.program_ai_config for select
  using (public.is_lending_team());
create policy program_ai_config_write on public.program_ai_config for all
  using (public.is_admin()) with check (public.is_admin());
