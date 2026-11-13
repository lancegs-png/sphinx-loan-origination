-- 0019_loan_archived_status.sql
-- Add an 'archived' loan status so test / dead loans can be hidden from the pipeline
-- (reversible) instead of hard-deleted. The pipeline (src/app/page.tsx) filters out
-- loans whose status is 'archived'; /api/admin/loans can archive / unarchive by id.
--
-- NOTE: a new enum value cannot be *used* in the same transaction that adds it, so this
-- migration only adds the value. Setting loans.status = 'archived' happens afterwards.

alter type public.loan_status add value if not exists 'archived';
