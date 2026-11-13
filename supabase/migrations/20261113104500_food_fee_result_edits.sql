-- Food fee and corrections after the count (Ben, after the 12.11 game night).
--
-- 1. Food fee: every player of the night except the host pays `food_fee` to
--    the host. It is not part of the chips or the poker result, only of the
--    final transfers. Set when the night opens (remembered per table) and
--    editable by the admin until and after the close.
-- 2. The settle mode chosen at the close is kept on the night, so a later
--    correction recalculates the transfers the same way.
--
-- Corrections themselves need no new rights: the admin (and the night's
-- cashier) already write night_players, and the admin writes settlements.
alter table public.game_nights add column if not exists food_fee numeric not null default 0;
alter table public.game_nights add column if not exists host_member_id uuid references public.table_members(id) on delete set null;
alter table public.game_nights add column if not exists settle_mode text;

do $$ begin
  alter table public.game_nights add constraint game_nights_food_fee_check check (food_fee >= 0 and food_fee <= 10000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.game_nights add constraint game_nights_settle_mode_check check (settle_mode in ('players', 'cashier'));
exception when duplicate_object then null; end $$;

-- the host must be a member of the same table
create or replace function public.game_nights_host_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.host_member_id is not null and not exists (
    select 1 from table_members where id = new.host_member_id and table_id = new.table_id
  ) then
    raise exception 'host is not a member of this table';
  end if;
  return new;
end $$;
revoke execute on function public.game_nights_host_guard() from public, anon, authenticated;

drop trigger if exists game_nights_host_guard on public.game_nights;
create trigger game_nights_host_guard before insert or update of host_member_id on public.game_nights
  for each row execute function public.game_nights_host_guard();
