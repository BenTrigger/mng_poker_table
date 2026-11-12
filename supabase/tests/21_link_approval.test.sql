-- Whoever has a link joins at once. Only someone the admin removed (or
-- rejected, or deleted) comes back as a request; their place in a sign-up is
-- held until the admin decides. Opening the night / the tournament draw
-- approves whoever the admin seats.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('a', 'A');
select tests.make_user('b', 'B');
select tests.make_user('c', 'C');
select tests.make_user('d', 'D');

select tests.login('admin');
select tests.put('table', (public.create_table('Approval table')).id);
reset role;
select code as table_code from poker_tables where id = tests.id('table') \gset

select tests.login('a'); select tests.eq(public.join_table(:'table_code'), 'active', 'the table link joins at once'); reset role;
select tests.login('b'); select public.join_table(:'table_code'); reset role;
select tests.put('m_a', (select id from table_members where user_id = tests.id('a')));
select tests.put('m_b', (select id from table_members where user_id = tests.id('b')));

-- the admin removes A, and deletes B for good
select tests.login('admin');
update table_members set status = 'removed' where id = tests.id('m_a');
update table_members set status = 'removed' where id = tests.id('m_b');
delete from table_members where id = tests.id('m_b');
with x as (insert into signups (table_id, starts_at, seats, created_by)
  values (tests.id('table'), now() + interval '1 day', 2, tests.id('admin')) returning id)
select tests.put('signup', id) from x;
reset role;

select tests.login('a');
select tests.eq(public.join_table(:'table_code'), 'pending', 'someone removed who comes back waits for the admin');
select tests.eq((select count(*)::int from game_nights), 0, 'and reads nothing of the table meanwhile');
select tests.eq(public.claim_seat(tests.id('signup')), 1, 'their sign-up place is held');
select tests.eq((public.get_signup(tests.id('signup'))->'me'->>'status'), 'pending', 'the sign-up page knows they wait for approval');
reset role;
select tests.login('b');
select tests.eq(public.claim_seat(tests.id('signup')), 2, 'someone deleted for good comes back through a sign-up link');
reset role;
select tests.eq((select status from table_members where table_id = tests.id('table') and user_id = tests.id('b')), 'pending', 'and waits for approval too');
select tests.put('m_b2', (select id from table_members where table_id = tests.id('table') and user_id = tests.id('b')));
select tests.login('c'); select tests.eq(public.claim_seat(tests.id('signup')), null::int, 'a newcomer from the link: table full -> waiting list'); reset role;
select tests.eq((select status from table_members where table_id = tests.id('table') and user_id = tests.id('c')), 'active', 'the newcomer joined at once');

-- the admin rejects B again: the seat goes to the waiting list
select tests.login('admin');
delete from table_members where id = tests.id('m_b2');
reset role;
select tests.ok((select seat = 2 from signup_seats ss join table_members m on m.id = ss.member_id where m.user_id = tests.id('c')), 'rejecting frees the seat and the waiting list moves up');

-- opening the night from the sign-up approves A, who was seated
select tests.login('admin');
update signups set status = 'started' where id = tests.id('signup');
reset role;
select tests.eq((select status from table_members where id = tests.id('m_a')), 'active', 'opening the night approves the seated players');
select tests.login('a'); select tests.eq(public.join_table(:'table_code'), 'active', 'once approved, A is a member again'); reset role;

-- a tournament: a returning player is approved by the draw
select tests.login('admin');
update table_members set status = 'removed' where id = tests.id('m_a');
with x as (insert into tournaments (table_id, name, starts_at, table_count, seats_per_table, buy_in, starting_stack, levels, created_by)
  values (tests.id('table'), 'Cup', now(), 1, 4, 100, 10000, '[{"sb":25,"bb":50,"minutes":20}]', tests.id('admin')) returning id)
select tests.put('t', id) from x;
reset role;
select tests.login('a'); select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'a returning player registers'); reset role;
select tests.eq((select status from table_members where id = tests.id('m_a')), 'pending', 'and waits for approval');
select tests.login('d'); select tests.eq(public.register_tournament(tests.id('t')), 'registered', 'a newcomer registers'); reset role;
select tests.eq((select status from table_members where table_id = tests.id('table') and user_id = tests.id('d')), 'active', 'and is in the table at once');
select tests.login('admin');
select public.start_tournament(tests.id('t'));
reset role;
select tests.eq((select status from table_members where id = tests.id('m_a')), 'active', 'the draw approves them');

rollback;
