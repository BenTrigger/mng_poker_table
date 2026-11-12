-- Ben (2026-11-12): whoever has a link to the table (the table link, a
-- sign-up or a tournament link) joins straight away, no code and no approval.
-- Only someone the admin removed (or rejected) and who comes back waits for
-- the admin's approval; their place in a sign-up or tournament is held
-- meanwhile.
--
-- A permanent delete of a member who had an account leaves a note, so that
-- person also comes back as a request rather than as a fresh member.

-- Until now joining with the code or the table link was a request. Those
-- requests are let in now, as if they had joined today.
update public.table_members set status = 'active' where status = 'pending' and user_id is not null;

create table public.table_removed_users (
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  user_id uuid not null,
  removed_at timestamptz not null default now(),
  primary key (table_id, user_id)
);
alter table public.table_removed_users enable row level security;
-- no policies: only the functions below read or write it

create or replace function public.member_removed_note()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.user_id is not null
       and exists (select 1 from poker_tables where id = old.table_id) then
      insert into table_removed_users (table_id, user_id) values (old.table_id, old.user_id) on conflict do nothing;
    end if;
    return old;
  end if;
  -- approved again: the note goes
  if new.status = 'active' and new.user_id is not null then
    delete from table_removed_users where table_id = new.table_id and user_id = new.user_id;
  end if;
  return new;
end $$;
revoke execute on function public.member_removed_note() from public, anon, authenticated;
create trigger member_removed_note_del after delete on public.table_members
  for each row execute function public.member_removed_note();
create trigger member_removed_note_upd after update of status on public.table_members
  for each row when (new.status = 'active' and old.status <> 'active') execute function public.member_removed_note();

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
  -- someone the admin removed comes back as a request: their place is held until the admin decides
  if v_me.status = 'removed' or (v_me.id is null and exists (
       select 1 from table_removed_users r where r.table_id = v_s.table_id and r.user_id = auth.uid())) then
    if v_me.id is null then
      select * into v_profile from profiles where id = auth.uid();
      insert into table_members (table_id, user_id, display_name, avatar_url, status)
      values (v_s.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'pending')
      returning * into v_me;
    else
      update table_members set status = 'pending', role = 'player' where id = v_me.id returning * into v_me;
    end if;
  end if;
  if v_me.id is null then
    select * into v_profile from profiles where id = auth.uid();
    insert into table_members (table_id, user_id, display_name, avatar_url, status)
    values (v_s.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'active')
    returning * into v_me;
  end if;
  -- a pending member is someone the admin removed who came back: they wait for the admin

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
  -- someone the admin removed comes back as a request: their place is held until the admin decides
  if v_me.status = 'removed' or (v_me.id is null and exists (
       select 1 from table_removed_users r where r.table_id = v_t.table_id and r.user_id = auth.uid())) then
    if v_me.id is null then
      select * into v_profile from profiles where id = auth.uid();
      insert into table_members (table_id, user_id, display_name, avatar_url, status)
      values (v_t.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'pending')
      returning * into v_me;
    else
      update table_members set status = 'pending', role = 'player' where id = v_me.id returning * into v_me;
    end if;
  end if;
  if v_me.id is null then
    select * into v_profile from profiles where id = auth.uid();
    insert into table_members (table_id, user_id, display_name, avatar_url, status)
    values (v_t.table_id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'active')
    returning * into v_me;
  end if;
  -- a pending member is someone the admin removed who came back: they wait for the admin

  select * into v_e from tournament_entries where tournament_id = p_id and member_id = v_me.id;
  if v_e.id is not null then return v_e.status; end if;

  insert into tournament_entries (tournament_id, member_id, status) values (p_id, v_me.id, 'waiting');
  perform tournament_fill(p_id);
  select status into v_e.status from tournament_entries where tournament_id = p_id and member_id = v_me.id;
  return v_e.status;
end $$;

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
    -- removed by the admin: coming back is a request the admin approves
    if v_existing.status = 'removed' then
      update table_members set status = 'pending', role = 'player' where id = v_existing.id;
      return 'pending';
    end if;
    if p_member is not null and exists (
      select 1 from table_members where id = p_member and table_id = v_table.id and user_id is null and status <> 'removed'
    ) then
      begin
        perform public.merge_member_into(p_member, v_existing.id);
        return 'active';
      exception when others then
        -- e.g. both played the same night: leave it to the admin
        return v_existing.status;
      end;
    end if;
    return v_existing.status;
  end if;

  if p_member is not null then
    update table_members
       set user_id = auth.uid(), avatar_url = coalesce(avatar_url, v_profile.avatar_url), status = 'active'
     where id = p_member and table_id = v_table.id and user_id is null and status <> 'removed';
    if found then return 'active'; end if;
  end if;

  -- the code or link is the invite: a newcomer joins at once, unless the admin
  -- removed them from this table before
  if exists (select 1 from table_removed_users where table_id = v_table.id and user_id = auth.uid()) then
    insert into table_members (table_id, user_id, display_name, avatar_url, status)
    values (v_table.id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'pending');
    return 'pending';
  end if;
  insert into table_members (table_id, user_id, display_name, avatar_url, status)
  values (v_table.id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'active');
  return 'active';
end $$;

-- Opening the night from the sign-up approves the players seated in it
create or replace function public.signup_started_approve()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update table_members m set status = 'active'
    from signup_seats ss
   where ss.signup_id = new.id and ss.seat is not null and m.id = ss.member_id and m.status = 'pending';
  return new;
end $$;
revoke execute on function public.signup_started_approve() from public, anon, authenticated;
create trigger signup_started_approve
  after update of status on public.signups
  for each row when (new.status = 'started' and old.status is distinct from 'started')
  execute function public.signup_started_approve();

-- Starting the tournament approves everyone who got a seat in the draw
create or replace function public.tournament_started_approve()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update table_members m set status = 'active'
    from tournament_entries e
   where e.tournament_id = new.id and e.status = 'playing' and m.id = e.member_id and m.status = 'pending';
  return new;
end $$;
revoke execute on function public.tournament_started_approve() from public, anon, authenticated;
create trigger tournament_started_approve
  after update of status on public.tournaments
  for each row when (new.status = 'running' and old.status = 'registration')
  execute function public.tournament_started_approve();

-- Rejecting a request (or removing a player) frees the places they held in
-- sign-ups and tournaments that have not started, and the waiting list moves up
create or replace function public.member_left_free_places()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_member uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  for v_id in delete from signup_seats ss using signups s
               where ss.member_id = v_member and s.id = ss.signup_id and s.status in ('open', 'closed')
               returning ss.signup_id loop
    perform signup_fill_seats(v_id);
  end loop;
  for v_id in delete from tournament_entries e using tournaments t
               where e.member_id = v_member and t.id = e.tournament_id and t.status = 'registration'
                 and e.status in ('registered', 'waiting')
               returning e.tournament_id loop
    perform tournament_fill(v_id);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke execute on function public.member_left_free_places() from public, anon, authenticated;
create trigger member_left_free_places_del before delete on public.table_members
  for each row when (old.status = 'pending') execute function public.member_left_free_places();
create trigger member_left_free_places_upd after update of status on public.table_members
  for each row when (new.status = 'removed' and old.status <> 'removed') execute function public.member_left_free_places();
