-- 1. A player may request chips only for their own membership at the SAME
--    table as the night (before, a member of any table could add a request
--    to another table's night if they knew its id).
drop policy if exists "requests: insert" on public.chip_requests;
create policy "requests: insert" on public.chip_requests for insert with check (
  public.is_admin(public.night_table(night_id)) or public.is_cashier(night_id)
  or exists (
    select 1 from public.table_members m
    where m.id = member_id and m.user_id = auth.uid() and m.status = 'active'
      and m.table_id = public.night_table(night_id)
  )
);

-- 2. The creditor may mark a debt as paid, but only the admin may change who
--    owes whom or how much.
create or replace function public.settlements_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.night_id, new.from_member, new.to_member, new.amount)
     is distinct from (old.night_id, old.from_member, old.to_member, old.amount)
     and not public.is_admin(public.night_table(old.night_id)) then
    raise exception 'only the admin can change a transfer';
  end if;
  return new;
end $$;
revoke execute on function public.settlements_guard() from public, anon, authenticated;

drop trigger if exists settlements_guard on public.settlements;
create trigger settlements_guard before update on public.settlements
  for each row execute function public.settlements_guard();
