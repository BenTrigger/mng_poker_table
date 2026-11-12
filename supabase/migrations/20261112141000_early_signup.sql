-- Early sign-up for an upcoming game night.
-- The admin opens a sign-up (date, place, number of seats) and shares a link on
-- WhatsApp. Whoever opens the link signs in with Google and picks a free seat
-- at the table. When the seats are taken, new sign-ups go to a waiting list and
-- move up automatically when someone drops out. When the night starts, the
-- seated players are loaded into the new night in their seat order.

create table public.signups (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  starts_at timestamptz not null,
  location text,
  note text,
  seats int not null default 9 check (seats between 2 and 10),
  status text not null default 'open' check (status in ('open', 'closed', 'started', 'cancelled')),
  night_id uuid references public.game_nights(id) on delete set null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.signup_seats (
  id uuid primary key default gen_random_uuid(),
  signup_id uuid not null references public.signups(id) on delete cascade,
  member_id uuid not null references public.table_members(id) on delete cascade,
  seat int, -- 1..seats; null = waiting list
  created_at timestamptz not null default now(),
  unique (signup_id, member_id),
  unique (signup_id, seat)
);

create index on public.signups (table_id, starts_at desc);
create index on public.signup_seats (signup_id, created_at);

alter table public.signups enable row level security;
alter table public.signup_seats enable row level security;

create policy "signups: members read" on public.signups for select using (public.is_member(table_id));
create policy "signups: admin insert" on public.signups for insert with check (public.is_admin(table_id));
create policy "signups: admin update" on public.signups for update using (public.is_admin(table_id));
create policy "signups: admin delete" on public.signups for delete using (public.is_admin(table_id));

create policy "signup seats: members read" on public.signup_seats for select using (
  public.is_member((select s.table_id from public.signups s where s.id = signup_id))
);
-- seat writes only go through the functions below

alter publication supabase_realtime add table public.signups, public.signup_seats;

-- ---------------------------------------------------------------------------
-- Move waiting-list players into free seats (oldest first)
-- ---------------------------------------------------------------------------
create or replace function public.signup_fill_seats(p_signup uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
  v_free int;
  v_wait signup_seats;
begin
  select * into v_s from signups where id = p_signup;
  if v_s.status <> 'open' then return; end if;
  loop
    select g into v_free from generate_series(1, v_s.seats) g
     where not exists (select 1 from signup_seats where signup_id = p_signup and seat = g)
     order by g limit 1;
    exit when v_free is null;
    select * into v_wait from signup_seats where signup_id = p_signup and seat is null order by created_at limit 1;
    exit when v_wait.id is null;
    update signup_seats set seat = v_free where id = v_wait.id;
    v_free := null;
    v_wait := null;
  end loop;
end $$;
revoke execute on function public.signup_fill_seats(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read a sign-up through its link (the caller does not need to be a member yet)
-- ---------------------------------------------------------------------------
create or replace function public.get_signup(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_s signups;
  v_t poker_tables;
  v_me table_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from signups where id = p_id;
  if v_s.id is null then return null; end if;
  select * into v_t from poker_tables where id = v_s.table_id;
  select * into v_me from table_members where table_id = v_s.table_id and user_id = auth.uid();
  return jsonb_build_object(
    'signup', to_jsonb(v_s),
    'table', jsonb_build_object('id', v_t.id, 'name', v_t.name, 'code', v_t.code),
    'me', case when v_me.id is null then null
               else jsonb_build_object('id', v_me.id, 'status', v_me.status, 'role', v_me.role) end,
    'seats', coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', ss.member_id, 'seat', ss.seat, 'created_at', ss.created_at,
               'display_name', m.display_name, 'avatar_url', m.avatar_url, 'user_id', m.user_id
             ) order by ss.seat nulls last, ss.created_at)
        from signup_seats ss join table_members m on m.id = ss.member_id
       where ss.signup_id = p_id
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Take a seat (or move to another free seat). p_seat null = first free seat,
-- or the waiting list when the table is full. The sign-up link is an invite
-- from the admin, so a signed-in user who is not a member yet joins the table.
-- Returns the seat taken (null = waiting list).
-- ---------------------------------------------------------------------------
create or replace function public.claim_seat(p_signup uuid, p_seat int default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
  v_me table_members;
  v_profile profiles;
  v_seat int := p_seat;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from signups where id = p_signup for update;
  if v_s.id is null then raise exception 'signup not found'; end if;
  if v_s.status <> 'open' then raise exception 'signup is closed'; end if;
  if v_seat is not null and (v_seat < 1 or v_seat > v_s.seats) then raise exception 'no such seat'; end if;

  select * into v_me from table_members where table_id = v_s.table_id and user_id = auth.uid();
  if v_me.status = 'removed' then raise exception 'removed from table'; end if;
  if v_me.id is null then
    select * into v_profile from profiles where id = auth.uid();
    insert into table_members (table_id, user_id, display_name, avatar_url, status)
    values (v_s.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'active')
    returning * into v_me;
  elsif v_me.status = 'pending' then
    update table_members set status = 'active' where id = v_me.id returning * into v_me;
  end if;

  if v_seat is null then
    -- keep the seat I already have
    select seat into v_seat from signup_seats where signup_id = p_signup and member_id = v_me.id;
    if v_seat is null then
      select g into v_seat from generate_series(1, v_s.seats) g
       where not exists (select 1 from signup_seats where signup_id = p_signup and seat = g)
       order by g limit 1;
    end if;
  elsif exists (select 1 from signup_seats where signup_id = p_signup and seat = v_seat and member_id <> v_me.id) then
    raise exception 'seat taken';
  end if;

  insert into signup_seats (signup_id, member_id, seat) values (p_signup, v_me.id, v_seat)
  on conflict (signup_id, member_id) do update set seat = excluded.seat;

  perform signup_fill_seats(p_signup);
  return v_seat;
end $$;

-- Drop out of a sign-up; the first player on the waiting list takes the seat.
create or replace function public.leave_signup(p_signup uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  perform 1 from signups where id = p_signup for update;
  delete from signup_seats ss using table_members m
   where ss.signup_id = p_signup and m.id = ss.member_id and m.user_id = auth.uid();
  perform signup_fill_seats(p_signup);
end $$;

-- Admin: put any member (including guests without an account) in a seat,
-- move them, send them to the waiting list (p_seat 0) or remove them (p_seat null).
create or replace function public.admin_seat(p_signup uuid, p_member uuid, p_seat int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
begin
  select * into v_s from signups where id = p_signup for update;
  if v_s.id is null then raise exception 'signup not found'; end if;
  if not public.is_admin(v_s.table_id) then raise exception 'admin only'; end if;
  if not exists (select 1 from table_members where id = p_member and table_id = v_s.table_id and status = 'active') then
    raise exception 'not an active table member';
  end if;

  if p_seat is null then
    delete from signup_seats where signup_id = p_signup and member_id = p_member;
  else
    if p_seat > v_s.seats or p_seat < 0 then raise exception 'no such seat'; end if;
    if p_seat > 0 and exists (select 1 from signup_seats where signup_id = p_signup and seat = p_seat and member_id <> p_member) then
      raise exception 'seat taken';
    end if;
    insert into signup_seats (signup_id, member_id, seat) values (p_signup, p_member, nullif(p_seat, 0))
    on conflict (signup_id, member_id) do update set seat = excluded.seat;
  end if;
  if p_seat is null or p_seat > 0 then perform signup_fill_seats(p_signup); end if;
end $$;

-- Admin: change the number of seats. Players in seats that no longer exist
-- move to the front of the waiting list.
create or replace function public.resize_signup(p_signup uuid, p_seats int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
begin
  select * into v_s from signups where id = p_signup for update;
  if v_s.id is null then raise exception 'signup not found'; end if;
  if not public.is_admin(v_s.table_id) then raise exception 'admin only'; end if;
  if p_seats < 2 or p_seats > 10 then raise exception 'seats must be 2-10'; end if;
  update signup_seats set seat = null, created_at = v_s.created_at
   where signup_id = p_signup and seat > p_seats;
  update signups set seats = p_seats where id = p_signup;
  perform signup_fill_seats(p_signup);
end $$;

-- Only signed-in users may call these (same rule as the other app functions)
revoke execute on function public.get_signup(uuid), public.claim_seat(uuid, int), public.leave_signup(uuid),
  public.admin_seat(uuid, uuid, int), public.resize_signup(uuid, int)
  from public, anon;
grant execute on function public.get_signup(uuid), public.claim_seat(uuid, int), public.leave_signup(uuid),
  public.admin_seat(uuid, uuid, int), public.resize_signup(uuid, int)
  to authenticated;
