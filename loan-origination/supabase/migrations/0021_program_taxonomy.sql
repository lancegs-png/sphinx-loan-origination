-- 0021_program_taxonomy.sql
-- Organize loan programs under two asset classes (residential | commercial) and give
-- each program a stable display order. Adds the one missing program (Commercial New
-- Construction) so the catalog is the canonical 7:
--
--   RESIDENTIAL                         COMMERCIAL
--     Bridge            (bridge)          Bridge            (commercial_bridge)
--     Fix & Flip        (fix_and_flip)    New Construction  (commercial_new_construction)
--     New Construction  (new_construction) Permanent        (commercial_permanent)
--     DSCR              (dscr)
--
-- Idempotent. The six pre-existing rows keep their ids, so existing loans keep program_id.

alter table public.loan_programs
  add column if not exists asset_class text,
  add column if not exists sort int not null default 0;

-- Insert the one new program (Commercial New Construction). No-op if already present.
insert into public.loan_programs (name, loan_type_key, public_info) values
  ('Commercial New Construction', 'commercial_new_construction', 'Ground-up commercial construction financing.')
on conflict (loan_type_key) do nothing;

-- Classify + order the canonical seven by loan_type_key.
update public.loan_programs set asset_class = 'residential', sort = 0 where loan_type_key = 'bridge';
update public.loan_programs set asset_class = 'residential', sort = 1 where loan_type_key = 'fix_and_flip';
update public.loan_programs set asset_class = 'residential', sort = 2 where loan_type_key = 'new_construction';
update public.loan_programs set asset_class = 'residential', sort = 3 where loan_type_key = 'dscr';
update public.loan_programs set asset_class = 'commercial',  sort = 4 where loan_type_key = 'commercial_bridge';
update public.loan_programs set asset_class = 'commercial',  sort = 5 where loan_type_key = 'commercial_new_construction';
update public.loan_programs set asset_class = 'commercial',  sort = 6 where loan_type_key = 'commercial_permanent';

-- Any program row not covered above (hand-added) defaults to residential so the
-- CHECK constraint below can be added safely.
update public.loan_programs set asset_class = 'residential' where asset_class is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'loan_programs_asset_class_chk'
  ) then
    alter table public.loan_programs
      add constraint loan_programs_asset_class_chk
      check (asset_class in ('residential', 'commercial'));
  end if;
end $$;
