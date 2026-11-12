-- Notifications: who gets what, nobody is told about their own action, users
-- only see and mark their own, push subscriptions are private.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');
select tests.make_user('p3', 'P3');
select tests.make_user('out', 'Outsider');

create or replace function tests.n(p_user text, p_kind text) returns int language sql as $$
  select count(*)::int from public.notifications where user_id = tests.id(p_user) and kind = p_kind
$$;

select tests.login('admin');
select tests.put('table', (public.create_table('Notify table')).id);
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

-- joining
select tests.login('p1'); select public.join_table(:'table_code'); reset role;
select tests.eq(tests.n('admin', 'join_request'), 1, 'admin is told about a join request');
select tests.login('admin');
update table_members set status = 'active' where table_id = tests.id('table') and user_id = tests.id('p1');
reset role;
select tests.eq(tests.n('p1', 'join_approved'), 1, 'player is told they were approved');
select tests.login('p2'); select public.join_table(:'table_code'); reset role;
select tests.login('admin');
update table_members set status = 'active' where table_id = tests.id('table') and user_id = tests.id('p2');
reset role;

-- sign-up opened
select tests.login('admin');
with x as (insert into signups (table_id, starts_at, location, seats, created_by)
  values (tests.id('table'), '2026-11-19 18:30:00+00', 'אצל בן', 2, tests.id('admin')) returning id)
select tests.put('signup', id) from x;
reset role;
select tests.eq(tests.n('p1', 'signup_open'), 1, 'members are told a sign-up opened');
select tests.eq(tests.n('admin', 'signup_open'), 0, 'the admin who opened it is not told');
select tests.eq(tests.n('out', 'signup_open'), 0, 'non-members are not told');
select tests.ok((select body like '%ה׳ 19.11 · 20:30%' from notifications where user_id = tests.id('p1') and kind = 'signup_open'),
  'date is shown in Israel time with the Hebrew weekday');

select tests.login('p1'); select public.claim_seat(tests.id('signup')); reset role;
select tests.login('p2'); select public.claim_seat(tests.id('signup')); reset role;
select tests.login('p3'); select public.join_table(:'table_code'); reset role;
select tests.login('admin');
update table_members set status = 'active' where table_id = tests.id('table') and user_id = tests.id('p3');
reset role;
select tests.login('p3'); select public.claim_seat(tests.id('signup')); reset role;
select tests.eq(tests.n('admin', 'signup_joined'), 3, 'the admin is told about each sign-up');

-- seat freed from the waiting list
select tests.login('p2'); select public.leave_signup(tests.id('signup')); reset role;
select tests.eq(tests.n('p3', 'seat_freed'), 1, 'the waiting player is told a seat opened');
select tests.eq(tests.n('p2', 'seat_freed'), 0, 'the player who left is not');

-- details changed
select tests.login('admin');
update signups set address = 'הרצל 10, תל אביב' where id = tests.id('signup');
update signups set note = 'להביא שתייה' where id = tests.id('signup');
reset role;
select tests.eq(tests.n('p1', 'signup_changed'), 1, 'signed-up players are told the address changed');
select tests.eq(tests.n('p2', 'signup_changed'), 0, 'a player who left is not');
select tests.ok((select body like '%הרצל 10%' from notifications where user_id = tests.id('p1') and kind = 'signup_changed'), 'the new address is in the message');
select tests.login('admin');
update signups set starts_at = starts_at + interval '1 hour' where id = tests.id('signup');
reset role;
select tests.eq(tests.n('p3', 'signup_changed'), 2, 'a new time is a second update');

-- night starts
select tests.login('admin');
with x as (insert into game_nights (table_id, chips_per_buyin, money_per_buyin, cashier_member_id, created_by)
  values (tests.id('table'), 1000, 100,
          (select id from table_members where table_id = tests.id('table') and user_id = tests.id('p1')), tests.id('admin')) returning id)
select tests.put('night', id) from x;
insert into night_players (night_id, member_id, seat)
  select tests.id('night'), id, 1 from table_members where table_id = tests.id('table') and user_id = tests.id('p2');
