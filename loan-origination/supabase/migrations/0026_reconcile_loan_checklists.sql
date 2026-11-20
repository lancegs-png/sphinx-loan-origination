-- 0026_reconcile_loan_checklists.sql
-- Reconcile every loan's document checklist to its program template after the
-- Program Configuration re-import.
--
-- Background: a loan's checklist (loan_checklist_items) only stores the status +
-- notes; name, category and Access are read live from the program template. The
-- re-import updated each program's template to match the sheet, but:
--   * loans "top up" their checklist by row count, so the renamed/added documents
--     (e.g. "Two Months' Bank Statements") never appeared on existing loans; and
--   * the pre-rename documents ("Bank Statements (2 months)", etc.) and a handful of
--     app-only extras (SiteX, LoanSafe Report, …) stayed on every loan, showing up
--     under "Other Documents".
--
-- This runs three steps, in order, and never deletes a file:
--   1) materialize every template document a loan is missing;
--   2) move uploaded files (and any meaningful status) from the old pre-rename
--      document types onto their sheet equivalents;
--   3) drop the leftover rows for documents no longer in the loan's template that
--      carry no files — any row that still has a file is left in place.
--
-- Idempotent: safe to re-run (guards on "not exists").

-- 1) Materialize missing template documents on every loan.
insert into public.loan_checklist_items (loan_id, document_type_id, status)
select l.id, pci.document_type_id, 'outstanding'
from public.loans l
join public.program_checklist_items pci on pci.program_id = l.program_id
where l.program_id is not null
  and not exists (
    select 1 from public.loan_checklist_items lci
    where lci.loan_id = l.id and lci.document_type_id = pci.document_type_id
  )
on conflict (loan_id, document_type_id) do nothing;

-- 2) For each renamed document, carry the old row's status/notes and move its files
--    onto the new (sheet) document's row. Only acts where the loan already has the
--    new row (step 1 created it when the new doc is in the loan's program), so a file
--    always lands on a real checklist row.
do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('Bank Statements (2 months)',    'Two Months'' Bank Statements'),
      ('Track Record / REO Schedule',   'Track Record / REO'),
      ('Background Check',              'Background Check (Personal/Business)'),
      ('Verification of Mortgage (VOM)', 'VOM Primary and Subject')
    ) as t(old_name, new_name)
  loop
    -- Carry a meaningful status/notes forward (don't clobber a status already set
    -- on the new row).
    update public.loan_checklist_items newlci
    set status = oldlci.status,
        notes  = coalesce(newlci.notes, oldlci.notes)
    from public.loan_checklist_items oldlci
    join public.document_types olddt on olddt.id = oldlci.document_type_id and olddt.name = pair.old_name
    join public.document_types newdt on newdt.name = pair.new_name
    where newlci.document_type_id = newdt.id
      and newlci.loan_id = oldlci.loan_id
      and coalesce(oldlci.status, 'outstanding') <> 'outstanding'
      and coalesce(newlci.status, 'outstanding') =  'outstanding';

    -- Move the uploaded files.
    update public.loan_documents d
    set checklist_item_id = newlci.id
    from public.loan_checklist_items oldlci
    join public.document_types olddt on olddt.id = oldlci.document_type_id and olddt.name = pair.old_name
    join public.document_types newdt on newdt.name = pair.new_name
    join public.loan_checklist_items newlci
      on newlci.loan_id = oldlci.loan_id and newlci.document_type_id = newdt.id
    where d.checklist_item_id = oldlci.id;
  end loop;
end $$;

-- 3) Remove per-loan rows for documents no longer in the loan's template that have
--    no files. File-bearing rows for non-template docs are left in place so nothing
--    uploaded is lost.
delete from public.loan_checklist_items lci
using public.loans l
where lci.loan_id = l.id
  and l.program_id is not null
  and not exists (
    select 1 from public.program_checklist_items pci
    where pci.program_id = l.program_id and pci.document_type_id = lci.document_type_id
  )
  and not exists (
    select 1 from public.loan_documents d where d.checklist_item_id = lci.id
  );
