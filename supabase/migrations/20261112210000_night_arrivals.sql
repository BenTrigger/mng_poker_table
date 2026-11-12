-- Arrival check at the start of a night: the players chosen when the night is
-- opened are expected, not yet at the table. A player taps "I'm here" on their
-- phone, or the admin or the night's cashier marks them as arrived (guests
-- without an account too). The screens open chip requests to a player once
-- they arrived; a chip request itself also counts as being there.

alter table public.night_players add column if not exists arrived_at timestamptz;

-- Nights that already ran: whoever got chips, left, or played a closed night was there.
update public.night_players p
   set arrived_at = coalesce(p.left_at, g.started_at, now())
  from public.game_nights g
 where g.id = p.night_id
   and p.arrived_at is null
   and (g.status = 'closed' or p.status = 'out'
        or exists (select 1 from public.chip_requests r where r.night_id = p.night_id and r.member_id = p.member_id));

grant select (arrived_at) on public.night_players to authenticated;

create or replace view public.night_players_view as
select p.id, p.night_id, p.member_id, p.seat, p.status, p.left_at, p.bought_money,
       case when x.sees then p.final_chips end as final_chips,
       case when x.sees then p.final_photo_path end as final_photo_path,
       case when x.sees then p.net end as net,
       p.arrived_at
  from night_players p
  join game_nights g on g.id = p.night_id
  cross join lateral (
    select public.sees_all_results(g.table_id) or public.is_cashier(g.id) or public.is_my_member(p.member_id) as sees
  ) x
 where public.is_member(g.table_id);

revoke all on public.night_players_view from public, anon;
grant select on public.night_players_view to authenticated;

-- Mark (or, for the admin and the cashier, unmark) a player as arrived.
create or replace function public.set_arrived(p_player uuid, p_arrived boolean default true)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_p night_players;
  v_table uuid;
  v_open boolean;
  v_manager boolean;
  v_at timestamptz;
begin
  select * into v_p from night_players where id = p_player;
  if not found then raise exception 'player not found'; end if;
  select table_id, status = 'open' into v_table, v_open from game_nights where id = v_p.night_id;
  if not public.is_member(v_table) then raise exception 'not a member'; end if;
  if not v_open then raise exception 'night is closed'; end if;
  v_manager := public.is_admin(v_table) or public.is_cashier(v_p.night_id);
  if not v_manager and not (p_arrived and public.is_my_member(v_p.member_id)) then
    raise exception 'only the admin or the cashier can do this';
  end if;
  if not p_arrived and exists (
    select 1 from chip_requests where night_id = v_p.night_id and member_id = v_p.member_id and status <> 'rejected'
  ) then
    raise exception 'player already has chips';
  end if;
  if p_arrived and v_p.arrived_at is not null then return v_p.arrived_at; end if;

  v_at := case when p_arrived then now() end;
  update night_players set arrived_at = v_at where id = p_player;
  insert into night_events (night_id, actor_id, kind, payload)
  values (v_p.night_id, auth.uid(), case when p_arrived then 'arrived' else 'arrival_undone' end,
          jsonb_build_object('member_id', v_p.member_id));
  return v_at;
end $$;
revoke execute on function public.set_arrived(uuid, boolean) from public, anon;
grant execute on function public.set_arrived(uuid, boolean) to authenticated;

-- Asking for chips means being at the table.
create or replace function public.chip_request_marks_arrived()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update night_players set arrived_at = now()
   where night_id = new.night_id and member_id = new.member_id and arrived_at is null;
  return new;
end $$;
revoke execute on function public.chip_request_marks_arrived() from public, anon, authenticated;

drop trigger if exists chip_request_marks_arrived on public.chip_requests;
create trigger chip_request_marks_arrived after insert on public.chip_requests
  for each row execute function public.chip_request_marks_arrived();
