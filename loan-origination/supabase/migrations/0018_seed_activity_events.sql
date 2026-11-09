-- Seed the activity log with events we can reconstruct from existing timestamps,
-- so the new Activity tab isn't empty for loans that already exist. Going forward,
-- events are written live by the app. Checklist status changes are already logged.
--
-- Safe to re-run: each insert skips rows it has already seeded.

begin;

-- Loan creation (from loans.created_at / created_by).
insert into public.audit_events (loan_id, actor_id, actor_kind, event_type, is_internal, payload, created_at)
select l.id, l.created_by, 'human', 'loan_created', false, jsonb_build_object('seeded', true), l.created_at
from public.loans l
where not exists (
  select 1 from public.audit_events a
  where a.loan_id = l.id and a.event_type = 'loan_created'
);

-- Existing document uploads (only if the loan_documents table is present).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'loan_documents'
  ) then
    insert into public.audit_events (loan_id, actor_id, actor_kind, event_type, is_internal, payload, created_at)
    select d.loan_id, d.uploaded_by, 'human', 'document_uploaded', false,
           jsonb_build_object('file_name', d.file_name, 'seeded', true), d.created_at
    from public.loan_documents d
    where not exists (
      select 1 from public.audit_events a
      where a.loan_id = d.loan_id
        and a.event_type = 'document_uploaded'
        and a.payload->>'file_name' = d.file_name
        and a.created_at = d.created_at
    );
  end if;
end $$;

commit;
