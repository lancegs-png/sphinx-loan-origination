-- Loan documents: files attached to a loan, optionally to a specific checklist item.
--
-- Files are stored in the private "loan-documents" Supabase Storage bucket (accessed
-- server-side via the service role and served through short-lived signed URLs), and
-- mirrored into the deal's Google Drive folder when Drive is configured. This table
-- holds the metadata and lets the Documents tab list the files on each checklist item.

begin;

create table if not exists public.loan_documents (
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans (id) on delete cascade,
  checklist_item_id uuid references public.loan_checklist_items (id) on delete set null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  storage_path text,          -- path within the "loan-documents" bucket
  drive_file_id text,         -- Google Drive file id (when mirrored)
  drive_web_link text,        -- Google Drive webViewLink (when mirrored)
  uploaded_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index if not exists loan_documents_loan_idx on public.loan_documents (loan_id);
create index if not exists loan_documents_item_idx on public.loan_documents (checklist_item_id);

alter table public.loan_documents enable row level security;

-- Participants can see their loan's documents; the lending team manages them.
create policy loan_documents_select on public.loan_documents for select
  using (public.has_loan_access(loan_id));
create policy loan_documents_write on public.loan_documents for all
  using (public.is_lending_team() and public.has_loan_access(loan_id))
  with check (public.is_lending_team() and public.has_loan_access(loan_id));

-- Private bucket for the actual bytes (served via signed URLs from the server).
insert into storage.buckets (id, name, public)
values ('loan-documents', 'loan-documents', false)
on conflict (id) do nothing;

commit;
