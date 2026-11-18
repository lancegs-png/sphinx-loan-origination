-- 0020_stage_task_checklist.sql
-- Per-program, per-stage task checklist (customizable in Settings) + per-loan completion.
-- Distinct from the document checklist (0006/0012): these are free-text operational tasks
-- grouped by the business pipeline bucket shown on the board
-- (opportunity | quoted | processing | underwriting | closing | closed).

-- ---------- Template: per-program tasks, grouped by stage bucket (admin-managed) ----------
create table if not exists public.program_stage_tasks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loan_programs (id) on delete cascade,
  stage_bucket text not null,          -- opportunity | quoted | processing | underwriting | closing | closed
  label text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists program_stage_tasks_program_idx on public.program_stage_tasks (program_id);

alter table public.program_stage_tasks enable row level security;
-- Team can read the templates; only admins edit them (mirrors program_checklist_items).
create policy stage_tasks_select on public.program_stage_tasks for select
  using (public.is_lending_team());
create policy stage_tasks_write on public.program_stage_tasks for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Per-loan completion state, keyed to a template task (live-driven) ----------
create table if not exists public.loan_task_status (
  loan_id uuid not null references public.loans (id) on delete cascade,
  task_id uuid not null references public.program_stage_tasks (id) on delete cascade,
  done boolean not null default false,
  note text,
  completed_by uuid references public.profiles (id),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (loan_id, task_id)
);
create index if not exists loan_task_status_loan_idx on public.loan_task_status (loan_id);

alter table public.loan_task_status enable row level security;
-- Participants with loan access can read; only the lending team can check tasks off
-- (these are internal ops tasks). Mirrors loan_checklist_items.
create policy loan_task_status_select on public.loan_task_status for select
  using (public.has_loan_access(loan_id));
create policy loan_task_status_write on public.loan_task_status for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

alter publication supabase_realtime add table public.loan_task_status;

-- ---------- Seed: starter tasks for the DSCR program (fully editable in Settings) ----------
-- Idempotent: only seeds when the DSCR program exists and has no stage tasks yet.
do $$
declare
  dscr_id uuid;
begin
  select id into dscr_id from public.loan_programs where loan_type_key = 'dscr' limit 1;
  if dscr_id is null then return; end if;
  if exists (select 1 from public.program_stage_tasks where program_id = dscr_id) then return; end if;

  insert into public.program_stage_tasks (program_id, stage_bucket, label, sort) values
    (dscr_id, 'opportunity', 'Collect borrower & entity details', 0),
    (dscr_id, 'opportunity', 'Confirm property address, type & units', 1),
    (dscr_id, 'opportunity', 'Confirm loan purpose & requested amount', 2),
    (dscr_id, 'opportunity', 'Preliminary DSCR / rent check', 3),
    (dscr_id, 'quoted', 'Send term sheet / LOI', 0),
    (dscr_id, 'quoted', 'Confirm pricing tier & rate lock', 1),
    (dscr_id, 'quoted', 'Borrower signs term sheet', 2),
    (dscr_id, 'processing', 'Order appraisal', 0),
    (dscr_id, 'processing', 'Collect bank statements', 1),
    (dscr_id, 'processing', 'Collect entity documents', 2),
    (dscr_id, 'processing', 'Order title', 3),
    (dscr_id, 'processing', 'Verify insurance', 4),
    (dscr_id, 'processing', 'Collect lease / rent roll', 5),
    (dscr_id, 'underwriting', 'Submit file to investor', 0),
    (dscr_id, 'underwriting', 'Appraisal review', 1),
    (dscr_id, 'underwriting', 'Final DSCR calculation', 2),
    (dscr_id, 'underwriting', 'Clear underwriting conditions', 3),
    (dscr_id, 'closing', 'Prepare closing package', 0),
    (dscr_id, 'closing', 'Confirm wire / escrow instructions', 1),
    (dscr_id, 'closing', 'Schedule signing', 2),
    (dscr_id, 'closing', 'Collect executed closing documents', 3),
    (dscr_id, 'closed', 'Ship collateral', 0),
    (dscr_id, 'closed', 'Record funding', 1),
    (dscr_id, 'closed', 'Investor purchase confirmation', 2),
    (dscr_id, 'closed', 'File loan documents', 3);
end $$;
