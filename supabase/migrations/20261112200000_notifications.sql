-- Notifications: an in-app "recent notifications" list for every user, plus
-- phone push (Web Push) for the devices they enabled it on.
--
-- Rows are written only by the triggers below (security definer), never by
-- clients. The person who caused an event is never notified about it.
-- Push delivery: after notifications are inserted, a statement trigger pings
-- the app's /api/push/dispatch through pg_net (when it is available and the
-- production build stored the URL in app_meta.config). The endpoint claims the
-- rows that were not pushed yet and sends them to the users' devices.

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  table_id uuid references public.poker_tables(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  url text,
  dedupe text,              -- same key twice for the same user = one notification
  read_at timestamptz,
  pushed_at timestamptz,    -- set once the push sender handled it
  created_at timestamptz not null default now(),
  unique (user_id, dedupe)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unpushed_idx on public.notifications (id) where pushed_at is null;

alter table public.notifications enable row level security;
create policy "notifications: own read" on public.notifications for select using (user_id = auth.uid());
create policy "notifications: own delete" on public.notifications for delete using (user_id = auth.uid());
-- no insert/update policies: rows come from triggers, read marks from mark_notifications_read()

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
create policy "push: own read" on public.push_subscriptions for select using (user_id = auth.uid());
create policy "push: own delete" on public.push_subscriptions for delete using (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when others then null;
end $$;

-- Save this device's push subscription for the signed-in user. A phone that
-- changes hands (sign out, other account) moves to the new user.
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 1000 then raise exception 'bad endpoint'; end if;
  insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- p_ids null = all of mine
create or replace function public.mark_notifications_read(p_ids bigint[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;

revoke execute on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text),
  public.mark_notifications_read(bigint[]) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text), public.remove_push_subscription(text),
  public.mark_notifications_read(bigint[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "יום ה׳ 13.11 · 20:30" in Israel time
create or replace function public.notif_when(p timestamptz)
returns text language sql stable set search_path = public as $$
  select (array['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','שבת'])[extract(dow from p at time zone 'Asia/Jerusalem')::int + 1]
    || ' ' || to_char(p at time zone 'Asia/Jerusalem', 'DD.MM · HH24:MI')
$$;

-- Insert one notification per user (nulls, duplicates and the acting user skipped).
create or replace function public.notify_users(
  p_users uuid[], p_table uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (user_id, table_id, kind, title, body, url, dedupe)
  select distinct u, p_table, p_kind, p_title, coalesce(p_body, ''), p_url, p_dedupe
    from unnest(p_users) u
   where u is not null
     and u is distinct from auth.uid()
     and exists (select 1 from profiles where id = u)
  on conflict (user_id, dedupe) do nothing;
end $$;

create or replace function public.table_user_ids(p_table uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from table_members
   where table_id = p_table and status = 'active' and user_id is not null
$$;

create or replace function public.signup_user_ids(p_signup uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id), '{}') from signup_seats s join table_members m on m.id = s.member_id
   where s.signup_id = p_signup and m.user_id is not null
$$;

create or replace function public.tournament_user_ids(p_t uuid)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.user_id), '{}') from tournament_entries e join table_members m on m.id = e.member_id
   where e.tournament_id = p_t and m.user_id is not null
$$;

create or replace function public.notif_place(p_location text, p_address text)
returns text language sql immutable as $$
  select nullif(concat_ws(' · ', nullif(trim(p_location), ''), nullif(trim(p_address), '')), '')
$$;

revoke execute on function public.notify_users(uuid[], uuid, text, text, text, text, text), public.table_user_ids(uuid),
  public.signup_user_ids(uuid), public.tournament_user_ids(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Push dispatch ping (pg_net, production only)
-- ---------------------------------------------------------------------------
create schema if not exists app_meta;
revoke all on schema app_meta from public;
create table if not exists app_meta.config (key text primary key, value text not null);
-- shared secret the database sends with each ping; the app reads it from here
insert into app_meta.config (key, value) values ('push_dispatch_secret', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;
-- the VAPID key pair for Web Push is created by the app on first use and kept
-- here too (app_meta is not reachable through the API), so no manual setup.

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net not available, push dispatch ping disabled';
end $$;

create or replace function public.notifications_dispatch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_meta.config where key = 'push_dispatch_url';
  if v_url is null or to_regproc('net.http_post') is null then return null; end if;
  select value into v_secret from app_meta.config where key = 'push_dispatch_secret';
  begin
    execute 'select net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 10000)'
      using v_url, jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || coalesce(v_secret, ''));
  exception when others then
    raise warning 'push dispatch ping failed: %', sqlerrm; -- never block the action itself
  end;
  return null;
end $$;

drop trigger if exists notifications_dispatch on public.notifications;
create trigger notifications_dispatch after insert on public.notifications
  for each statement execute function public.notifications_dispatch();

-- ---------------------------------------------------------------------------
-- Early sign-ups
-- ---------------------------------------------------------------------------
create or replace function public.signups_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_changes text[] := '{}';
begin
  select name into v_name from poker_tables where id = new.table_id;
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      perform notify_users(table_user_ids(new.table_id), new.table_id, 'signup_open',
        'נפתחה הרשמה לערב פוקר 🃏',
        concat_ws(' · ', v_name, notif_when(new.starts_at), notif_place(new.location, new.address)) || '. כנסו לתפוס מקום',
        '/s/' || new.id, 'signup_open:' || new.id);
    end if;
    return null;
  end if;

  -- details changed (only while the night is still ahead)
  if new.status in ('open', 'closed') then
    if new.starts_at is distinct from old.starts_at then
      v_changes := v_changes || ('מועד: ' || notif_when(new.starts_at));
    end if;
    if new.location is distinct from old.location and coalesce(trim(new.location), '') <> '' then
      v_changes := v_changes || ('מארח: ' || new.location);
    end if;
    if new.address is distinct from old.address and coalesce(trim(new.address), '') <> '' then
      v_changes := v_changes || ('כתובת: ' || new.address);
    end if;
    if cardinality(v_changes) > 0 then
      perform notify_users(signup_user_ids(new.id), new.table_id, 'signup_changed',
        'עודכנו פרטי הערב', v_name || ' · ' || array_to_string(v_changes, ' · '), '/s/' || new.id);
    end if;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform notify_users(signup_user_ids(new.id), new.table_id, 'signup_cancelled',
      'הערב בוטל', v_name || ' · ' || notif_when(new.starts_at), '/s/' || new.id, 'signup_cancelled:' || new.id);
  elsif new.status = 'open' and old.status = 'closed' then
    null; -- reopened: no noise
  end if;
  return null;
end $$;

drop trigger if exists signups_notify on public.signups;
create trigger signups_notify after insert or update on public.signups
  for each row execute function public.signups_notify();

create or replace function public.signup_seats_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
  v_m table_members;
  v_name text;
begin
  select * into v_s from signups where id = new.signup_id;
  select * into v_m from table_members where id = new.member_id;
  if v_s.status not in ('open', 'closed') then return null; end if;
  select name into v_name from poker_tables where id = v_s.table_id;

  if tg_op = 'UPDATE' then
    if old.seat is null and new.seat is not null then
      perform notify_users(array[v_m.user_id], v_s.table_id, 'seat_freed',
        'התפנה לך מקום! 🎉', 'עלית מרשימת ההמתנה לכיסא ' || new.seat || ' · ' || v_name || ' · ' || notif_when(v_s.starts_at),
        '/s/' || v_s.id);
    end if;
    return null;
  end if;

  if v_m.user_id is not distinct from auth.uid() then
    -- a player signed up: tell the admin who opened the sign-up
    perform notify_users(array[v_s.created_by], v_s.table_id, 'signup_joined',
      v_m.display_name || (case when new.seat is null then ' ברשימת ההמתנה' else ' נרשם לערב' end),
      v_name || ' · ' || notif_when(v_s.starts_at), '/s/' || v_s.id);
  else
    -- the admin seated someone
    perform notify_users(array[v_m.user_id], v_s.table_id, 'signup_added',
      'נרשמת לערב פוקר', v_name || ' · ' || notif_when(v_s.starts_at) || coalesce(' · ' || notif_place(v_s.location, v_s.address), ''),
      '/s/' || v_s.id);
  end if;
  return null;
end $$;

drop trigger if exists signup_seats_notify on public.signup_seats;
create trigger signup_seats_notify after insert or update of seat on public.signup_seats
  for each row execute function public.signup_seats_notify();

-- ---------------------------------------------------------------------------
-- Game nights
-- ---------------------------------------------------------------------------
create or replace function public.game_nights_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_t poker_tables;
  v_users uuid[];
begin
  select * into v_t from poker_tables where id = new.table_id;
  if tg_op = 'INSERT' then
    if new.status = 'open' then
      perform notify_users(table_user_ids(new.table_id), new.table_id, 'night_started',
        'המשחק התחיל! בואו לשולחן ♠️', v_t.name || ' · הערב נפתח עכשיו',
        '/t/' || v_t.code || '/n/' || new.id, 'night_started:' || new.id);
    end if;
  elsif new.status = 'closed' and old.status = 'open' then
    select coalesce(array_agg(m.user_id), '{}') into v_users
      from night_players p join table_members m on m.id = p.member_id where p.night_id = new.id;
    perform notify_users(v_users, new.table_id, 'night_closed',
      'הערב נסגר', v_t.name || ' · הסיכום ומי מעביר למי מחכים באפליקציה',
      '/t/' || v_t.code || '/n/' || new.id, 'night_closed:' || new.id);
  end if;
  return null;
end $$;

drop trigger if exists game_nights_notify on public.game_nights;
create trigger game_nights_notify after insert or update of status on public.game_nights
  for each row execute function public.game_nights_notify();

-- A chip request waiting for the cashier
create or replace function public.chip_requests_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_g game_nights;
  v_code text;
  v_cashier uuid;
  v_name text;
begin
  if new.status <> 'pending' then return null; end if;
  select * into v_g from game_nights where id = new.night_id;
  select user_id into v_cashier from table_members where id = v_g.cashier_member_id;
  select display_name into v_name from table_members where id = new.member_id;
  select code into v_code from poker_tables where id = v_g.table_id;
  perform notify_users(array[v_cashier], v_g.table_id, 'chip_request',
    'בקשת צ׳יפים', v_name || ' מבקש ' || trim(to_char(new.chips, 'FM999,999,990')) || ' צ׳יפים',
    '/t/' || v_code || '/n/' || v_g.id);
  return null;
end $$;

drop trigger if exists chip_requests_notify on public.chip_requests;
create trigger chip_requests_notify after insert on public.chip_requests
  for each row execute function public.chip_requests_notify();

-- ---------------------------------------------------------------------------
-- Tournaments
-- ---------------------------------------------------------------------------
create or replace function public.tournaments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_changes text[] := '{}';
begin
  select name into v_name from poker_tables where id = new.table_id;
  if tg_op = 'INSERT' then
    if new.status = 'registration' then
      perform notify_users(table_user_ids(new.table_id), new.table_id, 'tournament_open',
        'נפתחה הרשמה לטורניר 🏆',
        concat_ws(' · ', new.name, notif_when(new.starts_at), notif_place(new.location, new.address)),
        '/tr/' || new.id, 'tournament_open:' || new.id);
    end if;
    return null;
  end if;

  if new.status = 'registration' then
    if new.starts_at is distinct from old.starts_at then
      v_changes := v_changes || ('מועד: ' || notif_when(new.starts_at));
    end if;
    if new.location is distinct from old.location and coalesce(trim(new.location), '') <> '' then
      v_changes := v_changes || ('מארח: ' || new.location);
    end if;
    if new.address is distinct from old.address and coalesce(trim(new.address), '') <> '' then
      v_changes := v_changes || ('כתובת: ' || new.address);
    end if;
    if cardinality(v_changes) > 0 then
      perform notify_users(tournament_user_ids(new.id), new.table_id, 'tournament_changed',
        'עודכנו פרטי הטורניר', new.name || ' · ' || array_to_string(v_changes, ' · '), '/tr/' || new.id);
    end if;
  end if;

  if new.status = 'running' and old.status = 'registration' then
    perform notify_users(
      (select coalesce(array_agg(m.user_id), '{}') from tournament_entries e join table_members m on m.id = e.member_id
        where e.tournament_id = new.id and e.status = 'playing'),
      new.table_id, 'tournament_started', 'הטורניר מתחיל! 🏆', new.name || ' · כנסו לראות באיזה שולחן וכיסא אתם',
      '/tr/' || new.id, 'tournament_started:' || new.id);
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform notify_users(tournament_user_ids(new.id), new.table_id, 'tournament_cancelled',
      'הטורניר בוטל', new.name || ' · ' || notif_when(new.starts_at), '/tr/' || new.id, 'tournament_cancelled:' || new.id);
  end if;
  return null;
end $$;

drop trigger if exists tournaments_notify on public.tournaments;
create trigger tournaments_notify after insert or update on public.tournaments
  for each row execute function public.tournaments_notify();

create or replace function public.tournament_entries_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_uid uuid;
begin
  if not (old.status = 'waiting' and new.status in ('registered', 'playing')) then return null; end if;
  select * into v_t from tournaments where id = new.tournament_id;
  select user_id into v_uid from table_members where id = new.member_id;
  perform notify_users(array[v_uid], v_t.table_id, 'tournament_seat',
    'עלית מרשימת ההמתנה! 🎉',
    v_t.name || case when new.status = 'playing' then ' · שולחן ' || new.table_no || ' כיסא ' || new.seat_no
                     else ' · ' || notif_when(v_t.starts_at) end,
    '/tr/' || v_t.id);
  return null;
end $$;

drop trigger if exists tournament_entries_notify on public.tournament_entries;
create trigger tournament_entries_notify after update of status on public.tournament_entries
  for each row execute function public.tournament_entries_notify();

revoke execute on function public.signups_notify(), public.signup_seats_notify(), public.game_nights_notify(),
  public.chip_requests_notify(), public.tournaments_notify(), public.tournament_entries_notify(),
  public.notifications_dispatch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Joining a table: the admins see the request, the player sees the approval
-- ---------------------------------------------------------------------------
create or replace function public.table_members_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_t poker_tables;
begin
  if new.user_id is null then return null; end if;
  select * into v_t from poker_tables where id = new.table_id;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
    perform notify_users(
      (select coalesce(array_agg(user_id), '{}') from table_members
        where table_id = new.table_id and role = 'admin' and status = 'active' and user_id is not null),
      new.table_id, 'join_request', 'בקשת הצטרפות לשולחן', new.display_name || ' רוצה להצטרף ל' || v_t.name,
      '/t/' || v_t.code || '?tab=players');
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status = 'pending' then
    perform notify_users(array[new.user_id], new.table_id, 'join_approved',
      'אושרת לשולחן ✅', 'ברוך הבא ל' || v_t.name, '/t/' || v_t.code);
  end if;
  return null;
end $$;

drop trigger if exists table_members_notify on public.table_members;
create trigger table_members_notify after insert or update of status on public.table_members
  for each row execute function public.table_members_notify();

revoke execute on function public.table_members_notify() from public, anon, authenticated;
