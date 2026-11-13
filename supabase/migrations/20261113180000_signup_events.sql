-- Ben (2026-11-13): a log at the bottom of an early sign-up, for whoever opened
-- it (and the table admins): who took a seat, who moved, who went to or came up
-- from the waiting list, who cancelled, and when.
create table if not exists public.signup_events (
  id bigint generated always as identity primary key,
  signup_id uuid not null references public.signups(id) on delete cascade,
  member_id uuid,            -- no FK: the log outlives a deleted member
  member_name text not null,
  kind text not null check (kind in ('seat', 'wait', 'move', 'up', 'to_wait', 'left')),
  seat int,
  from_seat int,
  actor_id uuid default auth.uid(),
  actor_name text,
  created_at timestamptz not null default now()
);
create index if not exists signup_events_signup_time on public.signup_events (signup_id, created_at desc);
alter table public.signup_events enable row level security;

drop policy if exists "signup events: opener or admin read" on public.signup_events;
create policy "signup events: opener or admin read" on public.signup_events for select using (
  exists (select 1 from public.signups s
           where s.id = signup_id and (s.created_by = auth.uid() or public.is_admin(s.table_id)))
);
grant select on public.signup_events to authenticated;
-- written only by the trigger below

create or replace function public.signup_seats_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r signup_seats := case when tg_op = 'DELETE' then old else new end;
  v_kind text;
  v_name text;
  v_actor text;
begin
  -- the whole sign-up (or table) is being deleted: nothing to log
  if not exists (select 1 from signups where id = r.signup_id) then
    return null;
  end if;
  if tg_op = 'INSERT' then
    v_kind := case when new.seat is null then 'wait' else 'seat' end;
  elsif tg_op = 'DELETE' then
    v_kind := 'left';
  elsif old.seat is not distinct from new.seat then
    return null;
  elsif old.seat is null then
    v_kind := 'up';
  elsif new.seat is null then
    v_kind := 'to_wait';
  else
    v_kind := 'move';
  end if;
  select display_name into v_name from table_members where id = r.member_id;
  select display_name into v_actor from profiles where id = auth.uid();
  insert into signup_events (signup_id, member_id, member_name, kind, seat, from_seat, actor_id, actor_name)
  values (r.signup_id, r.member_id, coalesce(v_name, 'שחקן'), v_kind,
          case when tg_op = 'DELETE' then old.seat else new.seat end,
          case when tg_op = 'UPDATE' then old.seat end,
          auth.uid(), v_actor);
  return null;
end $$;
revoke execute on function public.signup_seats_log() from public, anon, authenticated;

drop trigger if exists signup_seats_log on public.signup_seats;
create trigger signup_seats_log after insert or update of seat or delete on public.signup_seats
  for each row execute function public.signup_seats_log();

do $$ begin
  alter publication supabase_realtime add table public.signup_events;
exception when others then null;
end $$;
