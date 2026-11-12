-- Tournaments (alongside regular cash nights).
-- An admin of a table opens a tournament: date, number of tables, seats per
-- table, buy-in, starting stack, blind speed, rebuys and add-on. Players sign
-- up through a link (WhatsApp) until it is full, then go to a waiting list that
-- moves up automatically. At the start the app draws seats at random across the
-- tables. During play the admin runs the clock, busts players, sells rebuys and
-- add-ons and balances the tables. At the end prizes are paid by place.
--
-- Regular cash nights stay one table of at most 10 players (enforced below).

create table public.tournaments (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  name text not null,
  starts_at timestamptz not null,
  location text,
  note text,
  table_count int not null default 1 check (table_count between 1 and 10),
  seats_per_table int not null default 9 check (seats_per_table between 2 and 10),
  buy_in numeric not null check (buy_in >= 0),
  starting_stack int not null check (starting_stack > 0),
  rebuy_until_level int not null default 0 check (rebuy_until_level >= 0), -- 0 = no rebuys
  rebuy_price numeric,          -- null = same as buy-in
  rebuy_chips int,              -- null = starting stack
  addon_price numeric,          -- null = no add-on
  addon_chips int,
  late_reg_until_level int not null default 0 check (late_reg_until_level >= 0),
  -- [{ "sb": 25, "bb": 50, "ante": 0, "minutes": 20 } | { "break": true, "minutes": 10 }]
  levels jsonb not null,
  registration_open boolean not null default true,
  status text not null default 'registration'
    check (status in ('registration', 'running', 'finished', 'cancelled')),
  -- clock: the moment level 1 would have started if the clock had never been
  -- paused; paused_at is set while the clock is paused
  clock_anchor timestamptz,
  paused_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  member_id uuid not null references public.table_members(id) on delete cascade,
  status text not null default 'registered'
    check (status in ('registered', 'waiting', 'playing', 'busted')),
  table_no int,
  seat_no int,
  rebuys int not null default 0,
  addon boolean not null default false,
  busted_at timestamptz,
  busted_by uuid references public.table_members(id) on delete set null,
  place int,
  prize numeric,
  created_at timestamptz not null default now(),
  unique (tournament_id, member_id),
  unique (tournament_id, table_no, seat_no)
);

create index on public.tournaments (table_id, starts_at desc);
create index on public.tournament_entries (tournament_id, created_at);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;

create policy "tournaments: members read" on public.tournaments for select using (public.is_member(table_id));
create policy "tournaments: admin insert" on public.tournaments for insert with check (public.is_admin(table_id));
create policy "tournaments: admin update" on public.tournaments for update using (public.is_admin(table_id));
create policy "tournaments: admin delete" on public.tournaments for delete using (public.is_admin(table_id));

