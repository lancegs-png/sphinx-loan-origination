-- 0022_visibility_and_assignment.sql
-- Per-item visibility for checklist documents and stage tasks (who sees it on a deal:
-- everyone with loan access, or the lending team only), plus who a stage task is
-- assigned to. Visibility is enforced in the loaders; to let non-lender participants
-- (borrower / broker) read the templates for that filtering, the template SELECT policies
-- are relaxed to any signed-in user (the templates aren't sensitive). Writes stay admin-only.

alter table public.program_checklist_items
  add column if not exists visibility text not null default 'all'; -- all | lender_only

-- Tasks default to lender_only so existing internal tasks stay hidden from borrowers until
-- an admin opts specific ones into "all" (documents default to 'all' — they're already shared).
alter table public.program_stage_tasks
  add column if not exists visibility text not null default 'lender_only', -- all | lender_only
  add column if not exists assigned_to text;                                -- lender | borrower | broker | null

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'program_checklist_items_visibility_chk') then
    alter table public.program_checklist_items
      add constraint program_checklist_items_visibility_chk check (visibility in ('all', 'lender_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_stage_tasks_visibility_chk') then
    alter table public.program_stage_tasks
      add constraint program_stage_tasks_visibility_chk check (visibility in ('all', 'lender_only'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'program_stage_tasks_assigned_to_chk') then
    alter table public.program_stage_tasks
      add constraint program_stage_tasks_assigned_to_chk
      check (assigned_to is null or assigned_to in ('lender', 'borrower', 'broker'));
  end if;
end $$;

-- Relax template reads to any signed-in user so the loaders can read category / visibility /
-- assigned_to for borrowers & brokers and filter lender-only items out for them.
drop policy if exists checklist_select on public.program_checklist_items;
create policy checklist_select on public.program_checklist_items for select
  using (auth.role() = 'authenticated');

drop policy if exists stage_tasks_select on public.program_stage_tasks;
create policy stage_tasks_select on public.program_stage_tasks for select
  using (auth.role() = 'authenticated');
