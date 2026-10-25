-- 0004_app_settings.sql
-- Global key/value settings (M3). First use: the global intake config
-- (base questions, default style, default examples) that applies before a
-- loan program is known. Reusable for other org-wide settings later.

create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Lending team may read; only admins write. The intake agent reads it server-side
-- via the service role (it's global config, not loan data).
create policy app_settings_select on public.app_settings for select
  using (public.is_lending_team());
create policy app_settings_write on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());