create or replace function public.tournament_table(p uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select table_id from tournaments where id = p;
$$;

create policy "entries: members read" on public.tournament_entries for select
  using (public.is_member(public.tournament_table(tournament_id)));
-- the admin moves players between tables and records add-ons directly;
-- sign-up, the seat draw, bust-outs and rebuys go through the functions below
create policy "entries: admin update" on public.tournament_entries for update
  using (public.is_admin(public.tournament_table(tournament_id)));

alter publication supabase_realtime add table public.tournaments, public.tournament_entries;

-- ---------------------------------------------------------------------------
-- Helpers (not callable by clients)
-- ---------------------------------------------------------------------------

-- Number of entries that hold a place (everyone except the waiting list)
create or replace function public.tournament_taken(p uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from tournament_entries where tournament_id = p and status <> 'waiting';
$$;

-- A free seat at the table with the fewest players (late registration, rebuys)
create or replace function public.tournament_free_seat(p uuid, out o_table int, out o_seat int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  select * into v_t from tournaments where id = p;
  select t.n, s.n into o_table, o_seat
    from generate_series(1, v_t.table_count) t(n)
    cross join generate_series(1, v_t.seats_per_table) s(n)
   where not exists (select 1 from tournament_entries e
                      where e.tournament_id = p and e.status = 'playing' and e.table_no = t.n and e.seat_no = s.n)
   order by (select count(*) from tournament_entries e where e.tournament_id = p and e.status = 'playing' and e.table_no = t.n),
            -- prefer tables that already have players over empty (broken) ones
            (select count(*) from tournament_entries e where e.tournament_id = p and e.status = 'playing' and e.table_no = t.n) = 0,
            t.n, s.n
   limit 1;
end $$;

-- Move the waiting list up into free places (oldest first)
create or replace function public.tournament_fill(p uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_w tournament_entries;
  v_table int;
  v_seat int;
begin
  select * into v_t from tournaments where id = p;
  if v_t.status not in ('registration', 'running') then return; end if;
  if v_t.status = 'running' and not v_t.registration_open then return; end if;
  loop
    -- before the start every entry holds a place; once running, a free seat is enough
    exit when v_t.status = 'registration' and tournament_taken(p) >= v_t.table_count * v_t.seats_per_table;
    select * into v_w from tournament_entries where tournament_id = p and status = 'waiting' order by created_at limit 1;
    exit when v_w.id is null;
    if v_t.status = 'running' then
      select o_table, o_seat into v_table, v_seat from tournament_free_seat(p);
      exit when v_seat is null;
      update tournament_entries set status = 'playing', table_no = v_table, seat_no = v_seat where id = v_w.id;
    else
      update tournament_entries set status = 'registered' where id = v_w.id;
    end if;
    v_w := null;
  end loop;
end $$;

revoke execute on function public.tournament_taken(uuid), public.tournament_free_seat(uuid), public.tournament_fill(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read a tournament through its link (the caller does not need to be a member yet)
-- ---------------------------------------------------------------------------
create or replace function public.get_tournament(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_t tournaments;
  v_pt poker_tables;
  v_me table_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from tournaments where id = p_id;
  if v_t.id is null then return null; end if;
  select * into v_pt from poker_tables where id = v_t.table_id;
  select * into v_me from table_members where table_id = v_t.table_id and user_id = auth.uid();
  return jsonb_build_object(
    'tournament', to_jsonb(v_t),
    'table', jsonb_build_object('id', v_pt.id, 'name', v_pt.name, 'code', v_pt.code,
               'stats_visibility', coalesce(v_pt.last_settings->>'stats_visibility', 'all'),
               'settle_mode', coalesce(v_pt.last_settings->>'settle_mode', 'players')),
    'me', case when v_me.id is null then null
               else jsonb_build_object('id', v_me.id, 'status', v_me.status, 'role', v_me.role) end,
    -- the organizer collects and pays out when the table settles "through the cashier"
    'organizer_member_id', (select id from table_members where table_id = v_t.table_id and user_id = v_t.created_by),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(e) || jsonb_build_object(
               'display_name', m.display_name, 'avatar_url', m.avatar_url, 'user_id', m.user_id
             ) order by e.created_at)
        from tournament_entries e join table_members m on m.id = e.member_id
       where e.tournament_id = p_id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Sign up (players). The link is an invite from the admin, so a signed-in user
-- who is not a member yet joins the table. While the tournament is running this
-- is late registration: the player gets a seat at the shortest table.
-- Returns the entry status ('registered', 'playing' or 'waiting').
-- ---------------------------------------------------------------------------
create or replace function public.register_tournament(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_me table_members;
  v_profile profiles;
  v_e tournament_entries;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if v_t.status not in ('registration', 'running') or not v_t.registration_open then
    raise exception 'registration is closed';
  end if;

  select * into v_me from table_members where table_id = v_t.table_id and user_id = auth.uid();
  if v_me.status = 'removed' then raise exception 'removed from table'; end if;
  if v_me.id is null then
    select * into v_profile from profiles where id = auth.uid();
    insert into table_members (table_id, user_id, display_name, avatar_url, status)
    values (v_t.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'active')
    returning * into v_me;
  elsif v_me.status = 'pending' then
    update table_members set status = 'active' where id = v_me.id returning * into v_me;
  end if;

  select * into v_e from tournament_entries where tournament_id = p_id and member_id = v_me.id;
  if v_e.id is not null then return v_e.status; end if;

  insert into tournament_entries (tournament_id, member_id, status) values (p_id, v_me.id, 'waiting');
  perform tournament_fill(p_id);
  select status into v_e.status from tournament_entries where tournament_id = p_id and member_id = v_me.id;
  return v_e.status;
end $$;

-- Drop out before the start; the first player on the waiting list moves up.
create or replace function public.leave_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_t from tournaments where id = p_id for update;
  if v_t.status = 'running' and exists (
    select 1 from tournament_entries e join table_members m on m.id = e.member_id
     where e.tournament_id = p_id and m.user_id = auth.uid() and e.status <> 'waiting'
  ) then
    raise exception 'tournament already started';
  end if;
  delete from tournament_entries e using table_members m
   where e.tournament_id = p_id and m.id = e.member_id and m.user_id = auth.uid();
  perform tournament_fill(p_id);
end $$;

-- Admin: add a member (also guests without an account) or remove one.
-- p_add false removes the entry (before the start, or a waiting-list entry).
create or replace function public.admin_tournament_entry(p_id uuid, p_member uuid, p_add boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_status text;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status not in ('registration', 'running') then raise exception 'tournament is over'; end if;
  if not exists (select 1 from table_members where id = p_member and table_id = v_t.table_id and status = 'active') then
    raise exception 'not an active table member';
  end if;

  if not p_add then
    if v_t.status = 'running' and exists (
      select 1 from tournament_entries where tournament_id = p_id and member_id = p_member and status <> 'waiting'
    ) then raise exception 'tournament already started'; end if;
    delete from tournament_entries where tournament_id = p_id and member_id = p_member;
    perform tournament_fill(p_id);
    return null;
  end if;

  insert into tournament_entries (tournament_id, member_id, status) values (p_id, p_member, 'waiting')
  on conflict (tournament_id, member_id) do nothing;
  -- the admin can add late even after closing late registration
  if v_t.status = 'running' and not v_t.registration_open then
    update tournaments set registration_open = true where id = p_id;
    perform tournament_fill(p_id);
    update tournaments set registration_open = false where id = p_id;
  else
    perform tournament_fill(p_id);
  end if;
  select status into v_status from tournament_entries where tournament_id = p_id and member_id = p_member;
  return v_status;
end $$;

-- Admin: change the number of tables / seats. Places that no longer exist go
-- back to the waiting list (latest sign-ups first), ahead of newer sign-ups.
create or replace function public.resize_tournament(p_id uuid, p_tables int, p_seats int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_over int;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'registration' then raise exception 'tournament already started'; end if;
  if p_tables < 1 or p_tables > 10 or p_seats < 2 or p_seats > 10 then raise exception 'bad size'; end if;
  update tournaments set table_count = p_tables, seats_per_table = p_seats where id = p_id;
  v_over := tournament_taken(p_id) - p_tables * p_seats;
  if v_over > 0 then
    update tournament_entries set status = 'waiting'
     where id in (select id from tournament_entries where tournament_id = p_id and status = 'registered'
                   order by created_at desc limit v_over);
  end if;
  perform tournament_fill(p_id);
end $$;

-- ---------------------------------------------------------------------------
-- Start: random seat draw, spread evenly over as few tables as needed
-- ---------------------------------------------------------------------------
create or replace function public.start_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_n int;
  v_tables int;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'registration' then raise exception 'tournament already started'; end if;
  select count(*) into v_n from tournament_entries where tournament_id = p_id and status = 'registered';
  if v_n < 2 then raise exception 'need at least 2 players'; end if;
  v_tables := least(v_t.table_count, ceil(v_n::numeric / v_t.seats_per_table)::int);

  with drawn as (
    select id, row_number() over (order by random()) - 1 as rn
      from tournament_entries where tournament_id = p_id and status = 'registered'
  ), seated as (
    -- deal players round the tables, then shuffle the seat numbers at each table
    select id, (rn % v_tables) + 1 as table_no,
           row_number() over (partition by rn % v_tables order by random()) as seat_no
      from drawn
  )
  update tournament_entries e set status = 'playing', table_no = s.table_no, seat_no = s.seat_no
    from seated s where e.id = s.id;

  update tournaments
     set status = 'running', started_at = now(), clock_anchor = now(), paused_at = null,
         registration_open = late_reg_until_level > 0
   where id = p_id;
  if v_t.late_reg_until_level > 0 then perform tournament_fill(p_id); end if;
end $$;

-- Admin: a player is out. p_by = who knocked them out (optional).
create or replace function public.bust_player(p_entry uuid, p_by uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e tournament_entries;
  v_t tournaments;
begin
  select * into v_e from tournament_entries where id = p_entry;
  if v_e.id is null then raise exception 'entry not found'; end if;
  select * into v_t from tournaments where id = v_e.tournament_id for update;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'running' or v_e.status <> 'playing' then raise exception 'player is not playing'; end if;
  if (select count(*) from tournament_entries where tournament_id = v_t.id and status = 'playing') <= 1 then
    raise exception 'last player';
  end if;
  update tournament_entries
     set status = 'busted', busted_at = now(), busted_by = p_by, table_no = null, seat_no = null
   where id = p_entry;
end $$;

-- Admin: bring a busted player back, as a rebuy (p_rebuy) or to undo a mistake.
create or replace function public.reenter_player(p_entry uuid, p_rebuy boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e tournament_entries;
  v_t tournaments;
  v_table int;
  v_seat int;
begin
  select * into v_e from tournament_entries where id = p_entry;
  if v_e.id is null then raise exception 'entry not found'; end if;
  select * into v_t from tournaments where id = v_e.tournament_id for update;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'running' or v_e.status <> 'busted' then raise exception 'player is not out'; end if;
  select o_table, o_seat into v_table, v_seat from tournament_free_seat(v_t.id);
  if v_seat is null then raise exception 'no free seat'; end if;
  update tournament_entries
     set status = 'playing', busted_at = null, busted_by = null, table_no = v_table, seat_no = v_seat,
         rebuys = rebuys + case when p_rebuy then 1 else 0 end
   where id = p_entry;
end $$;

-- Admin: end the tournament. p_prizes = [{ "entry_id": ..., "place": 1, "prize": 600 }, ...]
-- for every entry that played (places and prizes are worked out in the app,
-- including a deal/chop the admin typed in).
create or replace function public.finish_tournament(p_id uuid, p_prizes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'running' then raise exception 'tournament is not running'; end if;
  update tournament_entries e
     set place = (x->>'place')::int, prize = coalesce((x->>'prize')::numeric, 0),
         status = case when e.status = 'playing' then 'busted' else e.status end,
         busted_at = coalesce(e.busted_at, now()), table_no = null, seat_no = null
    from jsonb_array_elements(p_prizes) x
   where e.tournament_id = p_id and e.id = (x->>'entry_id')::uuid;
  delete from tournament_entries where tournament_id = p_id and status = 'waiting';
  update tournaments set status = 'finished', finished_at = now(), registration_open = false, paused_at = null
   where id = p_id;
end $$;

-- Admin: undo the end of a tournament (wrong prizes, etc.)
create or replace function public.reopen_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  select * into v_t from tournaments where id = p_id for update;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'finished' then raise exception 'tournament is not finished'; end if;
  update tournament_entries set place = null, prize = null where tournament_id = p_id;
  -- the winner (place 1 was the last busted_at) goes back to playing at table 1
  update tournament_entries set status = 'playing', busted_at = null, table_no = 1, seat_no = 1
   where id = (select id from tournament_entries where tournament_id = p_id order by busted_at desc nulls first limit 1);
  update tournaments set status = 'running', finished_at = null, paused_at = now() where id = p_id;
end $$;

revoke execute on function
  public.tournament_table(uuid),
  public.get_tournament(uuid), public.register_tournament(uuid), public.leave_tournament(uuid),
  public.admin_tournament_entry(uuid, uuid, boolean), public.resize_tournament(uuid, int, int),
  public.start_tournament(uuid), public.bust_player(uuid, uuid), public.reenter_player(uuid, boolean),
  public.finish_tournament(uuid, jsonb), public.reopen_tournament(uuid)
  from public, anon;
grant execute on function
  public.tournament_table(uuid),
  public.get_tournament(uuid), public.register_tournament(uuid), public.leave_tournament(uuid),
  public.admin_tournament_entry(uuid, uuid, boolean), public.resize_tournament(uuid, int, int),
  public.start_tournament(uuid), public.bust_player(uuid, uuid), public.reenter_player(uuid, boolean),
  public.finish_tournament(uuid, jsonb), public.reopen_tournament(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- A regular poker night is one table: at most 10 players at a time
-- ---------------------------------------------------------------------------
create or replace function public.night_players_cap()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'playing' and (
    select count(*) from night_players
     where night_id = new.night_id and status = 'playing' and id <> new.id
  ) >= 10 then
    raise exception 'table is full (10 players)';
  end if;
  return new;
end $$;
revoke execute on function public.night_players_cap() from public, anon, authenticated;

create trigger night_players_cap
  before insert or update of status on public.night_players
  for each row execute function public.night_players_cap();
