-- 0009_field_model.sql
-- P14: single source of truth — the loan field model.
-- Extends field_definitions, adds loan_field_values (one row per loan / field / idx)
-- with DB-enforced lock / verify / calculated rules, a current-value resolver, and
-- summary-column sync onto loans.
--
-- Additive and non-destructive: existing loans.custom_fields and loan_trade stay in
-- place until data is migrated and the code is repointed; the drops happen in a later
-- cleanup migration (0010) once nothing reads them.

-- ---------- 1. Extend field_definitions (the dictionary) ----------
alter table public.field_definitions
  add column if not exists verifiable boolean not null default false,
  add column if not exists repeat_group text,                    -- 'property' | 'guarantor' | null
  add column if not exists programs text[] not null default '{}', -- empty = all programs; else loan_type_keys (DSCR, RTL, ...)
  add column if not exists required_stage loan_stage,
  add column if not exists source text,                          -- intake | manual | calculated | system | config
  add column if not exists calc_key text;                        -- calc registry name; calculated fields are read-only

-- ---------- 2. loan_field_values (replaces new writes to custom_fields) ----------
create table if not exists public.loan_field_values (
  loan_id uuid not null references public.loans (id) on delete cascade,
  field_key text not null references public.field_definitions (key) on update cascade,
  idx int not null default 1,                 -- property 1..N or guarantor 1..N; 1 for non-repeating
  initial_value jsonb,
  verified_value jsonb,                       -- only allowed when the field is verifiable
  locked boolean not null default false,
  locked_by uuid references public.profiles (id),
  locked_at timestamptz,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  primary key (loan_id, field_key, idx)
);
create index if not exists loan_field_values_loan_idx on public.loan_field_values (loan_id);
create index if not exists loan_field_values_key_idx on public.loan_field_values (field_key);

-- ---------- 3. Enforcement rules (in the database, not only app code) ----------
-- The calc module (service role) sets `app.allow_calc_write = '1'` (transaction-local)
-- before writing calculated fields; nobody else may write them.
create or replace function public.enforce_loan_field_rules()
returns trigger
language plpgsql
as $$
declare
  v_verifiable boolean;
  v_source text;
  calc_ok boolean := coalesce(current_setting('app.allow_calc_write', true), '') = '1';
begin
  select verifiable, source into v_verifiable, v_source
  from public.field_definitions where key = new.field_key;
  if not found then
    raise exception 'Unknown field_key %', new.field_key;
  end if;

  if new.verified_value is not null and not v_verifiable then
    raise exception 'Field % is not verifiable; verified_value not allowed', new.field_key;
  end if;

  if v_source = 'calculated' and not calc_ok then
    raise exception 'Field % is calculated and read-only', new.field_key;
  end if;

  -- A locked row rejects any value change while it stays locked. Unlocking is a
  -- separate, explicit update (locked -> false); the value changes on a later write.
  if tg_op = 'UPDATE' and old.locked and new.locked then
    if new.initial_value is distinct from old.initial_value
       or new.verified_value is distinct from old.verified_value then
      raise exception 'Field % (idx %) is locked', new.field_key, new.idx;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists loan_field_values_rules on public.loan_field_values;
create trigger loan_field_values_rules
  before insert or update on public.loan_field_values
  for each row execute function public.enforce_loan_field_rules();

-- ---------- 4. Current-value resolvers ----------
-- "Current value" = verified_value if present, else initial_value.
create or replace function public.loan_field_current(p_loan_id uuid)
returns table (field_key text, idx int, value jsonb)
language sql
stable
as $$
  select field_key, idx, coalesce(verified_value, initial_value)
  from public.loan_field_values
  where loan_id = p_loan_id;
$$;

create or replace function public.loan_field_value(p_loan_id uuid, p_key text, p_idx int default 1)
returns jsonb
language sql
stable
as $$
  select coalesce(verified_value, initial_value)
  from public.loan_field_values
  where loan_id = p_loan_id and field_key = p_key and idx = p_idx;
$$;

-- ---------- 5. Summary columns on loans, synced from field values ----------
-- Field values are authoritative; these columns are derived for list views.
alter table public.loans
  add column if not exists closing_date date,
  add column if not exists loan_program text;

create or replace function public.sync_loan_summary()
returns trigger
language plpgsql
as $$
declare
  k text := coalesce(new.field_key, old.field_key);
  i int := coalesce(new.idx, old.idx);
  lid uuid := coalesce(new.loan_id, old.loan_id);
  v jsonb;
begin
  if i <> 1 then return coalesce(new, old); end if;
  if k not in ('loan_amount','property_address','borrower_entity','loan_program','closing_date') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    v := null;
  else
    v := coalesce(new.verified_value, new.initial_value);
  end if;

  if k = 'loan_amount' then
    update public.loans set loan_amount = nullif(v #>> '{}', '')::numeric where id = lid;
  elsif k = 'property_address' then
    update public.loans set property_address = v #>> '{}' where id = lid;
  elsif k = 'borrower_entity' then
    update public.loans set borrower_name = v #>> '{}' where id = lid;   -- summary "Borrower" column = borrowing entity
  elsif k = 'loan_program' then
    update public.loans set loan_program = v #>> '{}', loan_type = v #>> '{}' where id = lid;  -- D2: loan_type mirrors loan_program
  elsif k = 'closing_date' then
    update public.loans set closing_date = nullif(v #>> '{}', '')::date where id = lid;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists loan_field_values_summary on public.loan_field_values;
create trigger loan_field_values_summary
  after insert or update or delete on public.loan_field_values
  for each row execute function public.sync_loan_summary();

-- ---------- 6. RLS ----------
alter table public.loan_field_values enable row level security;

-- Read: lender-only / trade fields to the lending team; everything else follows loan access.
create policy loan_field_values_select on public.loan_field_values for select
  using (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or not exists (
        select 1 from public.field_definitions d where d.key = field_key and d.lender_only
      )
    )
  );

-- Write: the lending team may write any field on loans they can access; other
-- participants may write only non-lender fields (calculated fields are blocked by the
-- trigger above regardless). The service role bypasses RLS for intake / calc writes.
create policy loan_field_values_write on public.loan_field_values for all
  using (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or not exists (
        select 1 from public.field_definitions d where d.key = field_key and d.lender_only
      )
    )
  )
  with check (
    public.has_loan_access(loan_id)
    and (
      public.is_lending_team()
      or not exists (
        select 1 from public.field_definitions d where d.key = field_key and d.lender_only
      )
    )
  );

-- Stream field changes to subscribed clients (mirrors messages / loans).
alter publication supabase_realtime add table public.loan_field_values;
