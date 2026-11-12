-- Found by the tournament simulation: "who pays whom" at the end of a tournament
-- was only drawn on the screen. Nothing was saved, so nobody could mark a
-- transfer as paid, and with private results a player's screen could not even
-- work out their own transfers (other players' prizes are hidden from them).
--
-- Now the admin's screen saves the transfers when the tournament ends (and
-- again if the admin switches between "between players" and "through the
-- organizer" before anything is paid). The creditor marks a transfer as paid,
-- like the transfers of a cash night.

create table public.tournament_transfers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  from_member uuid not null references public.table_members(id) on delete cascade,
  to_member uuid not null references public.table_members(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid boolean not null default false,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.tournament_transfers (tournament_id);

alter table public.tournament_transfers enable row level security;
create policy "tournament transfers: read" on public.tournament_transfers for select using (
  public.is_member(public.tournament_table(tournament_id)) and (
    public.sees_all_results(public.tournament_table(tournament_id))
    or public.is_my_member(from_member) or public.is_my_member(to_member)
  )
);
-- the creditor (or the admin) marks a transfer as paid; only the admin changes anything else
create policy "tournament transfers: creditor or admin marks paid" on public.tournament_transfers for update using (
  public.is_admin(public.tournament_table(tournament_id)) or public.is_my_member(to_member)
);

create or replace function public.tournament_transfers_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.tournament_id, new.from_member, new.to_member, new.amount)
     is distinct from (old.tournament_id, old.from_member, old.to_member, old.amount)
     and not public.is_admin(public.tournament_table(old.tournament_id)) then
    raise exception 'only the admin can change a transfer';
  end if;
  return new;
end $$;
revoke execute on function public.tournament_transfers_guard() from public, anon, authenticated;
create trigger tournament_transfers_guard before update on public.tournament_transfers
  for each row execute function public.tournament_transfers_guard();

grant select, update on public.tournament_transfers to authenticated;
alter publication supabase_realtime add table public.tournament_transfers;

-- Admin: save the transfers of a finished tournament (replaces the previous ones).
-- p_transfers: [{"from": member id, "to": member id, "amount": n}, ...]
create or replace function public.save_tournament_transfers(p_id uuid, p_transfers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_t tournaments;
begin
  select * into v_t from tournaments where id = p_id for update;
  if v_t.id is null then raise exception 'tournament not found'; end if;
  if not public.is_admin(v_t.table_id) then raise exception 'admin only'; end if;
  if v_t.status <> 'finished' then raise exception 'tournament is not finished'; end if;
  if exists (select 1 from tournament_transfers where tournament_id = p_id and paid) then
    raise exception 'a transfer was already paid';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_transfers) x
     where not exists (select 1 from table_members m where m.id = (x->>'from')::uuid and m.table_id = v_t.table_id)
        or not exists (select 1 from table_members m where m.id = (x->>'to')::uuid and m.table_id = v_t.table_id)
        or (x->>'amount')::numeric <= 0 or (x->>'from') = (x->>'to')
  ) then
    raise exception 'bad transfer';
  end if;
  delete from tournament_transfers where tournament_id = p_id;
  insert into tournament_transfers (tournament_id, from_member, to_member, amount)
  select p_id, (x->>'from')::uuid, (x->>'to')::uuid, round((x->>'amount')::numeric, 2)
    from jsonb_array_elements(p_transfers) with ordinality as a(x, n) order by n;
end $$;
revoke execute on function public.save_tournament_transfers(uuid, jsonb) from public, anon;
grant execute on function public.save_tournament_transfers(uuid, jsonb) to authenticated;

-- Reopening a tournament drops its transfers; they are saved again at the next finish
create or replace function public.tournament_reopened_transfers()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from tournament_transfers where tournament_id = new.id;
  return new;
end $$;
revoke execute on function public.tournament_reopened_transfers() from public, anon, authenticated;
create trigger tournament_reopened_transfers
  after update of status on public.tournaments
  for each row when (old.status = 'finished' and new.status <> 'finished')
  execute function public.tournament_reopened_transfers();

-- The tournament page reads everything through get_tournament: other players'
-- prizes are blank when results are private, and the saved transfers come along.
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
    -- the saved transfers, each player sees the ones they are part of when results are private
    'transfers', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at, x.id)
        from tournament_transfers x
       where x.tournament_id = p_id and v_me.status = 'active' and (
             public.sees_all_results(v_t.table_id) or x.from_member = v_me.id or x.to_member = v_me.id)
    ), '[]'::jsonb),
    'entries', coalesce((
      select jsonb_agg(to_jsonb(e) || jsonb_build_object(
               'prize', case when public.sees_all_results(v_t.table_id) or e.member_id = v_me.id then e.prize end,
               'display_name', m.display_name, 'avatar_url', m.avatar_url, 'user_id', m.user_id
             ) order by e.created_at)
        from tournament_entries e join table_members m on m.id = e.member_id
       where e.tournament_id = p_id
    ), '[]'::jsonb)
  );
end $$;
