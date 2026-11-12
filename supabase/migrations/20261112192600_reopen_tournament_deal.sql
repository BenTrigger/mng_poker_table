-- Found by the tournament simulation: reopening a tournament that ended in a
-- deal brought back only one player. Everyone who was still in when it was
-- finished (finish_tournament stamps them with busted_at = finished_at) goes
-- back to playing, seated at table 1.
-- finish_tournament now stamps them with its own clock reading, so a player
-- busted earlier in the same transaction is never mistaken for one of them.
create or replace function public.finish_tournament(p_id uuid, p_prizes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'running' then raise exception 'tournament is not running'; end if;
  update tournament_entries e
     set place = (x->>'place')::int, prize = coalesce((x->>'prize')::numeric, 0),
         status = case when e.status = 'playing' then 'busted' else e.status end,
         busted_at = case when e.status = 'playing' then v_now else e.busted_at end, table_no = null, seat_no = null
    from jsonb_array_elements(p_prizes) x
   where e.tournament_id = p_id and e.id = (x->>'entry_id')::uuid;
  delete from tournament_entries where tournament_id = p_id and status = 'waiting';
  update tournaments set status = 'finished', finished_at = v_now, registration_open = false, paused_at = null
   where id = p_id;
end $$;

create or replace function public.reopen_tournament(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'finished' then raise exception 'tournament is not finished'; end if;
  with alive as (
    select id, row_number() over (order by place nulls last, id) rn
      from tournament_entries
     where tournament_id = p_id and status = 'busted'
       and (busted_at = v_t.finished_at
            or id = (select id from tournament_entries where tournament_id = p_id
                      order by busted_at desc nulls first limit 1))
  )
  update tournament_entries e set status = 'playing', busted_at = null, table_no = 1, seat_no = alive.rn
    from alive where e.id = alive.id;
  update tournament_entries set place = null, prize = null where tournament_id = p_id;
  update tournaments set status = 'running', finished_at = null, paused_at = now() where id = p_id;
end $$;
