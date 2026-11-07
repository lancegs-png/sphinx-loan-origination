-- 0010_field_model_cleanup.sql
-- P14 cleanup: now that the app reads/writes loan_field_values and the dictionary is
-- seeded, remove the legacy structures. The quote / term_sheet JSON blobs in
-- loans.custom_fields stay until P16 (the calc module needs them for ltv/dscr/pitia).

-- ---------- 1. Drop the 23 legacy orphan field definitions ----------
-- These predate the data dictionary; their values were migrated to dictionary keys
-- (verified: zero loan_field_values rows reference them). Clear any stragglers first
-- so the FK (loan_field_values.field_key -> field_definitions.key) can't block.
delete from public.loan_field_values where field_key in (
  'borrower_name','buy_price','construction_budget','entity_name','exit_strategy',
  'expected_close_date','guarantor2_credit','guarantor2_first_name','guarantor2_last_name',
  'guarantor_credit','interest_only_months','liquidity','loan_number','loan_type',
  'lock_expiration','mailing_address','net_worth','origination_pct','package_tracking',
  'properties_owned','properties_sold_3yr','servicer','servicer_id'
);
delete from public.field_definitions where key in (
  'borrower_name','buy_price','construction_budget','entity_name','exit_strategy',
  'expected_close_date','guarantor2_credit','guarantor2_first_name','guarantor2_last_name',
  'guarantor_credit','interest_only_months','liquidity','loan_number','loan_type',
  'lock_expiration','mailing_address','net_worth','origination_pct','package_tracking',
  'properties_owned','properties_sold_3yr','servicer','servicer_id'
);

-- ---------- 2. Retire loan_trade (trade values now live in loan_field_values) ----------
drop table if exists public.loan_trade;

-- ---------- 3. Drop the legacy expected_close_date column (replaced by closing_date) ----------
alter table public.loans drop column if exists expected_close_date;
