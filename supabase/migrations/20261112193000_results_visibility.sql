-- "Each player sees only their own results" (stats_visibility = 'own') was
-- enforced only by the screens: any member could read everyone's chips at the
-- end, nets, prizes and transfers through the API. Now the database hides them.
--
-- Who sees a result: the admin, the cashier of that night, the player
-- themselves, or everyone when the table's setting is 'all' (the default).
-- The screens read results from two views that blank what the reader may not
-- see; the hidden columns can no longer be read from the tables directly.

create or replace function public.sees_all_results(t uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(t)
      or coalesce((select last_settings->>'stats_visibility' from poker_tables where id = t), 'all') = 'all';
$$;

create or replace function public.is_my_member(m uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from table_members where id = m and user_id = auth.uid());
$$;

revoke execute on function public.sees_all_results(uuid), public.is_my_member(uuid) from public, anon;
grant execute on function public.sees_all_results(uuid), public.is_my_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cash nights
-- ---------------------------------------------------------------------------
create or replace view public.night_players_view as
select p.id, p.night_id, p.member_id, p.seat, p.status, p.left_at, p.bought_money,
       case when x.sees then p.final_chips end as final_chips,
       case when x.sees then p.final_photo_path end as final_photo_path,
       case when x.sees then p.net end as net
  from night_players p
  join game_nights g on g.id = p.night_id
  cross join lateral (
    select public.sees_all_results(g.table_id) or public.is_cashier(g.id) or public.is_my_member(p.member_id) as sees
  ) x
 where public.is_member(g.table_id);

revoke all on public.night_players_view from public, anon;
grant select on public.night_players_view to authenticated;

revoke select on public.night_players from authenticated;
grant select (id, night_id, member_id, seat, status, left_at, bought_money) on public.night_players to authenticated;

drop policy if exists "settlements: members read" on public.settlements;
create policy "settlements: members read" on public.settlements for select using (
  public.is_member(public.night_table(night_id)) and (
    public.sees_all_results(public.night_table(night_id)) or public.is_cashier(night_id)
    or public.is_my_member(from_member) or public.is_my_member(to_member)
  )
);

-- ---------------------------------------------------------------------------
-- Tournaments: prizes
-- ---------------------------------------------------------------------------
create or replace view public.tournament_results_view as
select e.id, e.tournament_id, e.member_id, e.status, e.place, e.rebuys, e.addon,
       case when public.sees_all_results(t.table_id) or public.is_my_member(e.member_id) then e.prize end as prize
  from tournament_entries e
  join tournaments t on t.id = e.tournament_id
 where public.is_member(t.table_id);

revoke all on public.tournament_results_view from public, anon;
grant select on public.tournament_results_view to authenticated;

revoke select on public.tournament_entries from authenticated;
grant select (id, tournament_id, member_id, status, table_no, seat_no, rebuys, addon, busted_at, busted_by, place, created_at)
  on public.tournament_entries to authenticated;

-- (the tournament page, get_tournament, blanks prizes the same way: see 20261112195000)
