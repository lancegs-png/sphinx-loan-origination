-- 0031_document_types_readable.sql
-- The document checklist rendered with blank item names for brokers and borrowers.
--
-- 0022 relaxed program_checklist_items (category / visibility / assignee) to any authenticated
-- user so non-lenders' checklist loaders work, but document_types — which holds the actual
-- document NAME — was left lending-team-only (0006). So loadLoanChecklist, run with the user's
-- own client, could read the checklist rows and their category groups but not resolve the names,
-- leaving every row's Item column blank.
--
-- Relax document_types reads to any authenticated user, matching the 0022 pattern. Document type
-- names and naming conventions are non-sensitive config; writes stay admin-only.
drop policy if exists document_types_select on public.document_types;
create policy document_types_select on public.document_types for select
  using (auth.role() = 'authenticated');
