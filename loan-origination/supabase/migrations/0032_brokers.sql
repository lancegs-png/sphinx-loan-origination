-- 0032_brokers.sql
-- Reusable broker directory: brokers (name/email/phone) saved once and reused across deals, like
-- the guarantor/entity library. Unified with the broker portal: a broker that has a portal account
-- is linked here via user_id, so the one directory covers both saved contacts and accounts. Picking
-- a directory broker copies its contact onto the loan and, when it's an account, links that broker
-- as a deal participant. Lending-team only (RLS).

create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  user_id uuid references public.profiles(id) on delete set null, -- broker portal account, when linked
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one directory row per broker account.
create unique index if not exists brokers_user_id_key on public.brokers (user_id) where user_id is not null;
create index if not exists brokers_email_idx on public.brokers (lower(email));

alter table public.brokers enable row level security;
drop policy if exists brokers_rw on public.brokers;
create policy brokers_rw on public.brokers
  for all using (public.is_lending_team()) with check (public.is_lending_team());

-- Seed the directory with existing broker portal accounts so they show in the picker.
insert into public.brokers (name, email, user_id, created_by)
select p.full_name, p.email, p.id, p.id
from public.profiles p
where p.external_type = 'broker'
  and not exists (select 1 from public.brokers b where b.user_id = p.id);
