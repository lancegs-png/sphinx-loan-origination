-- 0011_calc_apply.sql
-- P16: a secure write path for the calculation module, plus the loan_amount source fix.

-- ---------- 1. DSCR: the lender enters LTV; loan_amount derives from it ----------
-- ltv becomes a manual input (loan_amount = as_is_value x ltv). loan_amount stays
-- calculated (for RTL the calc module writes it as total_loan_amount).
update public.field_definitions set source = 'manual', calc_key = null where key = 'ltv';

-- ---------- 2. apply_calc_values: write calculated fields past the read-only guard ----------
-- The enforce trigger blocks writes to source='calculated' fields unless
-- app.allow_calc_write is set. This SECURITY DEFINER function sets it (transaction-local)
-- then upserts each value as the field's initial_value. JSON null clears the value.
create or replace function public.apply_calc_values(p_loan_id uuid, p_values jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  v jsonb;
begin
  perform set_config('app.allow_calc_write', '1', true);
  for k, v in select * from jsonb_each(p_values) loop
    insert into public.loan_field_values (loan_id, field_key, idx, initial_value, updated_at)
    values (p_loan_id, k, 1, case when v = 'null'::jsonb then null else v end, now())
    on conflict (loan_id, field_key, idx)
    do update set
      initial_value = case when excluded.initial_value is null then null else excluded.initial_value end,
      updated_at = now()
    where not public.loan_field_values.locked;  -- never overwrite a locked field
  end loop;
end;
$$;

grant execute on function public.apply_calc_values(uuid, jsonb) to authenticated, service_role;
