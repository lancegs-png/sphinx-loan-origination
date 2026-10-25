-- 0002_rls_policies.sql
-- Row-Level Security — the enforcement layer for the access model (design §5, §5.1).
-- Every table is RLS-enabled. Policies key on auth.uid() + the caller's profile role and
-- deal_participants membership. Borrowers/originators can never read internal_notes, internal
-- audit events, or internal messages. This holds regardless of the UI or the AI layer, because
-- the AI retrieves data through the SAME user-scoped connection (never the service_role key).

-- ---------- Role helper functions (SECURITY DEFINER so they can read profiles under RLS) ----------
create or replace function public.is_lending_team()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_lending_team from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_lending_team and lender_user_type = 'admin'
       from public.profiles where id = auth.uid()),
    false);
$$;

-- Access to a loan: admins see all; everyone else must be a participant on that loan.
create or replace function public.has_loan_access(l uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (
        select 1 from public.deal_participants dp
        where dp.loan_id = l and dp.user_id = auth.uid()
      );
$$;

-- ---------- Enable RLS ----------
alter table public.profiles          enable row level security;
alter table public.loan_programs     enable row level security;
alter table public.loans             enable row level security;
alter table public.deal_participants enable row level security;
alter table public.messages          enable row level security;
alter table public.internal_notes    enable row level security;
alter table public.audit_events      enable row level security;

-- ---------- profiles ----------
-- Own profile always; lending team may read all profiles (People/contacts, pipeline).
create policy profiles_select on public.profiles for select
  using (id = auth.uid() or public.is_lending_team());

create policy profiles_update_own on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---------- loan_programs ----------
-- Any authenticated user may read programs (public tier). Only admins write.
create policy programs_select on public.loan_programs for select
  using (auth.role() = 'authenticated');

create policy programs_admin_write on public.loan_programs for all
  using (public.is_admin()) with check (public.is_admin());

-- ---------- loans ----------
create policy loans_select on public.loans for select
  using (public.has_loan_access(id));

-- Lending team creates loans; borrowers/originators also start loans at intake (R-INTAKE-1).
create policy loans_insert on public.loans for insert
  with check (auth.role() = 'authenticated');

create policy loans_update on public.loans for update
  using (public.has_loan_access(id) and public.is_lending_team())
  with check (public.has_loan_access(id) and public.is_lending_team());

-- ---------- deal_participants ----------
create policy participants_select on public.deal_participants for select
  using (public.has_loan_access(loan_id));

-- Lending team manages participants (invites/assignment refined in later phases).
create policy participants_write on public.deal_participants for all
  using (public.is_lending_team()) with check (public.is_lending_team());

-- ---------- messages ----------
-- Readable on accessible loans; internal messages only for lending team.
create policy messages_select on public.messages for select
  using (
    public.has_loan_access(loan_id)
    and (is_internal = false or public.is_lending_team())
  );

-- Humans post their own messages; lending team may also post system/AI event messages.
-- Only lending team may mark a message internal.
create policy messages_insert on public.messages for insert
  with check (
    public.has_loan_access(loan_id)
    and (
      (sender_kind = 'human' and sender_user_id = auth.uid()
         and (is_internal = false or public.is_lending_team()))
      or (sender_kind in ('system', 'ai') and public.is_lending_team())
    )
  );

-- ---------- internal_notes (lending team only, on accessible loans) ----------
create policy internal_notes_all on public.internal_notes for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

-- ---------- audit_events ----------
create policy audit_select on public.audit_events for select
  using (
    public.has_loan_access(loan_id)
    and (is_internal = false or public.is_lending_team())
  );
-- Writes happen via server/service paths (see src/lib/supabase/admin.ts), not from clients.
