-- 0028_intake_links.sql
-- Shareable public intake links (Phase 3 of the intake work). Each link renders the public
-- intake form at /apply/<token> and opens an Opportunity on submit, attributed to the link's
-- owner (a Sphinx originator app user, or an external broker / referral partner by name+email).
-- Links are Sphinx-branded or white-label (no Sphinx identity). The lending team manages them
-- in Settings → Intake Links. The public route has no auth and reads links through the service
-- role, so anon/public gets no table access.

create table if not exists public.intake_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text not null,
  owner_type text not null check (owner_type in ('sphinx_originator', 'broker', 'referral_partner')),
  owner_user_id uuid references public.profiles(id) on delete set null, -- for sphinx_originator
  owner_name text,  -- for broker / referral_partner
  owner_email text, -- for broker / referral_partner
  branding text not null default 'sphinx' check (branding in ('sphinx', 'white_label')),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Submission log: powers per-link rate limiting, submission counts, and a light audit trail.
-- Public inserts go through the service role (no anon RLS).
create table if not exists public.intake_submissions (
  id uuid primary key default gen_random_uuid(),
  link_id uuid references public.intake_links(id) on delete set null,
  token text,
  loan_id uuid references public.loans(id) on delete set null,
  ip text,
  created_at timestamptz not null default now()
);
create index if not exists intake_submissions_token_created_idx
  on public.intake_submissions (token, created_at desc);
create index if not exists intake_submissions_link_idx
  on public.intake_submissions (link_id);

alter table public.intake_links enable row level security;
alter table public.intake_submissions enable row level security;

-- Lending team manages links and reads the submission log. Anon/public has no access — the
-- public /apply route reads and writes through the service role.
drop policy if exists intake_links_rw on public.intake_links;
create policy intake_links_rw on public.intake_links
  for all using (public.is_lending_team()) with check (public.is_lending_team());

drop policy if exists intake_submissions_ro on public.intake_submissions;
create policy intake_submissions_ro on public.intake_submissions
  for select using (public.is_lending_team());
