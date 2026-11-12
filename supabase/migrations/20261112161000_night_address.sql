-- Street address for an early sign-up and a tournament, next to the host
-- ("location"), so members can open it in Waze. Admin-only writes are covered
-- by the existing update policies on both tables.
alter table public.signups add column if not exists address text;
alter table public.tournaments add column if not exists address text;
