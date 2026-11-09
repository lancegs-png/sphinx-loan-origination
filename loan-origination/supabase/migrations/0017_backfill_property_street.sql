-- Reconcile the property address between the two stores.
--
-- The deal title reads the `loans.property_address` column, while the Property Info
-- grid reads the field model (`property_street` + city/state/zip, with a calculated
-- `property_address` concatenating them). Older loans had the column populated at
-- intake but never had the granular field values set, so the grid showed blank even
-- though the title had an address.
--
-- The field model is now the source of truth, and recomputeLoan() keeps the column
-- in sync going forward. This backfills existing loans: where a loan has a
-- `property_address` column value but no `property_street` field value yet, seed
-- `property_street` from the column so the grid is no longer blank. (Leaving the
-- single string in the street field mirrors how it was entered; city/state/zip can
-- be split out later, and the column stays correct either way.)
--
-- Safe to re-run: only fills rows that are currently empty.

begin;

insert into public.loan_field_values (loan_id, field_key, idx, initial_value)
select l.id, 'property_street', 1, to_jsonb(l.property_address)
from public.loans l
where coalesce(l.property_address, '') <> ''
on conflict (loan_id, field_key, idx) do update
  set initial_value = excluded.initial_value
  where loan_field_values.initial_value is null
    and loan_field_values.verified_value is null;

commit;
