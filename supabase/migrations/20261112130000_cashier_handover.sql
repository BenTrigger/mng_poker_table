-- Mid-night cashier handover: when the cashier leaves, the table counts every
-- stack (photo, summed by colour), checks it against what was handed out,
-- optionally counts the bank, and hands the role to someone else.

create table public.cashier_handovers (
  id uuid primary key default gen_random_uuid(),
  night_id uuid not null references public.game_nights(id) on delete cascade,
  from_member uuid references public.table_members(id) on delete set null,
  to_member uuid not null references public.table_members(id) on delete cascade,
  handed_chips numeric not null,      -- approved chips handed out up to now
  counted_chips numeric not null,     -- chips on the table + chips of players who already left
  gap_chips numeric not null,         -- counted - handed (0 = balanced)
  bank_chips numeric,                 -- chips left in the cashier's box, if counted
  -- [{ "member_id": "...", "chips": 1200, "detected": 1200, "photo_path": "..." }]
  counts jsonb not null default '[]'::jsonb,
  bank_photo_path text,
  outgoing_left boolean not null default false, -- outgoing cashier also left the game (cashed out)
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index on public.cashier_handovers (night_id, created_at);

alter table public.cashier_handovers enable row level security;
create policy "handovers: members read" on public.cashier_handovers for select
  using (public.is_member(public.night_table(night_id)));
-- writes only go through handover_cashier()

alter publication supabase_realtime add table public.cashier_handovers;

-- Atomic handover. Caller must be the table admin or the current cashier.
-- p_counts: [{ member_id, chips, detected, photo_path }] for every player still playing.
-- p_cashout: when the outgoing cashier is also leaving the game,
--            { final_chips, photo_path, bought_money, net }, else null.
create or replace function public.handover_cashier(
  p_night uuid,
  p_to uuid,
  p_handed numeric,
  p_counted numeric,
  p_counts jsonb,
  p_bank numeric default null,
  p_bank_photo text default null,
  p_cashout jsonb default null,
  p_note text default null
) returns public.cashier_handovers
language plpgsql security definer set search_path = public as $$
declare
  v_night game_nights;
  v_h cashier_handovers;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'not signed in'; end if;
  select * into v_night from game_nights where id = p_night for update;
  if v_night.id is null then raise exception 'night not found'; end if;
  if v_night.status <> 'open' then raise exception 'night is closed'; end if;
  if not (public.is_admin(v_night.table_id) or public.is_cashier(p_night)) then
    raise exception 'only the admin or the cashier can hand over';
  end if;
  if p_to is not distinct from v_night.cashier_member_id then
    raise exception 'new cashier must be someone else';
  end if;
  if not exists (
    select 1 from table_members where id = p_to and table_id = v_night.table_id and status = 'active'
  ) then
    raise exception 'new cashier is not an active table member';
  end if;

  if p_cashout is not null then
    if v_night.cashier_member_id is null then raise exception 'no cashier to cash out'; end if;
    update night_players
       set status = 'out',
           final_chips = (p_cashout->>'final_chips')::numeric,
           final_photo_path = p_cashout->>'photo_path',
           bought_money = (p_cashout->>'bought_money')::numeric,
           net = (p_cashout->>'net')::numeric,
           left_at = now()
     where night_id = p_night and member_id = v_night.cashier_member_id and status = 'playing';
  end if;

  insert into cashier_handovers (
    night_id, from_member, to_member, handed_chips, counted_chips, gap_chips,
    bank_chips, counts, bank_photo_path, outgoing_left, note, created_by
  ) values (
    p_night, v_night.cashier_member_id, p_to, p_handed, p_counted, p_counted - p_handed,
    p_bank, coalesce(p_counts, '[]'::jsonb), p_bank_photo, p_cashout is not null, p_note, v_actor
  ) returning * into v_h;

  update game_nights set cashier_member_id = p_to where id = p_night;

  insert into night_events (night_id, actor_id, kind, payload)
  values (p_night, v_actor, 'cashier_handover', jsonb_build_object(
    'handover_id', v_h.id,
    'from', v_night.cashier_member_id,
    'to', p_to,
    'handed', p_handed,
    'counted', p_counted,
    'gap', p_counted - p_handed,
    'bank', p_bank,
    'left', p_cashout is not null
  ));

  return v_h;
end $$;

grant execute on function public.handover_cashier(uuid, uuid, numeric, numeric, jsonb, numeric, text, jsonb, text) to authenticated;
