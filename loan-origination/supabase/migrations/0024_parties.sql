-- 0024_parties.sql
-- Reusable Guarantor & Entity records (a library) that can be selected into a new loan.
-- Sensitive PII (SSN / DOB) lives here, so every table is lending-team-only.

-- ---------- Guarantors ----------
create table if not exists public.guarantors (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  email text,
  phone text,
  ssn text,
  date_of_birth date,
  mailing_address text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.guarantors enable row level security;
create policy guarantors_all on public.guarantors for all
  using (public.is_lending_team()) with check (public.is_lending_team());

-- ---------- Entities ----------
create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ein text,
  mailing_address text,
  entity_type text,
  state_of_formation text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.entities enable row level security;
create policy entities_all on public.entities for all
  using (public.is_lending_team()) with check (public.is_lending_team());

-- ---------- Entity members (name + ownership %, optionally linked to a guarantor) ----------
create table if not exists public.entity_members (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities (id) on delete cascade,
  name text,
  ownership_pct numeric,
  guarantor_id uuid references public.guarantors (id) on delete set null,
  sort int not null default 0
);
create index if not exists entity_members_entity_idx on public.entity_members (entity_id);
alter table public.entity_members enable row level security;
create policy entity_members_all on public.entity_members for all
  using (public.is_lending_team()) with check (public.is_lending_team());

-- ---------- Provenance links: which library record seeded a loan (data is copied into
--            loan_field_values; these just record the source). ----------
create table if not exists public.loan_guarantors (
  loan_id uuid not null references public.loans (id) on delete cascade,
  guarantor_id uuid not null references public.guarantors (id) on delete cascade,
  idx int not null default 1,
  created_at timestamptz not null default now(),
  primary key (loan_id, idx)
);
alter table public.loan_guarantors enable row level security;
create policy loan_guarantors_all on public.loan_guarantors for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

create table if not exists public.loan_entities (
  loan_id uuid primary key references public.loans (id) on delete cascade,
  entity_id uuid not null references public.entities (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.loan_entities enable row level security;
create policy loan_entities_all on public.loan_entities for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

-- ---------- Dictionary fields that receive copied guarantor/entity data on a loan ----------
-- (guarantor_first_name/last_name/email/phone, borrower_entity, entity_ein/type/state already
--  exist; these add the sensitive + address fields. Idempotent.)
insert into public.field_definitions (key, label, section, type, lender_only, repeat_group, sort)
values
  ('guarantor_ssn', 'Guarantor SSN', 'guarantor', 'text', true, 'guarantor', 2010),
  ('guarantor_date_of_birth', 'Guarantor Date of Birth', 'guarantor', 'date', true, 'guarantor', 2020),
  ('guarantor_mailing_address', 'Guarantor Mailing Address', 'guarantor', 'text', true, 'guarantor', 2030),
  ('entity_mailing_address', 'Entity Mailing Address', 'borrower', 'text', false, null, 2040)
on conflict (key) do nothing;
