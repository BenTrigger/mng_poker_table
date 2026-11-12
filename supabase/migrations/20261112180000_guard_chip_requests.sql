-- Found by the game-night simulation: chips could be approved for a player
-- after they cashed out (their open request stayed in the cashier's queue),
-- which added debt behind their back and left the night unbalanced.
--
-- 1. A player who leaves (cash-out or outgoing cashier) has their open
--    requests cancelled. Leaving with a request still waiting for the admin's
--    decision (flagged) is refused: decide it first, so the cash-out is right.
-- 2. Chips are requested and approved only for a player who is still playing,
--    and only while the night is open.

create or replace function public.night_player_leave_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'out' and old.status is distinct from 'out' then
    if exists (
      select 1 from chip_requests
      where night_id = new.night_id and member_id = new.member_id and status = 'flagged'
    ) then
      raise exception 'player has a flagged chip request: resolve it before cashing out';
    end if;
    with cancelled as (
      update chip_requests
         set status = 'rejected', note = 'בוטל: השחקן קם מהשולחן'
       where night_id = new.night_id and member_id = new.member_id and status = 'pending'
      returning id
    )
    insert into night_events (night_id, actor_id, kind, payload)
    select new.night_id, auth.uid(), 'rejected', jsonb_build_object('request_id', id, 'member_id', new.member_id, 'reason', 'left')
      from cancelled;
  end if;
  return new;
end $$;
revoke execute on function public.night_player_leave_guard() from public, anon, authenticated;

drop trigger if exists night_player_leave_guard on public.night_players;
create trigger night_player_leave_guard before update of status on public.night_players
  for each row execute function public.night_player_leave_guard();

create or replace function public.chip_request_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_open boolean;
  v_playing boolean;
begin
  if tg_op = 'UPDATE' and not (new.status in ('approved', 'flagged') and new.status is distinct from old.status) then
    return new;
  end if;
  select status = 'open' into v_open from game_nights where id = new.night_id;
  if not coalesce(v_open, false) then
    raise exception 'night is closed';
  end if;
  select status = 'playing' into v_playing from night_players where night_id = new.night_id and member_id = new.member_id;
  if not coalesce(v_playing, false) then
    raise exception 'player is not playing';
  end if;
  return new;
end $$;
revoke execute on function public.chip_request_guard() from public, anon, authenticated;

drop trigger if exists chip_request_guard on public.chip_requests;
-- AFTER, so row level security answers first for callers who may not write at all
create trigger chip_request_guard after insert or update of status on public.chip_requests
  for each row execute function public.chip_request_guard();
