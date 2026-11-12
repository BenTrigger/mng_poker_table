-- Poker table manager: initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Profiles (one per Google account)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  email text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    new.email
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Tables (a poker group) and their members
-- ---------------------------------------------------------------------------
create table public.poker_tables (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  owner_id uuid not null references public.profiles(id),
  last_settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.table_members (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  display_name text not null,
  avatar_url text,
  role text not null default 'player' check (role in ('admin', 'player')),
  status text not null default 'active' check (status in ('active', 'pending', 'removed')),
  created_at timestamptz not null default now(),
  unique (table_id, user_id)
);

create table public.chip_sets (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  name text not null,
  -- [{ "color": "אדום", "hex": "#d33", "value": 5 }, ...]
  chips jsonb not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Game nights
-- ---------------------------------------------------------------------------
create table public.game_nights (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  chip_set_id uuid references public.chip_sets(id),
  chips_per_buyin numeric not null,
  money_per_buyin numeric not null,
  cashier_member_id uuid references public.table_members(id),
  created_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  photos_purged boolean not null default false
);

create table public.night_players (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.game_nights(id) on delete cascade,
  member_id uuid not null references public.table_members(id) on delete cascade,
  seat int not null default 0,
  status text not null default 'playing' check (status in ('playing', 'out')),
  final_chips numeric,
  final_photo_path text,
  left_at timestamptz,
  -- filled when the player cashes out / the night closes (for stats)
  bought_money numeric,
  net numeric,
  unique (night_id, member_id)
);

create table public.chip_requests (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.game_nights(id) on delete cascade,
  member_id uuid not null references public.table_members(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  mode text not null check (mode in ('chips', 'money')),
  chips numeric not null,          -- chips requested
  given_chips numeric,             -- chips actually handed (after approval / correction)
  detected_chips numeric,          -- chips counted from the photo
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'flagged', 'rejected')),
  photo_path text,
  note text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Every important action is logged (audit trail for the night)
create table public.night_events (
  id bigint generated always as identity primary key,
  night_id uuid not null references public.game_nights(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.game_nights(id) on delete cascade,
  from_member uuid not null references public.table_members(id) on delete cascade,
  to_member uuid not null references public.table_members(id) on delete cascade,
  amount numeric not null,
  paid boolean not null default false,
  paid_at timestamptz
);

create index on public.table_members (user_id);
create index on public.game_nights (table_id, started_at desc);
create index on public.chip_requests (night_id);
create index on public.night_players (night_id);
create index on public.night_events (night_id, created_at);
create index on public.settlements (night_id);

-- ---------------------------------------------------------------------------
-- Helper functions for RLS
-- ---------------------------------------------------------------------------
create or replace function public.is_member(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from table_members
    where table_id = t and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_admin(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from table_members
    where table_id = t and user_id = auth.uid() and status = 'active' and role = 'admin'
  );
$$;

create or replace function public.night_table(n uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select table_id from game_nights where id = n;
$$;

create or replace function public.is_cashier(n uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from game_nights g join table_members m on m.id = g.cashier_member_id
    where g.id = n and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Create a table with a unique 6 character code; caller becomes admin.
create or replace function public.create_table(p_name text)
returns public.poker_tables language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_table poker_tables;
  v_profile profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_profile from profiles where id = auth.uid();
  loop
    v_code := upper(substr(translate(encode(gen_random_bytes(8), 'base64'), '+/=0O1IL', ''), 1, 6));
    exit when length(v_code) = 6 and not exists (select 1 from poker_tables where code = v_code);
  end loop;
  insert into poker_tables (code, name, owner_id) values (v_code, p_name, auth.uid()) returning * into v_table;
  insert into table_members (table_id, user_id, display_name, avatar_url, role)
  values (v_table.id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'admin');
  return v_table;
end $$;

-- Join with a table code. If p_member is a guest member of that table that has
-- not been claimed yet (personal invite link), the caller claims it and is
-- active immediately. Otherwise a pending membership request is created.
create or replace function public.join_table(p_code text, p_member uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_table poker_tables;
  v_profile profiles;
  v_existing table_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_table from poker_tables where code = upper(p_code);
  if v_table.id is null then raise exception 'table not found'; end if;
  select * into v_profile from profiles where id = auth.uid();

  select * into v_existing from table_members where table_id = v_table.id and user_id = auth.uid();
  if v_existing.id is not null then
    if v_existing.status = 'removed' then raise exception 'removed from table'; end if;
    return v_existing.status;
  end if;

  if p_member is not null then
    update table_members
       set user_id = auth.uid(), avatar_url = coalesce(avatar_url, v_profile.avatar_url), status = 'active'
     where id = p_member and table_id = v_table.id and user_id is null and status <> 'removed';
    if found then return 'active'; end if;
  end if;

  insert into table_members (table_id, user_id, display_name, avatar_url, status)
  values (v_table.id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'pending');
  return 'pending';
end $$;

-- Lookup a table name by code without being a member (for the join screen)
create or replace function public.peek_table(p_code text)
returns table (name text, code text) language sql stable security definer set search_path = public as $$
  select name, code from poker_tables where code = upper(p_code);
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.poker_tables enable row level security;
alter table public.table_members enable row level security;
alter table public.chip_sets enable row level security;
alter table public.game_nights enable row level security;
alter table public.night_players enable row level security;
alter table public.chip_requests enable row level security;
alter table public.night_events enable row level security;
alter table public.settlements enable row level security;

create policy "profiles readable by signed in" on public.profiles for select using (auth.uid() is not null);
create policy "own profile update" on public.profiles for update using (id = auth.uid());

create policy "tables: members read" on public.poker_tables for select using (public.is_member(id));
create policy "tables: admin update" on public.poker_tables for update using (public.is_admin(id));
create policy "tables: owner delete" on public.poker_tables for delete using (owner_id = auth.uid());

create policy "members: members read" on public.table_members for select
  using (public.is_member(table_id) or user_id = auth.uid());
create policy "members: admin insert" on public.table_members for insert with check (public.is_admin(table_id));
create policy "members: admin update" on public.table_members for update using (public.is_admin(table_id));
create policy "members: admin delete" on public.table_members for delete using (public.is_admin(table_id));

create policy "chipsets: members read" on public.chip_sets for select using (public.is_member(table_id));
create policy "chipsets: admin write" on public.chip_sets for all
  using (public.is_admin(table_id)) with check (public.is_admin(table_id));

create policy "nights: members read" on public.game_nights for select using (public.is_member(table_id));
create policy "nights: admin insert" on public.game_nights for insert with check (public.is_admin(table_id));
create policy "nights: admin or cashier update" on public.game_nights for update
  using (public.is_admin(table_id) or public.is_cashier(id));

create policy "night players: members read" on public.night_players for select
  using (public.is_member(public.night_table(night_id)));
create policy "night players: admin/cashier write" on public.night_players for all
  using (public.is_admin(public.night_table(night_id)) or public.is_cashier(night_id))
  with check (public.is_admin(public.night_table(night_id)) or public.is_cashier(night_id));

create policy "requests: members read" on public.chip_requests for select
  using (public.is_member(public.night_table(night_id)));
-- A player can request for themself; admin/cashier can request for anyone.
create policy "requests: insert" on public.chip_requests for insert with check (
  public.is_admin(public.night_table(night_id)) or public.is_cashier(night_id)
  or exists (select 1 from table_members m where m.id = member_id and m.user_id = auth.uid() and m.status = 'active')
);
create policy "requests: admin/cashier update" on public.chip_requests for update
  using (public.is_admin(public.night_table(night_id)) or public.is_cashier(night_id));
create policy "requests: cancel own pending" on public.chip_requests for delete using (
  status = 'pending' and (requested_by = auth.uid() or public.is_admin(public.night_table(night_id)))
);

create policy "events: members read" on public.night_events for select
  using (public.is_member(public.night_table(night_id)));
create policy "events: members insert" on public.night_events for insert
  with check (public.is_member(public.night_table(night_id)) and actor_id = auth.uid());

create policy "settlements: members read" on public.settlements for select
  using (public.is_member(public.night_table(night_id)));
create policy "settlements: admin write" on public.settlements for all
  using (public.is_admin(public.night_table(night_id))) with check (public.is_admin(public.night_table(night_id)));
-- The creditor (or admin) marks a debt as paid
create policy "settlements: creditor marks paid" on public.settlements for update using (
  exists (select 1 from table_members m where m.id = to_member and m.user_id = auth.uid())
);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.game_nights, public.night_players,
  public.chip_requests, public.night_events, public.table_members, public.settlements;

-- ---------------------------------------------------------------------------
-- Storage: private bucket for chip photos. Path: <night_id>/<file>.jpg
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('chip-photos', 'chip-photos', false)
on conflict (id) do nothing;

create policy "chip photos: members read" on storage.objects for select using (
  bucket_id = 'chip-photos' and public.is_member(public.night_table(((storage.foldername(name))[1])::uuid))
);
create policy "chip photos: members upload" on storage.objects for insert with check (
  bucket_id = 'chip-photos' and public.is_member(public.night_table(((storage.foldername(name))[1])::uuid))
);
create policy "chip photos: admin delete" on storage.objects for delete using (
  bucket_id = 'chip-photos' and public.is_admin(public.night_table(((storage.foldername(name))[1])::uuid))
);
