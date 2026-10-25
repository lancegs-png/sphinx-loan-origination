-- 0006_admin_backend.sql
-- M3: the rest of the admin backend — document types (library), per-program
-- checklists, and per-program pricing. Users & roles reuse public.profiles (no new table).

-- ---------- Document types (shared library) ----------
create table if not exists public.document_types (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  default_naming_convention text,
  default_review_rules text,
  created_at timestamptz not null default now()
);

alter table public.document_types enable row level security;
create policy document_types_select on public.document_types for select
  using (public.is_lending_team());
create policy document_types_write on public.document_types for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Per-program checklist (references document types + overrides) ----------
create table if not exists public.program_checklist_items (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loan_programs (id) on delete cascade,
  document_type_id uuid not null references public.document_types (id) on delete cascade,
  required boolean not null default true,
  assignee text not null default 'borrower',           -- borrower | lending_team
  naming_override text,
  review_rules_override text,
  sort int not null default 0,
  unique (program_id, document_type_id)
);

alter table public.program_checklist_items enable row level security;
create policy checklist_select on public.program_checklist_items for select
  using (public.is_lending_team());
create policy checklist_write on public.program_checklist_items for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Per-program pricing (lender-only; never exposed to borrowers) ----------
create table if not exists public.program_pricing (
  program_id uuid primary key references public.loan_programs (id) on delete cascade,
  mode text not null default 'guidelines',             -- model | guidelines
  guidelines text,
  model jsonb not null default '{}'::jsonb,             -- e.g. { base_rate, points, term_months, max_ltv }
  updated_at timestamptz not null default now()
);

alter table public.program_pricing enable row level security;
create policy pricing_select on public.program_pricing for select
  using (public.is_lending_team());
create policy pricing_write on public.program_pricing for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Users & roles: let admins update any profile's role ----------
create policy profiles_admin_update on public.profiles for update
  using (public.is_admin()) with check (public.is_admin());

