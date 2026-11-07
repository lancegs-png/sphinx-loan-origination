-- 0012_checklists.sql
-- P18: per-loan checklists (brief §6).

-- doc_status gains 'ordered' and 'not_applicable'. "Cleared" = approved (no new value).
-- ADD VALUE is idempotent here and is not used by DDL in this same migration.
alter type doc_status add value if not exists 'ordered';
alter type doc_status add value if not exists 'not_applicable';

-- Category on the program checklist (e.g. "Borrower documents" / "Lender documents").
alter table public.program_checklist_items add column if not exists category text;

-- Per-loan checklist instances, created from the program checklist at Processing.
create table if not exists public.loan_checklist_items (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  document_type_id uuid not null references public.document_types (id) on delete cascade,
  status doc_status not null default 'outstanding',
  notes text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (loan_id, document_type_id)
);
create index if not exists loan_checklist_loan_idx on public.loan_checklist_items (loan_id);

alter table public.loan_checklist_items enable row level security;

-- Participants can see their loan's checklist; the lending team manages it.
create policy loan_checklist_select on public.loan_checklist_items for select
  using (public.has_loan_access(loan_id));
create policy loan_checklist_write on public.loan_checklist_items for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

alter publication supabase_realtime add table public.loan_checklist_items;
