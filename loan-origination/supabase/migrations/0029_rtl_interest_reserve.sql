-- 0029_rtl_interest_reserve.sql
-- RTL term sheets finance an interest reserve into the loan. Add it as a manual input on the
-- residential transition programs; src/lib/calc/formulas.ts folds it into total_loan_amount
-- (total = initial advance + financed rehab holdback + interest reserve), matching the LOI.
insert into public.field_definitions (key, label, section, type, source, programs, required_stage, sort)
values
  ('interest_reserve', 'Interest reserve', 'loan', 'currency', 'manual',
   '{bridge,fix_and_flip,new_construction}', 'quote_term_sheet', 1255)
on conflict (key) do nothing;
