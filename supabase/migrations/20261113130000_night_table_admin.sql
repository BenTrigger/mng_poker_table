-- Ben (2026-11-13): admin control over nights and tables.
--  * delete a night, also one that is running or already closed
--  * take a running night back to the sign-up stage
--  * the night's settings (cashier, buy-in, chip set, food) can be set already
--    on the early sign-up
--  * the table's creator can delete the whole table
--  * a night has its own name, set on the sign-up or when opening it

-- ---------------------------------------------------------------------------
-- Night settings chosen on the sign-up. Same keys as poker_tables.last_settings:
-- chip_set_id, chips_per_buyin, money_per_buyin, cashier_member_id, food_fee,
-- host_member_id. The new-night screen starts from them.
-- ---------------------------------------------------------------------------
alter table public.signups add column if not exists settings jsonb;

-- Each night has its own name ("השישי ה-13"), apart from the table's name.
alter table public.signups add column if not exists name text check (name is null or length(name) <= 60);
alter table public.game_nights add column if not exists name text check (name is null or length(name) <= 60);

-- ---------------------------------------------------------------------------
-- Delete a night (open or closed). Everything of the night goes with it:
-- players, chip requests, events, hand-overs and its settlements (open debts
-- of that night disappear), so it no longer counts in statistics. A sign-up
-- the night was opened from is marked cancelled.
-- Stack photos are removed by the app before the call (storage policies look
-- the night up).
-- ---------------------------------------------------------------------------
create or replace function public.delete_night(p_night uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_n game_nights;
begin
  select * into v_n from game_nights where id = p_night for update;
  if v_n.id is null then raise exception 'night not found'; end if;
  if not public.is_admin(v_n.table_id) then raise exception 'admin only'; end if;
  update signups set status = 'cancelled', night_id = null where night_id = p_night;
  delete from game_nights where id = p_night;
  return v_n.table_id;
end $$;

-- ---------------------------------------------------------------------------
-- Back to sign-up: the running night is undone and its players go back to a
-- sign-up (the one it was opened from, or a new one), with the night's
-- settings kept on the sign-up. Only before any chips were handed out;
-- after that the night's money is real and the admin deletes or closes it.
-- ---------------------------------------------------------------------------
create or replace function public.night_back_to_signup(p_night uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_n game_nights;
  v_s signups;
  v_settings jsonb;
  v_players int;
  p record;
  v_seat int;
begin
  select * into v_n from game_nights where id = p_night for update;
  if v_n.id is null then raise exception 'night not found'; end if;
  if not public.is_admin(v_n.table_id) then raise exception 'admin only'; end if;
  if v_n.status <> 'open' then raise exception 'night is closed'; end if;
  if exists (select 1 from chip_requests where night_id = p_night and status in ('approved', 'flagged')) then
    raise exception 'chips already handed out';
  end if;

  v_settings := jsonb_strip_nulls(jsonb_build_object(
    'chip_set_id', v_n.chip_set_id,
    'chips_per_buyin', v_n.chips_per_buyin,
    'money_per_buyin', v_n.money_per_buyin,
    'cashier_member_id', v_n.cashier_member_id,
    'food_fee', v_n.food_fee,
    'host_member_id', v_n.host_member_id
  ));
  select count(*) into v_players from night_players where night_id = p_night;

  select * into v_s from signups where night_id = p_night for update;
  if v_s.id is null then
    insert into signups (table_id, name, starts_at, seats, status, created_by, settings, location)
    values (v_n.table_id, v_n.name, v_n.started_at, least(10, greatest(9, v_players)), 'open', auth.uid(), v_settings,
            (select display_name from table_members where id = v_n.host_member_id))
    returning * into v_s;
  else
    update signups set status = 'open', night_id = null, name = coalesce(v_n.name, name),
           seats = greatest(seats, least(10, v_players)),
           settings = coalesce(settings, '{}'::jsonb) || v_settings
     where id = v_s.id
    returning * into v_s;
  end if;

  -- everyone at the night keeps (or gets) a place, in their seat order
  for p in select member_id from night_players where night_id = p_night order by seat loop
    if exists (select 1 from signup_seats where signup_id = v_s.id and member_id = p.member_id and seat is not null) then
      continue;
    end if;
    select min(g) into v_seat from generate_series(1, v_s.seats) g
     where not exists (select 1 from signup_seats where signup_id = v_s.id and seat = g);
    insert into signup_seats (signup_id, member_id, seat) values (v_s.id, p.member_id, v_seat)
    on conflict (signup_id, member_id) do update set seat = coalesce(excluded.seat, signup_seats.seat);
  end loop;

  delete from game_nights where id = p_night;
  return v_s.id;
end $$;

-- ---------------------------------------------------------------------------
-- Delete a whole table: only the person who created it. Members, nights,
-- sign-ups, tournaments, chip sets and statistics of the table all go.
-- Stored photos are removed by the app before the call.
-- ---------------------------------------------------------------------------
create or replace function public.delete_table(p_table uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t poker_tables;
begin
  select * into v_t from poker_tables where id = p_table for update;
  if v_t.id is null then raise exception 'table not found'; end if;
  if v_t.owner_id is distinct from auth.uid() then raise exception 'owner only'; end if;
  delete from poker_tables where id = p_table;
end $$;

revoke execute on function public.delete_night(uuid), public.night_back_to_signup(uuid), public.delete_table(uuid) from public, anon;
grant execute on function public.delete_night(uuid), public.night_back_to_signup(uuid), public.delete_table(uuid) to authenticated;
