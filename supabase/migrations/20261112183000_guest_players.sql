-- Guest players: people without a Google account, added by name only.
-- A guest is a table member with user_id null. Guests stay on the table across
-- nights (stats, debts, history) until they sign up; then the admin links the
-- guest to their real account (or they open their personal invite link) and
-- everything the guest did moves to the real member.

-- ---------------------------------------------------------------------------
-- Add a guest by name (table admins: whoever opens sign-ups and nights). The
-- same name on the same table reuses the existing guest, so a returning guest
-- keeps their history.
-- ---------------------------------------------------------------------------
create or replace function public.add_guest(p_table uuid, p_name text)
returns public.table_members language plpgsql security definer set search_path = public as $$
declare
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_m table_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if v_name = '' then raise exception 'name required'; end if;
  if length(v_name) > 40 then raise exception 'name too long'; end if;
  if not public.is_admin(p_table) then raise exception 'admin only'; end if;

  select * into v_m from table_members
   where table_id = p_table and user_id is null and lower(display_name) = lower(v_name)
   order by (status = 'active') desc, created_at
   limit 1;
  if v_m.id is not null then
    if v_m.status <> 'active' then
      update table_members set status = 'active', role = 'player' where id = v_m.id returning * into v_m;
    end if;
    return v_m;
  end if;

  insert into table_members (table_id, display_name, status)
  values (p_table, v_name, 'active')
  returning * into v_m;
  return v_m;
end $$;

-- ---------------------------------------------------------------------------
-- Move everything a guest did onto another member of the same table and
-- delete the guest. Internal: callers check permissions first.
-- ---------------------------------------------------------------------------
create or replace function public.merge_member_into(p_guest uuid, p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_g table_members;
  v_t table_members;
  r record;
begin
  select * into v_g from table_members where id = p_guest for update;
  select * into v_t from table_members where id = p_target for update;
  if v_g.id is null or v_t.id is null then raise exception 'member not found'; end if;
  if v_g.id = v_t.id then raise exception 'same member'; end if;
  if v_g.table_id <> v_t.table_id then raise exception 'not the same table'; end if;
  if v_g.user_id is not null then raise exception 'not a guest'; end if;

  if exists (select 1 from night_players a join night_players b on a.night_id = b.night_id
              where a.member_id = p_guest and b.member_id = p_target) then
    raise exception 'both played the same night';
  end if;
  if exists (select 1 from tournament_entries a join tournament_entries b on a.tournament_id = b.tournament_id
              where a.member_id = p_guest and b.member_id = p_target) then
    raise exception 'both played the same tournament';
  end if;

  -- sign-ups: if both are signed up, keep a seat over a waiting-list spot
  for r in select a.signup_id, a.seat as gseat, b.seat as tseat
             from signup_seats a join signup_seats b on a.signup_id = b.signup_id
            where a.member_id = p_guest and b.member_id = p_target loop
    if r.tseat is null and r.gseat is not null then
      delete from signup_seats where signup_id = r.signup_id and member_id = p_target;
    else
      delete from signup_seats where signup_id = r.signup_id and member_id = p_guest;
    end if;
  end loop;
  update signup_seats set member_id = p_target where member_id = p_guest;

  update night_players set member_id = p_target where member_id = p_guest;
  update chip_requests set member_id = p_target where member_id = p_guest;
  update settlements set from_member = p_target where from_member = p_guest;
  update settlements set to_member = p_target where to_member = p_guest;
  delete from settlements where from_member = to_member;
  update game_nights set cashier_member_id = p_target where cashier_member_id = p_guest;
  update cashier_handovers set from_member = p_target where from_member = p_guest;
  update cashier_handovers set to_member = p_target where to_member = p_guest;
  update cashier_handovers set counts = replace(counts::text, p_guest::text, p_target::text)::jsonb
   where counts::text like '%' || p_guest::text || '%';
  update tournament_entries set member_id = p_target where member_id = p_guest;
  update tournament_entries set busted_by = p_target where busted_by = p_guest;
  update night_events set payload = replace(payload::text, p_guest::text, p_target::text)::jsonb
   where payload::text like '%' || p_guest::text || '%';

  if v_t.status <> 'active' then
    update table_members set status = 'active' where id = p_target;
  end if;
  delete from table_members where id = p_guest;
end $$;
revoke execute on function public.merge_member_into(uuid, uuid) from public, anon, authenticated;

-- Admin: link a guest to a member who has since signed in with Google.
create or replace function public.link_guest(p_guest uuid, p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_table uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select table_id into v_table from table_members where id = p_guest;
  if v_table is null then raise exception 'member not found'; end if;
  if not public.is_admin(v_table) then raise exception 'admin only'; end if;
  if not exists (select 1 from table_members where id = p_member and table_id = v_table and user_id is not null and status <> 'removed') then
    raise exception 'not a signed-in member';
  end if;
  perform public.merge_member_into(p_guest, p_member);
end $$;

-- ---------------------------------------------------------------------------
-- join_table: a personal invite link (p_member = a guest) now also works for
-- someone who already joined the table another way: the guest's history is
-- merged into their membership and they become active.
-- ---------------------------------------------------------------------------
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
    if v_existing.status = 'removed' then raise exception 'removed from table'; end if;
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

  insert into table_members (table_id, user_id, display_name, avatar_url, status)
  values (v_table.id, auth.uid(), v_profile.display_name, v_profile.avatar_url, 'pending');
  return 'pending';
end $$;

revoke execute on function public.add_guest(uuid, text), public.link_guest(uuid, uuid), public.join_table(text, uuid)
  from public, anon;
grant execute on function public.add_guest(uuid, text), public.link_guest(uuid, uuid), public.join_table(text, uuid)
  to authenticated;
