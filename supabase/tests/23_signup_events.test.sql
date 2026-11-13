-- Sign-up log: seat, move, waiting list, promotion, cancel; who can read it.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('opener', 'Opener');
select tests.make_user('s1', 'S1');
select tests.make_user('s2', 'S2');
select tests.make_user('s3', 'S3');

select tests.login('opener');
select tests.put('table', (public.create_table('Log table')).id);
with x as (insert into signups (table_id, starts_at, seats, created_by)
  values (tests.id('table'), now() + interval '1 day', 2, tests.id('opener')) returning id)
select tests.put('signup', id) from x;
reset role;

select tests.login('s1');
select public.claim_seat(tests.id('signup'), 1);
select public.claim_seat(tests.id('signup'), 2);  -- moves to seat 2
select tests.eq((select count(*)::int from signup_events where signup_id = tests.id('signup')), 0, 'a player does not see the sign-up log');
reset role;
select tests.login('s2');
select public.claim_seat(tests.id('signup'));      -- seat 1
reset role;
select tests.login('s3');
select public.claim_seat(tests.id('signup'));      -- waiting list
reset role;
select tests.login('s2');
select public.leave_signup(tests.id('signup'));    -- s3 comes up
reset role;

select tests.login('opener');
select tests.eq((select string_agg(kind || ':' || member_name || ':' || coalesce(seat::text, '-'), ',' order by id) from signup_events where signup_id = tests.id('signup')),
  'seat:S1:1,move:S1:2,seat:S2:1,wait:S3:-,left:S2:1,up:S3:1', 'the opener sees every seat, move, wait, cancel and promotion in order');
select tests.eq((select from_seat from signup_events where signup_id = tests.id('signup') and kind = 'move'), 1, 'a move remembers the seat it came from');
select tests.eq((select actor_name from signup_events where signup_id = tests.id('signup') and kind = 'seat' and member_name = 'S1'), 'S1', 'the log says who did it');
select tests.throws(format($$ insert into signup_events (signup_id, member_name, kind) values (%L, 'x', 'seat') $$, tests.id('signup')), '%row-level security%', 'nobody writes the log by hand');
-- deleting the sign-up removes its log quietly
delete from signups where id = tests.id('signup');
reset role;
select tests.eq((select count(*)::int from signup_events where signup_id = tests.id('signup')), 0, 'deleting the sign-up deletes its log');

rollback;
