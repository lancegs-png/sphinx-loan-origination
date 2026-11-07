-- 0013_loan_sheet.sql
-- P22 (one-way push): store the per-loan Google Sheet id used to mirror field values.
alter table public.loans add column if not exists sheet_id text;
