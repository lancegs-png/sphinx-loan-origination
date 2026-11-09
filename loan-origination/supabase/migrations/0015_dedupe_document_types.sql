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
-- The old_id -> keep_id mapping is recomputed inline (as a CTE) in each step
-- instead of a temp table, so it runs correctly in the Supabase SQL editor
-- (which auto-commits each statement). document_types is not modified until the
-- final step, so every step sees the same mapping. Safe to re-run.

begin;

-- 1. Drop checklist rows that would collide with an existing (program, kept)
--    pair once re-pointed (UNIQUE constraint), so the re-point can't fail.
with dup_map as (
  select d.id as old_id, c.keep_id
  from public.document_types d
  join (
    select distinct on (name) name, id as keep_id
    from public.document_types
    order by name, created_at, id
  ) c on c.name = d.name
  where d.id <> c.keep_id
  union
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
  join public.document_types d_keep on d_keep.name = pairs.keep_name
)
delete from public.program_checklist_items ci
using dup_map m
where ci.document_type_id = m.old_id
  and exists (
    select 1 from public.program_checklist_items keep
    where keep.program_id = ci.program_id
      and keep.document_type_id = m.keep_id
  );

-- 2. Re-point the remaining references onto the kept document type.
with dup_map as (
  select d.id as old_id, c.keep_id
  from public.document_types d
  join (
    select distinct on (name) name, id as keep_id
    from public.document_types
    order by name, created_at, id
  ) c on c.name = d.name
  where d.id <> c.keep_id
  union
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
  join public.document_types d_keep on d_keep.name = pairs.keep_name
)
update public.program_checklist_items ci
set document_type_id = m.keep_id
from dup_map m
where ci.document_type_id = m.old_id;

-- 3. Remove the now-unreferenced duplicate document types.
with dup_map as (
  select d.id as old_id, c.keep_id
  from public.document_types d
  join (
    select distinct on (name) name, id as keep_id
    from public.document_types
    order by name, created_at, id
  ) c on c.name = d.name
  where d.id <> c.keep_id
  union
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
  join public.document_types d_keep on d_keep.name = pairs.keep_name
)
delete from public.document_types d
using dup_map m
where d.id = m.old_id;

-- 4. Prevent future exact-name duplicates.
create unique index if not exists document_types_name_key
  on public.document_types (name);

commit;
