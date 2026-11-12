-- Early sign-up: seats, waiting list, auto promotion, admin controls.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('admin', 'Admin');
select tests.make_user('p1', 'P1');
select tests.make_user('p2', 'P2');
select tests.make_user('p3', 'P3');
select tests.make_user('p4', 'P4');

select tests.login('admin');
select tests.put('table', (public.create_table('Signup table')).id);
with x as (insert into signups (table_id, starts_at, location, seats, created_by)
  values (tests.id('table'), now() + interval '2 days', 'אצל בן', 3, tests.id('admin')) returning id)
select tests.put('signup', id) from x;
reset role;

select tests.login('p1');
select tests.throws(format($$ insert into signups (table_id, starts_at) values (%L, now()) $$, tests.id('table')), '%row-level security%', 'only the admin opens a sign-up');
select tests.eq((public.get_signup(tests.id('signup'))->>'me'), null, 'link works before joining the table');
select tests.eq((public.get_signup(tests.id('signup'))->'table'->>'name'), 'Signup table', 'link shows the table name');
select tests.eq(public.claim_seat(tests.id('signup'), 2), 2, 'a player picks seat 2 from the link');
select tests.eq((select status from table_members where table_id = tests.id('table') and user_id = tests.id('p1')), 'active', 'taking a seat joins the table');
select tests.eq(public.claim_seat(tests.id('signup'), 3), 3, 'a player can move to another free seat');
select tests.throws(format($$ select public.claim_seat(%L, 9) $$, tests.id('signup')), '%no such seat%', 'seat number beyond the table is refused');
reset role;

select tests.login('p2');
select tests.throws(format($$ select public.claim_seat(%L, 3) $$, tests.id('signup')), '%seat taken%', 'a taken seat cannot be grabbed');
select tests.eq(public.claim_seat(tests.id('signup')), 1, 'no seat chosen -> first free seat');
reset role;

select tests.login('p3');
select tests.eq(public.claim_seat(tests.id('signup')), 2, 'next player gets the last free seat');
reset role;

select tests.login('p4');
select tests.eq(public.claim_seat(tests.id('signup')), null::int, 'table full -> waiting list');
select tests.eq(jsonb_array_length(public.get_signup(tests.id('signup'))->'seats'), 4, 'sign-up lists seated and waiting players');
reset role;

select tests.login('p2');
select public.leave_signup(tests.id('signup'));
reset role;
select tests.eq((select seat from signup_seats ss join table_members m on m.id = ss.member_id
  where ss.signup_id = tests.id('signup') and m.user_id = tests.id('p4')), 1, 'when someone drops out the waiting list moves up');

select tests.login('p1');
select tests.throws(format($$ select public.resize_signup(%L, 2) $$, tests.id('signup')), '%admin only%', 'players cannot change the number of seats');
select tests.throws(format($$ select public.admin_seat(%L, %L, null) $$, tests.id('signup'), tests.id('p4')), '%admin only%', 'players cannot move others');
update signups set starts_at = now() + interval '9 days' where id = tests.id('signup');
reset role;
select tests.eq((select starts_at > now() + interval '8 days' from signups where id = tests.id('signup')), false, 'players cannot change the date');

select tests.login('admin');
update signups set starts_at = now() + interval '3 hours', location = 'אצל דני', address = 'הרצל 10, תל אביב' where id = tests.id('signup');
reset role;
select tests.eq((select starts_at < now() + interval '1 day' and location = 'אצל דני' and address = 'הרצל 10, תל אביב' from signups where id = tests.id('signup')), true, 'the admin can fix the date, host and address');

select tests.login('admin');
select public.resize_signup(tests.id('signup'), 2);
select tests.eq((select count(*)::int from signup_seats where signup_id = tests.id('signup') and seat is null), 1, 'shrinking the table sends the extra player to the waiting list');
select tests.throws(format($$ select public.resize_signup(%L, 11) $$, tests.id('signup')), '%2-10%', 'a night is at most 10 seats');
-- admin seats a guest without an account
with x as (insert into table_members (table_id, display_name) values (tests.id('table'), 'אורח') returning id) select tests.put('guest', id) from x;
select public.resize_signup(tests.id('signup'), 4);
select public.admin_seat(tests.id('signup'), tests.id('guest'), 4);
select tests.eq((select seat from signup_seats where signup_id = tests.id('signup') and member_id = tests.id('guest')), 4, 'admin can seat a guest');
update signups set status = 'closed' where id = tests.id('signup');
reset role;

select tests.login('p2');
select tests.throws(format($$ select public.claim_seat(%L) $$, tests.id('signup')), '%closed%', 'no sign-ups after it is closed');
reset role;

select tests.anon();
select tests.throws(format($$ select public.get_signup(%L) $$, tests.id('signup')), '%permission denied%', 'signed-out visitors cannot read a sign-up');
reset role;

rollback;
