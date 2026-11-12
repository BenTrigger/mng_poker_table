-- Corrections people make to automatic chip counts, and free notes about a chip
-- set. The counting prompt reads the latest ones so recognition of the same set
-- improves over time.
create table if not exists public.chip_corrections (
  id uuid primary key default gen_random_uuid(),
  chip_set_id uuid not null references public.chip_sets(id) on delete cascade,
  table_id uuid not null references public.poker_tables(id) on delete cascade,
  -- [{ "color": "אדום", "count": 5 }, ...]; null for a plain note
  detected jsonb,
  actual jsonb,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (note is not null or (detected is not null and actual is not null))
);
create index if not exists chip_corrections_set_time on public.chip_corrections (chip_set_id, created_at desc);
alter table public.chip_corrections enable row level security;

drop policy if exists "chip corrections: members read" on public.chip_corrections;
create policy "chip corrections: members read" on public.chip_corrections for select using (public.is_member(table_id));
drop policy if exists "chip corrections: members add" on public.chip_corrections;
create policy "chip corrections: members add" on public.chip_corrections for insert with check (
  public.is_member(table_id)
  and created_by = auth.uid()
  and exists (select 1 from public.chip_sets s where s.id = chip_set_id and s.table_id = chip_corrections.table_id)
);
drop policy if exists "chip corrections: admin delete" on public.chip_corrections;
create policy "chip corrections: admin delete" on public.chip_corrections for delete using (public.is_admin(table_id));

grant select, insert, delete on public.chip_corrections to authenticated;
