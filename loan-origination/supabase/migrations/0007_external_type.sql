-- 0007_external_type.sql
-- Distinguishes external users (borrower vs originator) at the profile level, so
-- Users & Roles can classify and filter everyone by a single "user type":
-- borrower | originator (external) or account_manager | operations | admin (lending team).

alter table public.profiles add column if not exists external_type text; -- borrower | originator | null
