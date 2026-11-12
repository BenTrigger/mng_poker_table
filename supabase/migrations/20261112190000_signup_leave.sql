-- Cancelling a seat in an early sign-up (Ben, 2026-11-12):
-- * a player can give up their seat (or waiting-list place) while the
--   sign-up is open AND after the admin closed registration, until the night
--   itself is opened (started) or the evening is cancelled;
-- * when someone leaves, the first on the waiting list moves up, also when
--   registration is closed (closed means "no new names", not "no moves").

create or replace function public.signup_fill_seats(p_signup uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
  v_free int;
  v_wait signup_seats;
begin
  select * into v_s from signups where id = p_signup;
  if v_s.status not in ('open', 'closed') then return; end if;
  loop
    select g into v_free from generate_series(1, v_s.seats) g
     where not exists (select 1 from signup_seats where signup_id = p_signup and seat = g)
     order by g limit 1;
    exit when v_free is null;
    select * into v_wait from signup_seats where signup_id = p_signup and seat is null order by created_at limit 1;
    exit when v_wait.id is null;
    update signup_seats set seat = v_free where id = v_wait.id;
    v_free := null;
    v_wait := null;
  end loop;
end $$;
revoke execute on function public.signup_fill_seats(uuid) from public, anon, authenticated;

create or replace function public.leave_signup(p_signup uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_s signups;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into v_s from signups where id = p_signup for update;
  if v_s.id is null then raise exception 'signup not found'; end if;
  if v_s.status not in ('open', 'closed') then raise exception 'signup already started'; end if;
  delete from signup_seats ss using table_members m
   where ss.signup_id = p_signup and m.id = ss.member_id and m.user_id = auth.uid();
  perform signup_fill_seats(p_signup);
end $$;
grant execute on function public.leave_signup(uuid) to authenticated;
