-- Chip set reference photos: real crops of each chip type (top and side views),
-- learned from photos the admin takes when setting up a chip set. They belong to
-- the table's saved chip set and persist (unlike night stack photos).
-- Path: <table_id>/<file>.jpg. Paths are stored in chip_sets.chips[].images.
insert into storage.buckets (id, name, public) values ('chip-refs', 'chip-refs', false)
on conflict (id) do nothing;

create or replace function public.uuid_or_null(s text)
returns uuid language plpgsql immutable as $$
begin
  return s::uuid;
exception when others then
  return null;
end $$;

drop policy if exists "chip refs: members read" on storage.objects;
create policy "chip refs: members read" on storage.objects for select using (
  bucket_id = 'chip-refs' and public.is_member(public.uuid_or_null((storage.foldername(name))[1]))
);
drop policy if exists "chip refs: admin upload" on storage.objects;
create policy "chip refs: admin upload" on storage.objects for insert with check (
  bucket_id = 'chip-refs' and public.is_admin(public.uuid_or_null((storage.foldername(name))[1]))
);
drop policy if exists "chip refs: admin delete" on storage.objects;
create policy "chip refs: admin delete" on storage.objects for delete using (
  bucket_id = 'chip-refs' and public.is_admin(public.uuid_or_null((storage.foldername(name))[1]))
);

-- ---------------------------------------------------------------------------
-- AI usage cap (each photo recognition is a paid API call).
-- 'count': stack counting, by the table admin or the cashier of an open night.
-- 'learn': learning a chip set from photos, by the table admin.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  user_id uuid not null,
  kind text not null check (kind in ('count', 'learn')),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_table_time on public.ai_usage (table_id, created_at);
alter table public.ai_usage enable row level security;
drop policy if exists "ai usage: admins read" on public.ai_usage;
create policy "ai usage: admins read" on public.ai_usage for select using (public.is_admin(table_id));

create or replace function public.use_ai(p_table uuid, p_kind text)
returns int language plpgsql security definer set search_path = public as $$
declare
  lim int := case p_kind when 'count' then 100 when 'learn' then 20 end;
  used int;
begin
  if lim is null then raise exception 'bad kind'; end if;
  if not public.is_admin(p_table) and not (p_kind = 'count' and exists (
    select 1 from game_nights n join table_members m on m.id = n.cashier_member_id
    where n.table_id = p_table and n.status = 'open' and m.user_id = auth.uid()
  )) then
    raise exception 'not allowed';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_table::text || p_kind));
  select count(*) into used from ai_usage
  where table_id = p_table and kind = p_kind and created_at > now() - interval '24 hours';
  if used >= lim then raise exception 'quota exceeded'; end if;
  insert into ai_usage (table_id, user_id, kind) values (p_table, auth.uid(), p_kind);
  return lim - used - 1;
end $$;
revoke execute on function public.use_ai(uuid, text) from public, anon;
grant execute on function public.use_ai(uuid, text) to authenticated;
