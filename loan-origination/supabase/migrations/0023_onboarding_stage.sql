-- 0023_onboarding_stage.sql
-- Add an "Onboarding" loan stage between Quoted (quote_term_sheet) and Processing.
-- Positioned in the enum so stage ordering (progress bar, sort) stays correct.
alter type loan_stage add value if not exists 'onboarding' before 'processing';
