-- Tournament settings chosen by the admin at setup:
-- * payment_mode: 'upfront' = everyone pays the buy-in (and rebuys/add-ons) in
--   cash to the organizer as they go, and the organizer pays the prizes;
--   'end' = nobody pays during play and the app works out who pays whom at the end.
-- * rebuy_until_time: rebuys allowed until a clock time (instead of, or in
--   addition to, a blind level). Null = by level only.
alter table public.tournaments
  add column payment_mode text not null default 'end' check (payment_mode in ('upfront', 'end')),
  add column rebuy_until_time timestamptz;
