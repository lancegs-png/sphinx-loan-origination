-- 0027_title_insurance_docs.sql
-- Add two new document sections to every program's checklist, matching the
-- Program Configuration sheet:
--   * Title documents (visible to all): Title Commitment, CPL, Wiring Instructions,
--     E&O Insurance, Tax Cert, Estimated Settlement Statement.
--   * Insurance documents (visible to all): Evidence of Insurance (moved here from
--     Lender documents) and a new Insurance Invoice.
--
-- The app reads a document's section (category) and Access (visibility) live from
-- program_checklist_items, so existing loans pick these up on next view (the
-- checklist materializer tops up by set difference). Evidence of Insurance keeps its
-- uploaded files — only its category/visibility change.

-- New document types (idempotent by key).
insert into public.document_types (key, name)
values
  ('title_commitment',               'Title Commitment'),
  ('cpl',                            'CPL'),
  ('wiring_instructions',            'Wiring Instructions'),
  ('eo_insurance',                   'E&O Insurance'),
  ('tax_cert',                       'Tax Cert'),
  ('estimated_settlement_statement', 'Estimated Settlement Statement'),
  ('insurance_invoice',              'Insurance Invoice')
on conflict (key) do nothing;

-- Add the new documents to every program's checklist (visible to all).
insert into public.program_checklist_items
  (program_id, document_type_id, required, assignee, category, visibility, sort)
select lp.id, dt.id, true, 'borrower', d.category, 'all', d.sort
from public.loan_programs lp
cross join (values
  ('title_commitment',               'Title documents',     280),
  ('cpl',                            'Title documents',     290),
  ('wiring_instructions',            'Title documents',     300),
  ('eo_insurance',                   'Title documents',     310),
  ('tax_cert',                       'Title documents',     320),
  ('estimated_settlement_statement', 'Title documents',     330),
  ('insurance_invoice',              'Insurance documents', 340)
) as d(key, category, sort)
join public.document_types dt on dt.key = d.key
on conflict (program_id, document_type_id) do update
  set category   = excluded.category,
      visibility = excluded.visibility,
      sort       = excluded.sort,
      required   = excluded.required;

-- Move Evidence of Insurance into the Insurance documents section, visible to all,
-- across every program it already appears in (keeps its uploaded files).
update public.program_checklist_items pci
set category = 'Insurance documents', visibility = 'all'
from public.document_types dt
where pci.document_type_id = dt.id
  and dt.key = 'evidence_of_insurance';
