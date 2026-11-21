-- 0030_broker_portal.sql
-- Broker portal: external broker accounts that log in, see only their own loans, submit
-- new loans via intake, and upload documents — with a restricted loan view.
--
-- Adds a third visibility tier (broker) between borrower and lending team, enforced in RLS
-- (not just the UI):
--   * is_broker()                       — profile.external_type = 'broker'
--   * field_definitions.broker_visible  — a lender-only field a broker may still read
--   * loan_documents.visibility         — 'internal' (staff only) | 'shared' (brokers too)
--
-- Loan access itself is unchanged: a broker is linked to a loan by a deal_participants row
-- (new 'broker' participant_role), so has_loan_access() already scopes their pipeline.

-- ---------- 1. Broker participant role ----------
-- (Safe inside a transaction in PG12+ as long as the new value is not used in this migration.)
alter type public.participant_role add value if not exists 'broker';

-- ---------- 2. is_broker() helper (SECURITY DEFINER, mirrors is_lending_team) ----------
create or replace function public.is_broker()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select external_type = 'broker' from public.profiles where id = auth.uid()),
    false);
$$;

-- ---------- 3. Field dictionary: broker_visible flag ----------
alter table public.field_definitions
  add column if not exists broker_visible boolean not null default false;

-- Close the latent leak: the UI hides trade/closing/data_tape from non-lenders, but RLS only
-- hides fields flagged lender_only. Flag those sections lender_only so the DB matches the UI.
-- (Applied additively; a re-import of the field-dictionary sheet should carry the same flags —
-- see docs note. broker_visible is a new column the importer does not touch, so it survives.)
update public.field_definitions
  set lender_only = true
  where section in ('trade', 'closing', 'data_tape') and lender_only = false;

-- Re-expose only the broker-safe subset of Closing Calculations to brokers. Hidden from brokers:
-- net_wire, reserve_amount, prepaid_interest (internal wire/escrow mechanics).
update public.field_definitions
  set broker_visible = true
  where key in (
    'closing_date', 'disbursement_date', 'first_payment_date',
    'origination_fee_amount', 'underwriting_fee', 'legal_fee', 'closing_costs'
  );

-- ---------- 4. loan_field_values RLS: add the broker tier ----------
-- A broker participant reads a field when it is not lender-only (same as a borrower) OR it is
-- explicitly broker_visible. Lending team and borrower behavior is unchanged.
drop policy if exists loan_field_values_select on public.loan_field_values;
create policy loan_field_values_select on public.loan_field_values for select
  using (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or not exists (
        select 1 from public.field_definitions d where d.key = field_key and d.lender_only
      )
      or (
        public.is_broker()
        and exists (
          select 1 from public.field_definitions d where d.key = field_key and d.broker_visible
        )
      )
    )
  );

-- ---------- 5. loan_documents: per-document visibility + broker upload ----------
alter table public.loan_documents
  add column if not exists visibility text not null default 'internal';
-- uploaded_by already exists (0016); constrain the new column.
alter table public.loan_documents
  drop constraint if exists loan_documents_visibility_check;
alter table public.loan_documents
  add constraint loan_documents_visibility_check check (visibility in ('internal', 'shared'));

-- Read: lending team and borrowers see every document on an accessible loan (unchanged for them);
-- a broker sees only 'shared' documents plus their own uploads.
drop policy if exists loan_documents_select on public.loan_documents;
create policy loan_documents_select on public.loan_documents for select
  using (
    public.has_loan_access(loan_id)
    and (
      not public.is_broker()
      or visibility = 'shared'
      or uploaded_by = auth.uid()
    )
  );

-- Write: lending team manages any document; a broker may add documents to loans they can access
-- and modify/delete only their own uploads (USING gates update/delete; WITH CHECK gates insert).
drop policy if exists loan_documents_write on public.loan_documents;
create policy loan_documents_write on public.loan_documents for all
  using (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or (public.is_broker() and uploaded_by = auth.uid())
    )
  )
  with check (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or (public.is_broker() and visibility = 'shared' and uploaded_by = auth.uid())
    )
  );
