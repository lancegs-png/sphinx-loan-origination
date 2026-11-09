-- Dedupe document_types.
--
-- A batch of document types added 2026-11-07 overlapped the original seed. This
-- collapses two kinds of duplicates onto a single canonical row each:
--   1. 7 EXACT-name duplicates (Borrower IDs, Certificate of Good Standing,
--      Evidence of Insurance, OFAC Search Results, Operating Agreement or Bylaws,
--      Rental Ledgers / Proof of Rent, Voided Check for ACH) -> keep earliest.
--   2. 6 REWORDED near-duplicates -> keep the name chosen by the lending team.
--
-- The checklist FK is ON DELETE CASCADE with UNIQUE (program_id, document_type_id),
-- so we re-point any checklist references onto the kept row BEFORE deleting the
-- extras, then add a unique index so exact-name dups can't recur.
--
-- Safe to re-run: name joins simply no-op once the duplicates are gone.

begin;

-- old_id -> kept id, for every row that should be merged away.
create temporary table dt_map (old_id uuid, keep_id uuid) on commit drop;

-- 1. Exact-name duplicates: canonical = earliest created (tie-break by id).
insert into dt_map (old_id, keep_id)
select d.id, c.keep_id
from public.document_types d
join (
  select distinct on (name) name, id as keep_id
  from public.document_types
  order by name, created_at, id
) c on c.name = d.name
where d.id <> c.keep_id;

-- 2. Reworded near-duplicates: explicit keep choices (match by name).
insert into dt_map (old_id, keep_id)
select d_old.id, d_keep.id
from (values
  ('Background Check (Personal/Business)', 'Background Check'),
  ('EIN Letter or W9',                     'EIN Letter or W9 Form'),
  ('Track Record / REO',                   'Track Record / REO Schedule'),
  ('Two Months'' Bank Statements',         'Bank Statements (2 months)'),
  ('Settlement Statement / HUD',           'Original Settlement Statement'),
  ('VOM Primary and Subject',              'Verification of Mortgage (VOM)')
) as pairs(old_name, keep_name)
join public.document_types d_old  on d_old.name  = pairs.old_name
join public.document_types d_keep on d_keep.name = pairs.keep_name;

-- 3. Drop checklist rows that would collide with an existing (program, kept)
--    pair once re-pointed (UNIQUE constraint), so the re-point can't fail.
delete from public.program_checklist_items ci
using dt_map m
where ci.document_type_id = m.old_id
  and exists (
    select 1 from public.program_checklist_items keep
    where keep.program_id = ci.program_id
      and keep.document_type_id = m.keep_id
  );

-- 4. Re-point the remaining references onto the kept document type.
update public.program_checklist_items ci
set document_type_id = m.keep_id
from dt_map m
where ci.document_type_id = m.old_id;

-- 5. Remove the now-unreferenced duplicate document types.
delete from public.document_types d
using dt_map m
where d.id = m.old_id;

-- 6. Prevent future exact-name duplicates.
create unique index if not exists document_types_name_key
  on public.document_types (name);

commit;
