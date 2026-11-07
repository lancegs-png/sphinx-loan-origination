-- 0014_opportunity_numbers.sql
-- Opportunity numbers at intake; the permanent loan number (SPHX###) is assigned
-- only when the term sheet is signed.
--
-- Before: every new loan row got an SPHX loan_number from a sequence default at
-- creation, so abandoned/junk intakes permanently burned loan numbers.
-- After: a loan gets an OPP#### opportunity_number at creation; loan_number stays
-- NULL until signTermSheet assigns the next SPHX### (see assign_loan_number()).
-- Existing test loans keep (are grandfathered into) their current SPHX numbers.

begin;

-- ---------- Opportunity number sequence (OPP1000+, never reused) ----------
create sequence if not exists public.opportunity_number_seq start 1000;

create or replace function public.next_opportunity_number()
returns text
language sql
volatile
as $$
  select 'OPP' || nextval('public.opportunity_number_seq')::text;
$$;

-- ---------- loans.opportunity_number (always present) ----------
alter table public.loans add column if not exists opportunity_number text;

-- Backfill existing rows (nextval is volatile → a distinct value per row).
update public.loans
  set opportunity_number = public.next_opportunity_number()
  where opportunity_number is null;

alter table public.loans
  alter column opportunity_number set default public.next_opportunity_number();
alter table public.loans
  alter column opportunity_number set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loans_opportunity_number_key'
  ) then
    alter table public.loans
      add constraint loans_opportunity_number_key unique (opportunity_number);
  end if;
end $$;

-- ---------- Stop auto-assigning loan_number; allow it to be NULL until signing ----------
-- Existing loan_number values (SPHX500..) are kept as-is (grandfathered).
alter table public.loans alter column loan_number drop default;
alter table public.loans alter column loan_number drop not null;
-- loan_number keeps its UNIQUE constraint; Postgres allows multiple NULLs under it.

-- ---------- assign_loan_number(): opportunity -> loan, on first signature ----------
-- Atomic + idempotent: assigns the next SPHX### only if none is set yet; if the loan
-- already has one (e.g. a grandfathered test loan), returns the existing number.
create or replace function public.assign_loan_number(p_loan_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v text;
begin
  update public.loans
    set loan_number = public.next_loan_number()
    where id = p_loan_id and loan_number is null
    returning loan_number into v;

  if v is null then
    select loan_number into v from public.loans where id = p_loan_id;
  end if;

  return v;
end;
$$;

commit;
