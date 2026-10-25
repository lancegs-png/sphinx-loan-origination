-- 0001_core_schema.sql
-- Core schema for the chat-driven loan origination prototype (M1 walking skeleton).
-- Traces: design.md §4 (data model), §7 (stage machine). Requirements: R-DATA-*, R-STAGE-*, R-CHAT-*.
-- Note: role resolution uses auth.uid() + public.profiles via SECURITY DEFINER helpers (see 0002),
-- which is the simplest secure pattern on Supabase (no custom JWT hook needed for the prototype).

-- ---------- Enums ----------
create type lender_user_type as enum ('admin', 'operations', 'account_manager');
create type participant_role as enum ('borrower', 'originator', 'lending_team');
create type loan_stage as enum (
  'intake', 'pre_qualification', 'quote_term_sheet', 'processing',
  'underwriting', 'final_approval', 'closing', 'post_close'
);
create type loan_status as enum ('active', 'on_hold', 'withdrawn', 'declined');
create type doc_status as enum ('outstanding', 'update_needed', 'approved');

-- ---------- Profiles (1:1 with auth.users) ----------
-- R-AUTH-*, §2 roles. External users default to is_lending_team = false.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  is_lending_team boolean not null default false,
  lender_user_type lender_user_type,       -- null for external (borrower/originator)
  created_at timestamptz not null default now()
);

-- Auto-create a profile when a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Loan programs (minimal for M1; expanded in later phases) ----------
-- §4.3, R-INTAKE-11 (loan_type -> program).
create table public.loan_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  loan_type_key text unique,
  public_info text,                          -- borrower-safe tier (§5.2)
  created_at timestamptz not null default now()
);

-- ---------- Loan number sequence (SPHX500+, never reused) ----------
-- R-DRIVE-1.
create sequence if not exists public.loan_number_seq start 500;

create or replace function public.next_loan_number()
returns text
language sql
volatile
as $$
  select 'SPHX' || nextval('public.loan_number_seq')::text;
$$;

-- ---------- Loans ----------
-- §4.2, R-STAGE-1, R-UI-7/8.
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  loan_number text unique not null default public.next_loan_number(),
  program_id uuid references public.loan_programs (id),
  account_manager_id uuid references public.profiles (id),
  stage loan_stage not null default 'intake',
  status loan_status not null default 'active',
  loan_type text,
  loan_amount numeric,
  property_address text,
  borrower_name text,
  expected_close_date date,
  drive_folder_id text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------- Deal participants (per-deal access) ----------
-- §4.1, R-AUTH-1/5/6.
create table public.deal_participants (
  loan_id uuid not null references public.loans (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  participant_role participant_role not null,
  added_by uuid references public.profiles (id),
  added_at timestamptz not null default now(),
  primary key (loan_id, user_id)
);

create index deal_participants_user_idx on public.deal_participants (user_id);

-- ---------- Messages (shared conversation) ----------
-- §4.4, R-CHAT-1/3/4/5/7, R-NOTES (is_internal).
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  sender_user_id uuid references public.profiles (id),
  sender_kind text not null default 'human',   -- human | ai | system
  sender_role text,                             -- borrower | originator | lending_team | ai | system
  is_internal boolean not null default false,   -- lender-only when true
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_loan_idx on public.messages (loan_id, created_at);

-- ---------- Internal notes (lender-only; demonstrates the AI/data wall) ----------
-- §4.6, R-NOTES-1.
create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  author_id uuid references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- Audit events (append-only history) ----------
-- §4.4, R-AUDIT-1/2.
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid references public.loans (id) on delete cascade,
  actor_id uuid references public.profiles (id),
  actor_kind text not null default 'human',     -- human | ai | system
  event_type text not null,
  is_internal boolean not null default false,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_loan_idx on public.audit_events (loan_id, created_at);

-- ---------- Realtime ----------
-- Stream new messages and loan changes to subscribed clients (R-NFR-9).
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.loans;
