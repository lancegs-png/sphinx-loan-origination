-- 0008_field_dictionary.sql
-- The loan field dictionary (schema + #hashtag registry for templates) and a
-- lender-only store for Trade-section values.

-- ---------- Field dictionary ----------
-- One row per loan field: its section, type, options, and the #hashtag used to
-- fill templates. This is the single place template tags are defined.
create table if not exists public.field_definitions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                 -- machine key, used in value stores
  label text not null,
  section text not null,                     -- loan | property | borrower | guarantor | trade
  type text not null default 'text',         -- text | number | currency | percent | date | select
  options jsonb not null default '[]'::jsonb,
  hashtag text unique,                       -- e.g. #loanamount — referenced by templates
  lender_only boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.field_definitions enable row level security;
-- The schema itself isn't sensitive; any signed-in user may read it. Admins write.
create policy field_definitions_select on public.field_definitions for select
  using (auth.role() = 'authenticated');
create policy field_definitions_write on public.field_definitions for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Trade values (lender-only) ----------
-- Trade-section field values live here, never in the borrower-readable loans row.
create table if not exists public.loan_trade (
  loan_id uuid primary key references public.loans (id) on delete cascade,
  values jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.loan_trade enable row level security;
create policy loan_trade_all on public.loan_trade for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));
