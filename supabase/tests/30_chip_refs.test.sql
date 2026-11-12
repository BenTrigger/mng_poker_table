-- Chip set reference photos: members see them, only the admin adds or removes them.
\set ON_ERROR_STOP 1
begin;

select tests.make_user('cr_admin', 'Admin');
select tests.make_user('cr_player', 'Player');
select tests.make_user('cr_stranger', 'Stranger');

select tests.login('cr_admin');
select tests.put('cr_table', (public.create_table('Refs table')).id);
with x as (insert into signups (table_id, starts_at, seats, created_by)
  values (tests.id('cr_table'), now() + interval '1 day', 5, tests.id('cr_admin')) returning id)
select tests.put('cr_signup', id) from x;
insert into storage.objects (bucket_id, name) values ('chip-refs', tests.id('cr_table') || '/red.jpg');
select tests.ok(true, 'admin uploads a chip reference photo');
reset role;

select tests.login('cr_player');
select public.claim_seat(tests.id('cr_signup'));
select tests.eq((select count(*) from storage.objects where bucket_id = 'chip-refs')::int, 1, 'a member sees the table''s chip photos');
select tests.throws(format($$ insert into storage.objects (bucket_id, name) values ('chip-refs', %L) $$, tests.id('cr_table') || '/x.jpg'), '%row-level security%', 'a player cannot upload chip photos');
select tests.eq(tests.affected($$ delete from storage.objects where bucket_id = 'chip-refs' $$), 0, 'a player cannot delete chip photos');
reset role;

select tests.login('cr_stranger');
select tests.eq((select count(*) from storage.objects where bucket_id = 'chip-refs')::int, 0, 'a stranger does not see the chip photos');
select tests.throws($$ insert into storage.objects (bucket_id, name) values ('chip-refs', 'not-a-uuid/x.jpg') $$, '%row-level security%', 'a bad path is refused, not an error');
reset role;

select tests.login('cr_admin');
select tests.eq(tests.affected($$ delete from storage.objects where bucket_id = 'chip-refs' $$), 1, 'the admin removes a chip photo');
reset role;

-- AI usage cap
select tests.login('cr_admin');
select tests.eq(public.use_ai(tests.id('cr_table'), 'learn'), 19, 'the admin may learn a chip set (19 left today)');
reset role;
select tests.login('cr_player');
select tests.throws(format($$ select public.use_ai(%L, 'count') $$, tests.id('cr_table')), '%not allowed%', 'a player who is not the cashier cannot run AI counting');
reset role;
select tests.login('cr_stranger');
select tests.throws(format($$ select public.use_ai(%L, 'learn') $$, tests.id('cr_table')), '%not allowed%', 'a stranger cannot use the table''s AI quota');
reset role;
insert into ai_usage (table_id, user_id, kind) select tests.id('cr_table'), tests.id('cr_admin'), 'learn' from generate_series(1, 19);
select tests.login('cr_admin');
select tests.throws(format($$ select public.use_ai(%L, 'learn') $$, tests.id('cr_table')), '%quota exceeded%', 'the daily cap stops further calls');
reset role;

rollback;