reset role;
select tests.eq(tests.n('p2', 'night_started'), 1, 'members are called when the game starts');
select tests.ok((select url like '/t/%/n/' || tests.id('night') from notifications where user_id = tests.id('p2') and kind = 'night_started'), 'the call opens the night');
select tests.eq(tests.n('admin', 'night_started'), 0, 'the one who opened it is not called');

-- chip request goes to the cashier
select tests.login('p2');
insert into chip_requests (night_id, member_id, requested_by, mode, chips)
  select tests.id('night'), id, tests.id('p2'), 'chips', 1000 from table_members where table_id = tests.id('table') and user_id = tests.id('p2');
reset role;
select tests.eq(tests.n('p1', 'chip_request'), 1, 'the cashier is told about a chip request');
select tests.eq(tests.n('admin', 'chip_request'), 0, 'others are not');

-- privacy
select tests.login('p1');
select tests.eq((select count(*)::int from notifications where user_id <> tests.id('p1')), 0, 'users only see their own notifications');
select tests.throws($$ insert into notifications (user_id, kind, title) values (auth.uid(), 'x', 'x') $$, '%row-level security%', 'clients cannot write notifications');
select tests.eq(tests.affected($$ update notifications set title = 'x' $$), 0, 'clients cannot edit notifications');
select public.mark_notifications_read();
select tests.eq((select count(*)::int from notifications where read_at is null), 0, 'mark all read');
select public.save_push_subscription('https://push.example/abc', 'k', 'a', 'test');
select tests.eq((select count(*)::int from push_subscriptions), 1, 'a device subscribes to push');
select tests.throws($$ select public.save_push_subscription('http://evil/abc', 'k', 'a') $$, '%bad endpoint%', 'only https push endpoints');
reset role;
select tests.eq((select count(*)::int from notifications where user_id = tests.id('p2') and read_at is not null), 0, 'marking read does not touch others');

select tests.login('p2');
select tests.eq((select count(*)::int from push_subscriptions), 0, 'other users do not see my devices');
select public.save_push_subscription('https://push.example/abc', 'k2', 'a2');
reset role;
select tests.eq((select user_id from push_subscriptions where endpoint = 'https://push.example/abc'), tests.id('p2'), 'a device that changes hands moves to the new user');

-- cancel
select tests.login('admin');
update signups set status = 'cancelled' where id = tests.id('signup');
reset role;
select tests.eq(tests.n('p1', 'signup_cancelled'), 1, 'signed-up players are told the night was cancelled');

-- night closes
select tests.login('admin');
update game_nights set status = 'closed', closed_at = now() where id = tests.id('night');
reset role;
select tests.eq(tests.n('p2', 'night_closed'), 1, 'players of the night are told it closed');
select tests.eq(tests.n('p3', 'night_closed'), 0, 'members who did not play are not');

-- tournaments
select tests.login('admin');
with x as (insert into tournaments (table_id, name, starts_at, table_count, seats_per_table, buy_in, starting_stack, levels, created_by)
  values (tests.id('table'), 'Friday', now() + interval '1 day', 1, 2, 100, 10000, '[{"sb":25,"bb":50,"minutes":20}]', tests.id('admin')) returning id)
select tests.put('t', id) from x;
reset role;
select tests.eq(tests.n('p3', 'tournament_open'), 1, 'members are told a tournament opened');
select tests.login('p1'); select public.register_tournament(tests.id('t')); reset role;
select tests.login('p2'); select public.register_tournament(tests.id('t')); reset role;
select tests.login('p3'); select public.register_tournament(tests.id('t')); reset role;
select tests.login('p1'); select public.leave_tournament(tests.id('t')); reset role;
select tests.eq(tests.n('p3', 'tournament_seat'), 1, 'tournament waiting list: told when moved up');
select tests.login('admin');
update tournaments set location = 'אצל דני' where id = tests.id('t');
select public.start_tournament(tests.id('t'));
reset role;
select tests.eq(tests.n('p2', 'tournament_changed'), 1, 'registered players are told the host changed');
select tests.eq(tests.n('p1', 'tournament_changed'), 0, 'a player who left is not');
select tests.eq(tests.n('p3', 'tournament_started'), 1, 'players are called when the tournament starts');

-- no push ping configured here: nothing was marked as pushed
select tests.eq((select count(*)::int from notifications where pushed_at is not null), 0, 'without a dispatch URL nothing is pushed');

rollback;
