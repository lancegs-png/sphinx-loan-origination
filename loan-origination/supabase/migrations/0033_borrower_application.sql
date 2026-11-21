-- 0033_borrower_application.sql
-- Borrower Loan Application (post-term-sheet). Phase 1:
--   (1) ~24 new field_definitions for the detailed application (SSN/DOB are lender_only),
--   (2) per-loan application links + submission log (mirrors intake_links, but tied to a loan).
-- Applied by the user. Additive and idempotent.

-- ---------- 1. New application dictionary fields ----------
-- source='application' (writeable; only 'calculated' is blocked by the field trigger).
-- SSN/DOB are lender_only + not broker_visible: entered via the service-role submit, then readable
-- by the lending team only (RLS in 0009 hides lender_only fields from non-lenders).
insert into public.field_definitions
  (key, label, section, type, options, lender_only, broker_visible, repeat_group, required_stage, source, sort)
values
  -- Entity members (queryable repeat group)
  ('entity_member_name',            'Entity member name',               'borrower', 'text',    '[]'::jsonb,                     false, false, 'entity_member', 'processing', 'application', 610),
  ('entity_member_pct',             'Entity member ownership %',        'borrower', 'percent', '[]'::jsonb,                     false, false, 'entity_member', 'processing', 'application', 611),
  -- Guarantor personal details (repeat=guarantor; co-guarantor = idx 2)
  ('guarantor_ssn',                 'Guarantor SSN',                    'borrower', 'text',    '[]'::jsonb,                     true,  false, 'guarantor',     'processing', 'application', 612),
  ('guarantor_dob',                 'Guarantor date of birth',          'borrower', 'date',    '[]'::jsonb,                     true,  false, 'guarantor',     'processing', 'application', 613),
  ('guarantor_address',             'Guarantor present address',        'borrower', 'text',    '[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 614),
  ('guarantor_marital_status',      'Guarantor marital status',         'borrower', 'select',  '["Married","Unmarried"]'::jsonb, false, false, 'guarantor',    'processing', 'application', 615),
  ('guarantor_residence_ownership', 'Residence own/rent',               'borrower', 'select',  '["Own","Rent"]'::jsonb,         false, false, 'guarantor',     'processing', 'application', 616),
  ('guarantor_years_at_address',    'Years at present address',         'borrower', 'number',  '[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 617),
  ('guarantor_employer',            'Guarantor employer',               'borrower', 'text',    '[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 618),
  ('guarantor_occupation',          'Guarantor occupation',             'borrower', 'text',    '[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 619),
  ('guarantor_annual_income',       'Guarantor annual income',          'borrower', 'currency','[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 620),
  ('guarantor_investment_income',   'Guarantor annual investment income','borrower','currency','[]'::jsonb,                     false, false, 'guarantor',     'processing', 'application', 621),
  -- Experience (non-repeating)
  ('experience_geography',          'Experience — geographic areas',    'borrower', 'text',    '[]'::jsonb,                     false, false, null,            'processing', 'application', 622),
  ('experience_capacity',           'Experience — capacity',            'borrower', 'text',    '[]'::jsonb,                     false, false, null,            'processing', 'application', 623),
  ('experience_groundup_count',     'Ground-up projects (past 3y)',     'borrower', 'number',  '[]'::jsonb,                     false, false, null,            'processing', 'application', 624),
  ('experience_total_rehab_count',  'Properties ever purchased & rehabbed','borrower','number','[]'::jsonb,                    false, false, null,            'processing', 'application', 625),
  ('experience_years',              'Years as a real estate investor',  'borrower', 'number',  '[]'::jsonb,                     false, false, null,            'processing', 'application', 626),
  ('experience_licensed',           'Licensed contractor/agent (past 5y)','borrower','select', '["Yes","No"]'::jsonb,           false, false, null,            'processing', 'application', 627),
  ('company_website',               'Company website',                  'borrower', 'text',    '[]'::jsonb,                     false, false, null,            'processing', 'application', 628),
  -- Property / purpose
  ('portfolio_property_count',      'Number of properties (portfolio)', 'property', 'number',  '[]'::jsonb,                     false, false, null,            'processing', 'application', 629),
  ('exit_timeline_months',          'Expected timeline to exit (months)','loan',    'number',  '[]'::jsonb,                     false, false, null,            'processing', 'application', 630),
  ('existing_lender_name',          'Current lender (refi)',            'property', 'text',    '[]'::jsonb,                     false, false, 'property',      'processing', 'application', 631),
  ('existing_loan_maturity_date',   'Existing loan maturity date (refi)','property','date',    '[]'::jsonb,                     false, false, 'property',      'processing', 'application', 632),
  ('improvements_description',      'Improvements description',         'property', 'text',    '[]'::jsonb,                     false, false, 'property',      'processing', 'application', 633)
on conflict (key) do update set
  label          = excluded.label,
  section        = excluded.section,
  type           = excluded.type,
  options        = excluded.options,
  lender_only    = excluded.lender_only,
  broker_visible = excluded.broker_visible,
  repeat_group   = excluded.repeat_group,
  required_stage = excluded.required_stage,
  source         = excluded.source,
  sort           = excluded.sort;

-- ---------- 2. Per-loan application links ----------
-- Unlike intake_links (which open a NEW loan), these are tied to an EXISTING loan and are sent to the
-- borrower after the term sheet is signed. The public /application/<token> route reads them through the
-- service role; anon/public gets no table access.
create table if not exists public.application_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  loan_id uuid not null references public.loans(id) on delete cascade,
  active boolean not null default true,
  completed_at timestamptz,            -- set when the borrower submits + signs
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists application_links_loan_idx on public.application_links (loan_id);

-- Submission log: per-link rate limiting, counts, light audit. Public inserts via the service role.
create table if not exists public.application_submissions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.application_links(id) on delete set null,
  token text,
  loan_id uuid references public.loans(id) on delete set null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists application_submissions_token_created_idx
  on public.application_submissions (token, created_at desc);
create index if not exists application_submissions_link_idx
  on public.application_submissions (link_id);

alter table public.application_links enable row level security;
alter table public.application_submissions enable row level security;

-- Lending team manages links and reads the submission log (and must have access to the loan).
-- Anon/public has no access — the public /application route reads and writes through the service role.
drop policy if exists application_links_rw on public.application_links;
create policy application_links_rw on public.application_links
  for all using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

drop policy if exists application_submissions_ro on public.application_submissions;
create policy application_submissions_ro on public.application_submissions
  for select using (public.is_lending_team());
